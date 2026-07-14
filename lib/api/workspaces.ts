import { supabase } from '../supabase';
import type { Database } from '../database.types';
import type { Workspace, User, BrandProfile } from '../../types';

type WorkspaceRow = Database['public']['Tables']['workspaces']['Row'];

export function rowToWorkspace(row: WorkspaceRow, members: User[] = []): Workspace {
  return {
    id: row.id,
    name: row.name,
    plan: row.plan,
    isManaged: row.is_managed ?? false,
    stripeSubscriptionId: row.stripe_subscription_id ?? undefined,
    billingCycle: (row.billing_cycle as 'monthly' | 'yearly') ?? 'monthly',
    creditsUsed: row.credits_used,
    creditsLimit: row.credits_limit,
    subscriptionStatus: row.subscription_status ?? null,
    trialEndsAt: row.trial_ends_at ?? null,
    cancelAtPeriodEnd: row.cancel_at_period_end ?? false,
    apiKeys: {}, // Never fetched client-side
    members,
    blacklistedTerms: row.blacklisted_terms,
    blockEmails: row.block_emails ?? false,
    blockIban: row.block_iban ?? false,
    blockPhone: row.block_phone ?? false,
    tags: row.tags,
    openrouterModels: row.openrouter_models ?? [],
    brandProfile: row.brand_profile ? (row.brand_profile as unknown as BrandProfile) : undefined,
  };
}

export async function fetchUserWorkspaces() {
  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data as WorkspaceRow[];
}

export async function fetchWorkspaceMembers(workspaceId: string) {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('user_id, role, profiles(id, name, email, avatar)')
    .eq('workspace_id', workspaceId);

  if (error) throw error;

  type MemberRow = {
    user_id: string;
    role: 'admin' | 'editor' | 'member';
    profiles: unknown;
  };
  return ((data || []) as MemberRow[]).map((m) => {
    const profile = m.profiles as { id: string; name: string; email: string; avatar: string };
    return {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      avatar: profile.avatar,
      role: m.role,
    };
  });
}

export async function createWorkspace(name: string) {
  // Use RPC to create workspace + membership atomically.
  // This runs as security definer, bypassing the SELECT RLS policy
  // that would otherwise block RETURNING on a workspace the user
  // isn't a member of yet.
  // The function uses auth.uid() internally for security.
  const { data, error } = await supabase
    .rpc('create_workspace', { ws_name: name });

  if (error) throw error;

  // Fetch the created workspace (user is now a member, so SELECT policy passes)
  const { data: ws, error: fetchError } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', data)
    .single();

  if (fetchError) throw fetchError;
  return ws as WorkspaceRow;
}

// SQEM-109: `plan` (and other billing/credit/subscription columns) are service-role-only —
// the DB revokes client UPDATE on them, so they are intentionally not accepted here.
export async function updateWorkspace(id: string, updates: Partial<{
  name: string;
  blacklisted_terms: string[];
  block_emails: boolean;
  block_iban: boolean;
  block_phone: boolean;
  tags: string[];
  openrouter_models: string[];
  brand_profile: BrandProfile | null;
}>) {
  const { data, error } = await supabase
    .from('workspaces')
    .update(updates as unknown as Database['public']['Tables']['workspaces']['Update'])
    .eq('id', id)
    .select();

  if (error) throw error;
  return data![0] as WorkspaceRow;
}

export async function deleteWorkspace(id: string) {
  const { error } = await supabase
    .from('workspaces')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function setWorkspaceManaged(id: string, managed: boolean) {
  const { error } = await supabase
    .rpc('set_workspace_managed', { ws_id: id, managed });

  if (error) throw error;
}
