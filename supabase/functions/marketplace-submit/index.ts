// SQEM-180 (SQEM-176 Phase B) — accept a template submission from a self-hosted instance into the Cloud
// review queue. PUBLIC + token-gated: the self-host api-sidecar (SQEM-181) forwards a bundle with the
// publisher's server-held token. Everything lands `pending` — a Sqemes admin approves before it goes live.
//
// Hardening (submissions are fully untrusted UGC from external instances):
//   • Token → publisher (service role); reject unknown / banned.
//   • Hard input size cap + entry-count cap (zip-bomb / DoS). Only manifest.json is read.
//   • Per-publisher hourly rate limit.
//   • Server-side injection scan (the verdict is computed here, not trusted from the caller).
//   • Per-publisher content-hash dedup (no resubmitting the same thing while pending/published).
import JSZip from 'npm:jszip@3.10.1';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { scanForInjection } from '../_shared/injectionScan.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_BUNDLE_BYTES = 5 * 1024 * 1024; // 5 MB compressed
const MAX_ENTRIES = 300;
const HOURLY_CAP = 20; // submissions per publisher per hour
const BUNDLE_SCHEMA = 'sqemes-bundle/v1';

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { token, bundle, category } = await req.json().catch(() => ({}));
    if (!token || typeof token !== 'string') return json({ error: 'Missing token' }, 401);
    if (!bundle || typeof bundle !== 'string') return json({ error: 'Missing bundle' }, 400);

    // Decode + size cap before doing anything expensive.
    let bytes: Uint8Array;
    try { bytes = base64ToBytes(bundle); } catch { return json({ error: 'Invalid bundle encoding' }, 400); }
    if (bytes.length > MAX_BUNDLE_BYTES) return json({ error: `Bundle too large (max ${MAX_BUNDLE_BYTES / 1024 / 1024} MB)` }, 413);

    const admin = createAdminClient();

    // Resolve the publisher from the token hash (service role — bypasses RLS).
    const tokenHash = await sha256Hex(token);
    const { data: pub } = await admin
      .from('marketplace_publishers')
      .select('id, display_name, banned')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (!pub) return json({ error: 'Invalid publisher token' }, 401);
    if (pub.banned) return json({ error: 'This publisher is banned' }, 403);

    // Per-publisher hourly rate limit.
    const sinceIso = new Date(Date.now() - 3600_000).toISOString();
    const { count: recent } = await admin
      .from('library_templates')
      .select('id', { count: 'exact', head: true })
      .eq('publisher_id', pub.id)
      .gte('created_at', sinceIso);
    if ((recent ?? 0) >= HOURLY_CAP) return json({ error: 'Rate limit reached — try again later' }, 429);

    // Unzip (guarded) and read the manifest.
    let zip: JSZip;
    try { zip = await JSZip.loadAsync(bytes); } catch { return json({ error: 'Corrupt or invalid bundle' }, 400); }
    if (Object.keys(zip.files).length > MAX_ENTRIES) return json({ error: 'Bundle has too many entries' }, 400);
    const manifestEntry = zip.file('manifest.json');
    if (!manifestEntry) return json({ error: 'Not a Sqemes bundle (manifest.json missing)' }, 400);

    let manifest: {
      schema?: string;
      templates?: { kind: string; title: string; description?: string; tag?: string | null; variables?: unknown[]; content: string; systemInstruction?: string }[];
      skills?: { content: string }[];
      files?: { name: string }[];
    };
    try { manifest = JSON.parse(await manifestEntry.async('string')); } catch { return json({ error: 'Corrupt manifest' }, 400); }
    if (manifest.schema !== BUNDLE_SCHEMA) return json({ error: `Unsupported bundle version: ${manifest.schema ?? 'unknown'}` }, 400);

    const tpl = (manifest.templates || [])[0];
    if (!tpl || !tpl.title?.trim() || tpl.content == null) return json({ error: 'Bundle has no primary template' }, 400);
    const skills = manifest.skills || [];
    const files = manifest.files || [];

    // Server-side injection scan (verdict computed here).
    const scan = scanForInjection(tpl.content, tpl.systemInstruction, tpl.description, ...skills.map(s => s.content));

    // Per-publisher content-hash dedup (matches the Cloud publish dedup shape).
    const contentHash = await sha256Hex(`${tpl.title} ${tpl.description ?? ''} ${tpl.content}`);
    const { data: dup } = await admin
      .from('library_templates')
      .select('id')
      .eq('publisher_id', pub.id)
      .eq('content_hash', contentHash)
      .in('status', ['pending', 'published'])
      .maybeSingle();
    if (dup) return json({ error: 'You already submitted this template (pending or published)' }, 409);

    // Store the bundle, then insert the pending listing.
    const path = `submissions/${pub.id}/${crypto.randomUUID()}/bundle.sqemes.zip`;
    const { error: upErr } = await admin.storage.from('library-files').upload(path, bytes, { contentType: 'application/zip' });
    if (upErr) return json({ error: `Could not store bundle: ${upErr.message}` }, 500);

    const preview = { fileNames: files.map(f => f.name), fileCount: files.length, skillCount: skills.length };
    const { data: inserted, error: insErr } = await admin
      .from('library_templates')
      .insert({
        kind: tpl.kind,
        title: tpl.title.trim(),
        description: tpl.description ?? '',
        category: typeof category === 'string' && category ? category : 'General',
        tags: tpl.tag ? [tpl.tag] : [],
        variables: tpl.variables ?? [],
        content: tpl.content,
        system_instruction: tpl.systemInstruction ?? null,
        status: 'pending',
        published: false,
        workspace_id: null,
        source: 'self-host',
        publisher_id: pub.id,
        bundle_path: path,
        scan_risk: scan.risk,
        scan_reasons: scan.reasons,
        content_hash: contentHash,
        preview,
      })
      .select('id')
      .single();
    if (insErr || !inserted) {
      await admin.storage.from('library-files').remove([path]);
      return json({ error: `Could not create submission: ${insErr?.message ?? 'unknown error'}` }, 500);
    }

    return json({ id: inserted.id, status: 'pending', scanRisk: scan.risk, publisher: pub.display_name });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
