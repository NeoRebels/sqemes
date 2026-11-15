// SQEM-692 — the mail when someone signs in on a device sqemes does not know for them yet. Called by the
// `new-sign-in-tick` cron job through pg_net, only when there are new sessions. Never by a browser.
//
// What it does: takes the new sessions from `claim_new_sign_ins()` (which also moves the check forward, so
// each sign-in is looked at once), names the device the way the Devices card does, and compares it with the
// person's `known_devices`. A device not seen before gets a mail in the person's language with a button to
// the card. The first run after the rollout and a person's first device ever only record (no mail).
//
// ⛔ Authorised by the routine dispatch secret (`x-routine-dispatch`), the one the cron job already holds
// in the Vault; whoever holds it can only make this function look at new sessions.
// ⛔ Counts only in the log, never an address, an IP or a device.
// ⚠️ Without `RESEND_API_KEY` (a test environment, a self-host install without mail) devices are still recorded and
// the log counts `unconfigured`, so turning mail on later does not mail everything seen before.

import { createAdminClient } from '../_shared/supabase-admin.ts';
import { renderBrandedEmail, escapeHtml } from '../_shared/emailTemplate.ts';
import { sameSecret } from '../_shared/routineRun.ts';
import { routineDispatchSecret } from '../_shared/routineSecret.ts';
import { m, normalizeLocale, type Locale } from '../_shared/locale.ts';
import { parseUserAgent, deviceKey, signInOutcome, type SignInOutcome } from '../_shared/userAgent.ts';

interface NewSignIn {
  session_id: string;
  user_id: string;
  email: string;
  language: string | null;
  created_at: string;
  user_agent: string | null;
  ip: string | null;
  city: string | null;
  country: string | null;
  bootstrap: boolean;
}

const done = (status: number, body: Record<string, unknown> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function sha256(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}

function mailFor(row: NewSignIn, locale: Locale, appUrl: string): { subject: string; html: string } {
  const { browser, os } = parseUserAgent(row.user_agent);
  const device = browser && os ? m.stp_devices_browser_on_os({ browser, os }, { locale })
    : browser ?? os ?? m.stp_devices_unknown_device({}, { locale });
  const place = [row.city, row.country].map(p => (p ?? '').trim()).filter(Boolean).join(', ')
    || m.stp_devices_unknown_location({}, { locale });
  // German readers get German time, everyone else UTC: the person's own time zone is not known here.
  const time = new Date(row.created_at).toLocaleString(locale === 'de' ? 'de-DE' : 'en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: locale === 'de' ? 'Europe/Berlin' : 'UTC', timeZoneName: 'short',
  });
  const line = (label: string, value: string) =>
    `<tr><td style="padding:4px 16px 4px 0; color:#64748b; white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:4px 0; color:#0f172a;">${escapeHtml(value)}</td></tr>`;
  const bodyHtml = [
    `<p style="margin:0 0 16px;">${escapeHtml(m.srv_newdevice_intro({ email: row.email }, { locale }))}</p>`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px; font-size:14px;">',
    line(m.srv_newdevice_device({}, { locale }), device),
    line(m.srv_newdevice_location({}, { locale }), place),
    row.ip ? line(m.srv_newdevice_ip({}, { locale }), row.ip) : '',
    line(m.srv_newdevice_time({}, { locale }), time),
    '</table>',
    `<p style="margin:0 0 8px;">${escapeHtml(m.srv_newdevice_was_you({}, { locale }))}</p>`,
    `<p style="margin:0;"><strong style="color:#0f172a;">${escapeHtml(m.srv_newdevice_not_you({}, { locale }))}</strong></p>`,
  ].join('');
  const subject = m.srv_newdevice_subject({}, { locale });
  return {
    subject,
    html: renderBrandedEmail({
      title: subject,
      preheader: `${device} · ${place}`,
      heading: m.srv_newdevice_heading({}, { locale }),
      bodyHtml,
      button: { label: m.srv_newdevice_button({}, { locale }), url: `${appUrl}/#/settings?tab=profile&section=devices` },
      footerNote: m.srv_newdevice_footer({}, { locale }),
    }),
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return done(405);
  const secret = await routineDispatchSecret(name => Deno.env.get(name));
  if (secret.length < 32 || !sameSecret(req.headers.get('x-routine-dispatch') ?? '', secret)) return done(401);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('claim_new_sign_ins');
  if (error) {
    console.error('[sign-in-mail]', JSON.stringify({ error: error.code ?? 'rpc' }));
    return done(500);
  }
  const rows = (data ?? []) as NewSignIn[];

  const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const appUrl = (Deno.env.get('APP_URL') || Deno.env.get('SITE_URL') || '').replace(/\/+$/, '');
  const from = Deno.env.get('RESEND_FROM_EMAIL') || 'sqemes <noreply@sqemes.com>';
  const counts: Record<SignInOutcome | 'sent' | 'failed' | 'unconfigured', number> =
    { bootstrap: 0, first: 0, late: 0, known: 0, new: 0, sent: 0, failed: 0, unconfigured: 0 };
  const known = new Map<string, Set<string>>();

  for (const row of rows) {
    let mine = known.get(row.user_id);
    if (!mine) {
      const { data: k } = await admin.from('known_devices').select('device_hash').eq('user_id', row.user_id);
      mine = new Set((k ?? []).map((r: { device_hash: string }) => r.device_hash));
      known.set(row.user_id, mine);
    }
    const hash = await sha256(`${row.user_id}|${deviceKey(row.user_agent, row.country)}`);
    const outcome = signInOutcome({
      bootstrap: row.bootstrap, knownDevices: mine.size, isKnown: mine.has(hash),
      ageMs: Date.now() - new Date(row.created_at).getTime(),
    });
    counts[outcome] += 1;
    await admin.from('known_devices').upsert(
      { user_id: row.user_id, device_hash: hash, last_seen: new Date().toISOString() },
      { onConflict: 'user_id,device_hash' });
    mine.add(hash);
    if (outcome !== 'new') continue;

    if (!resendKey || !appUrl) { counts.unconfigured += 1; continue; }
    const { subject, html } = mailFor(row, normalizeLocale(row.language), appUrl);
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [row.email], subject, html }),
      });
      await res.text().catch(() => '');
      if (res.ok) counts.sent += 1; else counts.failed += 1;
    } catch {
      counts.failed += 1;
    }
  }

  console.log('[sign-in-mail]', JSON.stringify({ checked: rows.length, ...counts }));
  return done(200, counts);
});
