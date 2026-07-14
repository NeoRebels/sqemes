// SQEM-102 — Scheduled cleanup of abandoned, never-subscribed, empty workspaces.
// Invoked daily by pg_cron via net.http_post (see the migration). Cron-only: guarded by a
// shared CRON_SECRET header (not a user JWT). Two phases per candidate:
//   • warn the owner by email at ~23 days (RETENTION - WARN_LEAD),
//   • delete at ~30 days once the warning is ≥ ~7 days old and it still qualifies.
// The candidate criteria live in find_abandoned_workspace_candidates() (never subscribed,
// not managed, no credits, no content, single member, old enough). Fully re-checked each
// run, so a workspace that re-engages after the warning is automatically spared.
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { renderBrandedEmail, escapeHtml } from '../_shared/emailTemplate.ts';
import { timingSafeEqual } from '../_shared/timingSafe.ts';

const RETENTION_DAYS = 30;
const WARN_LEAD_DAYS = 7;
const APP_URL = Deno.env.get('APP_URL') || 'https://app.sqemes.com';
const DAY_MS = 86_400_000;

Deno.serve(async (req) => {
  // Cron-only auth — a shared secret, never a public/user token.
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || !timingSafeEqual(req.headers.get('x-cron-secret') ?? '', secret)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const admin = createAdminClient();
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM_EMAIL') || 'sqemes <noreply@sqemes.com>';

  try {
    const { data: candidates, error } = await admin.rpc('find_abandoned_workspace_candidates', {
      min_age_days: RETENTION_DAYS - WARN_LEAD_DAYS,
    });
    if (error) throw error;

    const now = Date.now();
    let warned = 0, deleted = 0;

    for (const c of candidates ?? []) {
      const ageDays = (now - new Date(c.created_at).getTime()) / DAY_MS;
      const warnedDaysAgo = c.deletion_warning_sent_at
        ? (now - new Date(c.deletion_warning_sent_at).getTime()) / DAY_MS
        : null;

      // DELETE — old enough, warned, and the notice period has elapsed.
      if (ageDays >= RETENTION_DAYS && warnedDaysAgo !== null && warnedDaysAgo >= WARN_LEAD_DAYS - 1) {
        await admin.from('deleted_workspaces_audit').insert({
          workspace_id: c.workspace_id, name: c.name, created_at: c.created_at, owner_email: c.owner_email,
        });
        const { error: delErr } = await admin.from('workspaces').delete().eq('id', c.workspace_id);
        if (delErr) console.error('delete failed', c.workspace_id, delErr.message);
        else deleted++;
        continue;
      }

      // WARN — first time we see it in the window: email the owner + record it.
      if (!c.deletion_warning_sent_at) {
        const daysLeft = Math.max(1, Math.ceil(RETENTION_DAYS - ageDays));
        if (resendApiKey && c.owner_email) {
          const html = renderBrandedEmail({
            title: 'Your Sqemes workspace will be deleted soon',
            preheader: `Keep "${c.name}" by starting a plan or adding content.`,
            heading: 'Your workspace will be deleted soon',
            bodyHtml:
              `<p style="margin:0 0 12px;">The workspace <strong style="color:#0f172a;">${escapeHtml(c.name)}</strong> was created but never activated — no plan and no content.</p>` +
              `<p style="margin:0;">To keep it, sign in and start a plan (or add a template or chat) within the next <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>. Otherwise it will be automatically removed.</p>`,
            button: { label: 'Keep my workspace', url: APP_URL },
            footerNote: "If you meant to abandon this workspace, no action is needed — it'll be cleaned up automatically.",
          });
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from, to: [c.owner_email],
              subject: `Your Sqemes workspace "${c.name}" will be deleted soon`,
              html,
            }),
          }).catch((e) => console.error('warning email failed', c.workspace_id, e?.message));
        }
        await admin.from('workspaces')
          .update({ deletion_warning_sent_at: new Date().toISOString() })
          .eq('id', c.workspace_id);
        warned++;
      }
    }

    return new Response(JSON.stringify({ ok: true, candidates: candidates?.length ?? 0, warned, deleted }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('cleanup-abandoned-workspaces error:', err?.message);
    return new Response(JSON.stringify({ error: err?.message || 'Internal error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
