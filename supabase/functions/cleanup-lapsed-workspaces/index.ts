// SQEM-269 — delete a workspace 90 days after its subscription ended, after warning its admins.
//
// The counterpart to `cleanup-abandoned-workspaces` (SQEM-102), and deliberately a separate
// function: that one removes workspaces that were **never used**, this one removes workspaces that
// were **paid for**. The two-phase shape is copied because it is right; the code is not shared
// because the blast radius is not symmetric, and one query serving both cases is how a change meant
// for empty workspaces reaches a customer's archive.
//
// Timeline (the rules and their reasons live in `_shared/retention.ts`):
//   term ends → 30 days of export access (SQEM-267) → warning at ~83 days → deletion at 90.
//
// ⚠️ **This is the most destructive routine in the product, and it runs unattended.** Three things
// keep it honest, and none of them should be removed as "defensive":
//   1. **Dry run.** `{"dryRun": true}` reports exactly what would happen and touches nothing.
//   2. **Re-checked every run.** The candidate query requires the workspace to be lapsed *now*, so
//      a reactivated customer drops out on its own — no cleanup step, no special case.
//   3. **No warning, no deletion.** A workspace 200 days past its term with no warning on record
//      gets warned, not deleted. Reaching the deadline unwarned means the email failed, and the
//      worst possible reading of that is to proceed.

import { createAdminClient } from '../_shared/supabase-admin.ts';
import { renderBrandedEmail, escapeHtml } from '../_shared/emailTemplate.ts';
import { timingSafeEqual } from '../_shared/timingSafe.ts';
import { RETENTION_DAYS, WARN_LEAD_DAYS, retentionAction } from '../_shared/retention.ts';

const APP_URL = Deno.env.get('APP_URL') || 'https://app.sqemes.com';

Deno.serve(async (req) => {
  // Self-host has no subscriptions, so nothing can lapse and this must never act. The function
  // travels with the export; refusing here means a mistaken cron entry is inert, not destructive.
  if (Deno.env.get('SELF_HOSTED') === 'true') {
    return new Response(JSON.stringify({ ok: true, skipped: 'self-hosted' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Cron-only — a shared secret, never a user token.
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || !timingSafeEqual(req.headers.get('x-cron-secret') ?? '', secret)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body?.dryRun === true;
  } catch {
    // No body is the normal cron case.
  }

  const admin = createAdminClient();
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM_EMAIL') || 'sqemes <noreply@sqemes.com>';

  try {
    const { data: candidates, error } = await admin.rpc('find_lapsed_workspace_candidates', {
      min_days_since_end: RETENTION_DAYS - WARN_LEAD_DAYS,
    });
    if (error) throw error;

    const now = Date.now();
    const wouldWarn: string[] = [];
    const wouldDelete: string[] = [];
    let warned = 0, deleted = 0, unreachable = 0;

    for (const c of candidates ?? []) {
      const action = retentionAction({
        endedAt: c.subscription_ended_at,
        warnedAt: c.lapse_warning_sent_at,
        now,
      });

      if (action === 'wait') continue;

      if (action === 'delete') {
        wouldDelete.push(c.name);
        if (dryRun) continue;
        await admin.from('deleted_workspaces_audit').insert({
          workspace_id: c.workspace_id,
          name: c.name,
          owner_email: c.admin_emails?.[0] ?? null,
          reason: 'lapsed-retention',
        });
        const { error: delErr } = await admin.from('workspaces').delete().eq('id', c.workspace_id);
        if (delErr) console.error('delete failed', c.workspace_id, delErr.message);
        else deleted++;
        continue;
      }

      // WARN
      wouldWarn.push(c.name);
      if (dryRun) continue;

      const recipients: string[] = (c.admin_emails ?? []).filter(Boolean);
      if (!recipients.length) {
        // No admin address at all. Do NOT mark it warned — leaving the flag unset means the
        // workspace stays in 'warn' for ever and is never deleted, which is the right way to fail:
        // it becomes visible in the counters instead of quietly disappearing on day 90.
        unreachable++;
        console.error('no admin email for workspace', c.workspace_id, c.name);
        continue;
      }

      if (resendApiKey) {
        const html = renderBrandedEmail({
          title: 'Your Sqemes workspace will be deleted soon',
          preheader: `Download your data from "${c.name}" before it is removed.`,
          heading: 'Your workspace will be deleted soon',
          bodyHtml:
            `<p style="margin:0 0 12px;">The subscription for <strong style="color:#0f172a;">${escapeHtml(c.name)}</strong> ended, and the workspace is scheduled for deletion in about <strong>${WARN_LEAD_DAYS} days</strong>.</p>` +
            `<p style="margin:0 0 12px;">If you want to keep the templates, files and chats in it, either start a plan again or <strong>download everything</strong> — you can do both by signing in.</p>` +
            `<p style="margin:0;">If you no longer need it, you do not have to do anything.</p>`,
          button: { label: 'Sign in and download my data', url: APP_URL },
          footerNote: 'Your invoices are kept separately for the statutory period and are not affected.',
        });
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from, to: recipients,
            subject: `Your Sqemes workspace "${c.name}" will be deleted soon`,
            html,
          }),
        }).catch((e) => console.error('warning email failed', c.workspace_id, e?.message));
      }

      await admin.from('workspaces')
        .update({ lapse_warning_sent_at: new Date().toISOString() })
        .eq('id', c.workspace_id);
      warned++;
    }

    return new Response(JSON.stringify({
      ok: true,
      dryRun,
      candidates: candidates?.length ?? 0,
      warned, deleted, unreachable,
      ...(dryRun ? { wouldWarn, wouldDelete } : {}),
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('cleanup-lapsed-workspaces error:', err?.message);
    return new Response(JSON.stringify({ error: err?.message || 'Internal error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
