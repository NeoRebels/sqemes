/* global console, process */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.API_URL ?? '';
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  process.env.SECRET_KEY ??
  '';

const email = process.env.TEST_EMAIL ?? 'test@example.com';
const password = process.env.TEST_PASSWORD ?? 'testpassword123';
const name = process.env.TEST_NAME ?? 'Local Test User';

function isLocalSupabaseUrl(url) {
  return url.startsWith('http://127.0.0.1:54321') || url.startsWith('http://localhost:54321');
}

if (!isLocalSupabaseUrl(supabaseUrl)) {
  throw new Error(`Refusing to seed a non-local Supabase URL: ${supabaseUrl || '<missing>'}`);
}

if (!serviceRoleKey) {
  throw new Error('Missing local Supabase service role key.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function findUserByEmail(targetEmail) {
  const perPage = 1000;

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === targetEmail.toLowerCase());
    if (user) return user;
    if (data.users.length < perPage) return null;
  }

  return null;
}

async function ensureWorkspace(userId) {
  const { data: memberships, error: membershipError } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .limit(1);

  if (membershipError) throw membershipError;
  if (memberships && memberships.length > 0) return;

  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .insert({ name: 'Local E2E Workspace', plan: 'Solo', credits_limit: 0 })
    .select('id')
    .single();

  if (workspaceError) throw workspaceError;

  const { error: memberError } = await supabase
    .from('workspace_members')
    .insert({ workspace_id: workspace.id, user_id: userId, role: 'admin' });

  if (memberError) throw memberError;
}

async function main() {
  let user = await findUserByEmail(email);

  if (user) {
    const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
      password,
      user_metadata: { name },
    });
    if (error) throw error;
    user = data.user;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) throw error;
    user = data.user;
  }

  await ensureWorkspace(user.id);
  console.log(`Seeded local E2E user ${email}.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
