# Supabase Auth email templates (SQEM-097)

Branded HTML for the Supabase **Authentication → Emails** templates. They are **auth config, not a
migration** — no migration carries them.

- **Staging:** `deploy-staging.yml` sets all five from these files on every deploy, reads them back
  and fails on a difference (SQEM-508). ⚠️ Edit the file, not the staging dashboard — a dashboard
  edit is overwritten by the next deploy.
- **Production:** still a manual paste into the dashboard, once per change.

A fresh or duplicated project silently falls back to Supabase's defaults, and nothing announces
it — staging had done exactly that (found 2026-10-13; every reset hung on the loading screen).

Design matches the in-code template (`supabase/functions/_shared/emailTemplate.ts`) used for
the Resend invite email — same logo, card, button, footer.

| File | Dashboard template | Link variable |
|---|---|---|
| `confirm-signup.html` | Confirm signup | `{{ .ConfirmationURL }}` |
| `reset-password.html` | Reset password | `{{ .SiteURL }}/#/reset-password?token_hash={{ .TokenHash }}&type=recovery` |
| `magic-link.html` | Magic Link | `{{ .ConfirmationURL }}` |
| `change-email.html` | Change Email Address | `{{ .ConfirmationURL }}` |
| `invite-user.html` | Invite user | `{{ .ConfirmationURL }}` |

> **Note on "Invite user":** the app's own **team invites** do **not** use this Supabase
> template — they go through the custom Resend function `send-invite-email`
> (`lib/api/invitations.ts`), which is branded in code. The Supabase "Invite user" template
> is only used for **dashboard invites** (Authentication → Users → Invite); branded here for
> consistency. ("Reauthentication" is unused unless reauth is enabled — skip it.)

## ⚠️ Reset password — do not change the link
`reset-password.html` MUST keep the `token_hash` link (not `{{ .ConfirmationURL }}`). GoTrue's
default verify link is consumed by email scanners before the user clicks (→ `otp_expired`);
the `token_hash` link is only redeemed by the browser's `verifyOtp` (SQEM-091). `{{ .SiteURL }}`
resolves to `https://app.sqemes.com` on prod — confirm the project's Site URL if unsure.

Logo is served from `https://app.sqemes.com/logo-primary-V2.png` (hard-coded, since emails
render outside the app).

*SQEM-558 (2026-10-22): the brand is lowercase mid-sentence in all five templates ("sqemes"). Staging picks that up on deploy; production needs the manual paste into the dashboard (see **Production** above).*
