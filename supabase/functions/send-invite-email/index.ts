import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { renderBrandedEmail, escapeHtml } from '../_shared/emailTemplate.ts';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 100;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    // Verify the caller is authenticated
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createAdminClient();

    // Verify the JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { email, token: inviteToken } = await req.json();

    if (!email || !inviteToken) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Validate email format
    if (!EMAIL_REGEX.test(String(email))) {
      return new Response(JSON.stringify({ error: 'Invalid email address' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // SQEM-111 — authorize the send. Previously any authenticated user could email arbitrary,
    // attacker-controlled content to any address from noreply@sqemes.com. Require: (1) a real
    // pending invitation for this token+email, and (2) the caller is an admin/editor of that
    // invitation's workspace. Display fields are then derived from trusted DB rows, not the body.
    const { data: invitation } = await supabase
      .from('invitations')
      .select('email, status, workspace_id, workspaces(name)')
      .eq('token', inviteToken)
      .maybeSingle();

    if (!invitation
        || invitation.status !== 'pending'
        || String(invitation.email).toLowerCase() !== String(email).toLowerCase()) {
      return new Response(JSON.stringify({ error: 'Invalid or unknown invitation' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { data: membership } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', invitation.workspace_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership || (membership.role !== 'admin' && membership.role !== 'editor')) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Rate-limit per sending user to prevent invite spam
    const allowed = await checkRateLimit(user.id);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait before sending more invitations.' }), {
        status: 429,
        headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '60' },
      });
    }

    // Display fields come from trusted rows (workspace name from the invitation; inviter from the
    // caller's own profile) — never from the request body.
    const { data: profile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', user.id)
      .maybeSingle();

    const safeName = (s: unknown) => String(s || '').slice(0, MAX_NAME_LENGTH);
    const safeWorkspaceName = safeName((invitation.workspaces as any)?.name);
    const safeInviterName = safeName(profile?.name);

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      console.error('RESEND_API_KEY not configured');
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Build the invite link — use the Origin header or fall back to SITE_URL
    const origin = req.headers.get('Origin') || Deno.env.get('SITE_URL') || 'http://localhost:5173';
    const inviteLink = `${origin}/#/invite/${inviteToken}?email=${encodeURIComponent(email)}`;

    const inviterLabel = escapeHtml(safeInviterName || 'A team member');
    const workspaceLabel = escapeHtml(safeWorkspaceName || 'their workspace');

    const htmlBody = renderBrandedEmail({
      title: `You've been invited to ${safeWorkspaceName || 'a workspace'} on Sqemes`,
      preheader: `${safeInviterName || 'A team member'} invited you to join ${safeWorkspaceName || 'their workspace'} on Sqemes.`,
      heading: "You've been invited!",
      bodyHtml: `<p style="margin:0;"><strong style="color:#0f172a;">${inviterLabel}</strong> has invited you to join <strong style="color:#0f172a;">${workspaceLabel}</strong> on Sqemes.</p>`,
      button: { label: 'Accept invitation', url: inviteLink },
      footerNote: "This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.",
    });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: Deno.env.get('RESEND_FROM_EMAIL') || 'sqemes <noreply@sqemes.com>',
        to: [email],
        subject: `${safeInviterName || 'Someone'} invited you to ${safeWorkspaceName || 'a workspace'} on sqemes`,
        html: htmlBody,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('Resend API error:', errBody);
      return new Response(JSON.stringify({ error: 'Failed to send email' }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const result = await res.json();
    return new Response(JSON.stringify({ success: true, id: result.id }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('send-invite-email error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});
