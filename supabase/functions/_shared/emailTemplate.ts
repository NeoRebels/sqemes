// SQEM-097 — Shared branded email template for transactional emails sent from edge
// functions (currently: team invites via Resend). Email-client-safe: table layout,
// fully inline styles, no flexbox/grid. Keep in sync with the Supabase auth email
// templates (dashboard) — see supabase/templates/*.html.

const BRAND = '#6366f1';
const LOGO_URL = 'https://app.sqemes.com/logo-primary-V2.png';

/** Escape a user-provided string for safe interpolation into HTML. */
export function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface BrandedEmailOptions {
  /** Document <title> — also the tab/preview label in some clients. */
  title: string;
  /** Hidden preview text shown in the inbox list. */
  preheader?: string;
  /** Card heading (plain text). */
  heading: string;
  /** Inner body HTML (already escaped / trusted markup — e.g. `<p>…</p>`). */
  bodyHtml: string;
  /** Optional primary call-to-action button. */
  button?: { label: string; url: string };
  /** Small muted note under the card (plain text). */
  footerNote?: string;
}

/** Render a full, branded, email-client-safe HTML document. */
export function renderBrandedEmail(opts: BrandedEmailOptions): string {
  const { title, preheader, heading, bodyHtml, button, footerNote } = opts;

  const buttonHtml = button
    ? `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 4px;">
                <tr>
                  <td align="center" bgcolor="${BRAND}" style="border-radius:12px;">
                    <a href="${escapeHtml(button.url)}" target="_blank" style="display:inline-block; padding:14px 34px; color:#ffffff; font-size:15px; font-weight:700; text-decoration:none; border-radius:12px;">${escapeHtml(button.label)}</a>
                  </td>
                </tr>
              </table>`
    : '';

  const footerNoteHtml = footerNote
    ? `<p style="margin:0 0 8px; color:#94a3b8; font-size:13px; line-height:1.5;">${escapeHtml(footerNote)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0; padding:0; background:#f1f5f9; -webkit-font-smoothing:antialiased; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${escapeHtml(preheader ?? '')}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px; margin:0 auto;">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <img src="${LOGO_URL}" alt="Sqemes" width="120" style="display:block; border:0; height:auto; width:120px;">
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; padding:40px;">
              <h1 style="margin:0 0 16px; color:#0f172a; font-size:22px; font-weight:700; line-height:1.3;">${escapeHtml(heading)}</h1>
              <div style="color:#475569; font-size:15px; line-height:1.65;">${bodyHtml}</div>${buttonHtml}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 16px 0;">
              ${footerNoteHtml}
              <p style="margin:0; color:#cbd5e1; font-size:12px;">&copy; Sqemes &middot; <a href="https://sqemes.com" style="color:#94a3b8; text-decoration:none;">sqemes.com</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
