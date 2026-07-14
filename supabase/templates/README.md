# Supabase Auth email templates (SQEM-097)

Branded HTML for the Supabase **Authentication → Emails** templates. These are **dashboard
config, not deployed by code** (see `pm/PRODUCTION_PROMOTION.md` + the
`email-template-manual-prod-step` memory) — paste each into the matching template in the
Supabase dashboard, for **both** the prod and staging projects.

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
