// SQEM-189 (SQEM-176) — PUBLIC marketplace vote endpoint for self-hosted instances. A self-host user has
// no Cloud account, so they vote with an opaque `voterKey` = sha256(instance + self-host user id). Votes
// land in the same `library_template_votes` table as Cloud votes (voter_key instead of user_id), and the
// existing trigger aggregates score/vote_count from all rows → one score, both sources.
//
// Public like marketplace-public (verify_jwt=false). Hardening: published-only listings, value ∈ {-1,0,1},
// voterKey must be 64-hex, per-voterKey + per-IP rate limit. Toggle handled server-side (re-casting the
// same value clears the vote), mirroring the Cloud voteListing behaviour.
import { createAdminClient } from '../_shared/supabase-admin.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const HEX64 = /^[0-9a-f]{64}$/;
const RATE_PER_MIN = 60; // casts per voter_key (and per IP) per minute

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { action, listingId, value, voterKey } = await req.json().catch(() => ({}));
    if (!voterKey || typeof voterKey !== 'string' || !HEX64.test(voterKey))
      return json({ error: 'Invalid voterKey' }, 400);

    const admin = createAdminClient();

    // ── mine: the caller's own votes (keyed by their opaque voterKey) ──
    if (action === 'mine') {
      const { data } = await admin.from('library_template_votes')
        .select('library_template_id, value').eq('voter_key', voterKey);
      const votes: Record<string, number> = {};
      (data || []).forEach((v: { library_template_id: string; value: number }) => { votes[v.library_template_id] = v.value; });
      return json({ votes });
    }

    // ── cast: add / toggle / flip a vote ──
    if (action !== 'cast') return json({ error: 'Unknown action' }, 400);
    if (value !== 1 && value !== -1) return json({ error: 'value must be 1 or -1' }, 400);
    if (!listingId || typeof listingId !== 'string') return json({ error: 'listingId required' }, 400);

    // Rate limit per voter_key and per IP (uses the shared rate_limit_counters via a namespaced UUID).
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    const windowKey = Math.floor(Date.now() / 60000);
    for (const seed of [`vote:${voterKey}`, `voteip:${ip}`]) {
      const nsId = await uuidFromSeed(seed);
      const { data: ok } = await admin.rpc('check_and_increment_rate_limit', { ws_id: nsId, window_key: windowKey, rate_limit: RATE_PER_MIN });
      if (ok === false) return json({ error: 'Rate limit reached — try again shortly' }, 429);
    }

    // Only published listings are votable.
    const { data: listing } = await admin.from('library_templates')
      .select('id, published, score, vote_count').eq('id', listingId).eq('published', true).maybeSingle();
    if (!listing) return json({ error: 'Not found' }, 404);

    // Upsert / toggle by (listing, voter_key).
    const { data: existing } = await admin.from('library_template_votes')
      .select('id, value').eq('library_template_id', listingId).eq('voter_key', voterKey).maybeSingle();
    let myVote = value;
    if (existing && existing.value === value) {
      await admin.from('library_template_votes').delete().eq('id', existing.id); // toggle off
      myVote = 0;
    } else if (existing) {
      await admin.from('library_template_votes').update({ value }).eq('id', existing.id); // flip
    } else {
      const { error } = await admin.from('library_template_votes')
        .insert({ library_template_id: listingId, voter_key: voterKey, value });
      if (error) return json({ error: error.message }, 500);
    }

    // Read back the (trigger-maintained) aggregate.
    const { data: fresh } = await admin.from('library_templates')
      .select('score, vote_count').eq('id', listingId).maybeSingle();
    return json({ score: fresh?.score ?? 0, voteCount: fresh?.vote_count ?? 0, myVote });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// Deterministic UUID from a seed string (SHA-256 → RFC-4122-shaped) so the rate-limit table (keyed by a
// uuid workspace_id) can namespace voter_key / IP counters without a real workspace.
async function uuidFromSeed(seed: string): Promise<string> {
  const buf = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
  const h = Array.from(buf.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
