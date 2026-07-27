// SQEM-144 — Transparent resolution of embedded skills.
//
// A skill can be access-restricted (see `template_access`), yet it must still resolve when it is
// embedded in a template the user CAN access — otherwise the composed prompt silently loses the
// skill's context. `mcp-server` already does this via the service role, but the app's launch flow
// (`TemplateLaunchModal`) and the Chrome extension resolve skills client-side over RLS, so a
// restricted embedded skill is dropped there.
//
// This endpoint closes that gap: it authorizes by access to the PARENT template (the caller's JWT
// through the normal `prompts_select` RLS policy) and then returns that template's embedded skills
// via the service role — transparently, regardless of the caller's direct access to each skill.
// Access is granted through the parent, never by exposing the skill in the caller's own library.
import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

    const { templateId } = await req.json().catch(() => ({}));
    if (!templateId || typeof templateId !== 'string') return json({ error: 'Missing templateId' }, 400);

    // Authorize by access to the PARENT template. A user-scoped client runs the `prompts_select`
    // RLS policy (`can_access_template`) exactly as everywhere else — no access logic duplicated
    // here, so this stays correct if the policy changes. If the user cannot read the parent, the
    // row comes back empty and we refuse.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: parent, error: parentErr } = await userClient
      .from('prompts')
      .select('id, skill_ids')
      .eq('id', templateId)
      .maybeSingle();
    if (parentErr) return json({ error: 'Lookup failed' }, 500);
    if (!parent) return json({ error: 'Template not found or access denied' }, 403);

    const skillIds: string[] = Array.isArray(parent.skill_ids) ? parent.skill_ids : [];
    if (!skillIds.length) return json({ skills: [] });

    // Service role resolves the embedded skills transparently — a skill restricted away from this
    // user is still returned, because access is granted through the parent that embeds it. Guard
    // with kind='skill' so a stray non-skill id in skill_ids can never leak a full prompt.
    const admin = createAdminClient();
    const { data: skills, error: skillErr } = await admin
      .from('prompts')
      .select('id, title, content, context_file_ids')
      .in('id', skillIds)
      .eq('kind', 'skill');
    if (skillErr) return json({ error: 'Skill resolution failed' }, 500);

    // Preserve the order declared in skill_ids (`.in()` does not guarantee ordering).
    const byId = new Map((skills ?? []).map((s) => [s.id, s]));
    const ordered = skillIds.map((id) => byId.get(id)).filter(Boolean);

    return json({ skills: ordered });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
