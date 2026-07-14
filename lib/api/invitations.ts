import { supabase } from '../supabase';
import { logError } from '../monitoring';
import type { Database } from '../database.types';
import type { Invitation, UserRole } from '../../types';

type InvitationRow = Database['public']['Tables']['invitations']['Row'];

function rowToInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    role: row.role,
    token: row.token,
    invitedBy: row.invited_by,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export async function createInvitation(
  workspaceId: string,
  email: string,
  role: UserRole,
  invitedBy: string,
  workspaceName: string,
  inviterName: string,
): Promise<Invitation> {
  // Check if there's already a pending invitation
  const { data: existing } = await supabase
    .from('invitations')
    .select('id, status')
    .eq('workspace_id', workspaceId)
    .eq('email', email)
    .single();

  if (existing) {
    if (existing.status === 'pending') {
      throw new Error('An invitation has already been sent to this email.');
    }
    // 'accepted' or 'expired': delete so we can re-create.
    // If the user is still a member the membership check below will catch it.
    await supabase.from('invitations').delete().eq('id', existing.id);
  }

  // Check if already a member
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single();

  if (profile) {
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', profile.id)
      .single();

    if (membership) {
      throw new Error('This user is already a member of this workspace.');
    }
  }

  const { data, error } = await supabase
    .from('invitations')
    .insert({
      workspace_id: workspaceId,
      email,
      role,
      invited_by: invitedBy,
    })
    .select();

  if (error) throw error;
  
  // Send invite email via Edge Function — non-blocking but visible on failure
  let emailFailed = false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
      const res = await fetch(`${FUNCTIONS_URL}/send-invite-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email,
          workspaceName,
          inviterName,
          token: data![0].token,
        }),
      });
      if (!res.ok) {
        emailFailed = true;
        logError(new Error(`Invite email failed: HTTP ${res.status}`), { email, workspaceName });
      }
    }
  } catch (emailErr) {
    emailFailed = true;
    logError(emailErr instanceof Error ? emailErr : new Error(String(emailErr)), { context: 'send-invite-email', email });
  }

  const invitation = rowToInvitation(data![0]);
  // Attach email failure flag so callers can surface a warning toast
  return Object.assign(invitation, { emailFailed });
}

export async function fetchPendingInvitations(workspaceId: string): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(rowToInvitation);
}

export async function resendInvitation(id: string, inviterName: string): Promise<Invitation> {
  const newToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('invitations')
    .update({
      token: newToken,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*, workspaces(name)')
    .single();

  if (error) throw error;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
      const res = await fetch(`${FUNCTIONS_URL}/send-invite-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: data.email,
          workspaceName: (data as unknown as { workspaces?: { name?: string } | null }).workspaces?.name,
          inviterName,
          token: newToken,
        }),
      });
      if (!res.ok) {
        logError(new Error(`Resend invite email failed: HTTP ${res.status}`), { id });
      }
    }
  } catch (emailErr) {
    logError(emailErr instanceof Error ? emailErr : new Error(String(emailErr)), { context: 'send-invite-email resend', id });
  }

  return rowToInvitation(data);
}

export async function cancelInvitation(id: string): Promise<void> {
  const { error } = await supabase
    .from('invitations')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function acceptInvitation(token: string): Promise<string> {
  const { data, error } = await supabase
    .rpc('accept_invitation', { p_token: token });

  if (error) throw error;
  return data as string; // workspace_id
}
