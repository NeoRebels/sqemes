-- SQEM-504 — two tenants for the isolation suite, LOCAL database only. Idempotent: everything the seed
-- creates hangs off the two workspaces and four users below and is removed first.
--
--   Workspace A  aaaaaaaa-0000-4000-8000-0000000000aa   a1 (admin) · a2 (member)
--   Workspace B  bbbbbbbb-0000-4000-8000-0000000000bb   b1 (admin) · b2 (member)
--
-- ⚠️ Users are created through a pending INVITATION, never by inserting a membership afterwards:
-- `handle_new_user` creates a personal workspace for anyone who is in no workspace at that moment.

begin;

-- Rows that do not cascade from the workspace or the users.
delete from public.mcp_call_counters where key_id = 'aaaaaaaa-0000-4000-8000-00000000a501';
delete from public.mcp_rate_counters where key_id = 'aaaaaaaa-0000-4000-8000-00000000a501';
delete from public.rate_limit_counters where workspace_id in ('aaaaaaaa-0000-4000-8000-0000000000aa', 'bbbbbbbb-0000-4000-8000-0000000000bb');
delete from public.deleted_workspaces_audit where workspace_id in ('aaaaaaaa-0000-4000-8000-0000000000aa', 'bbbbbbbb-0000-4000-8000-0000000000bb');
delete from public.workspaces where id in ('aaaaaaaa-0000-4000-8000-0000000000aa', 'bbbbbbbb-0000-4000-8000-0000000000bb');
delete from public.invitations where email like '%@isolation.invalid';
delete from auth.users where email like '%@isolation.invalid';
delete from public.library_templates where title like 'SQEM-504 %';
delete from public.marketplace_publishers where display_name = 'SQEM-504 publisher';
delete from public.mcp_oauth_clients where client_id = 'sqem504-client';
-- storage.protect_delete() blocks direct deletes unless this is set; local cleanup only.
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'workspace-files' and name like 'aaaaaaaa-0000-4000-8000-0000000000aa/%';

insert into public.workspaces (id, name, plan, is_managed) values
  ('aaaaaaaa-0000-4000-8000-0000000000aa', 'Isolation A', 'Team', true),
  ('bbbbbbbb-0000-4000-8000-0000000000bb', 'Isolation B', 'Team', true);

insert into public.invitations (workspace_id, email, role, status, expires_at) values
  ('aaaaaaaa-0000-4000-8000-0000000000aa', 'a1@isolation.invalid', 'admin',  'pending', now() + interval '1 day'),
  ('aaaaaaaa-0000-4000-8000-0000000000aa', 'a2@isolation.invalid', 'member', 'pending', now() + interval '1 day'),
  ('bbbbbbbb-0000-4000-8000-0000000000bb', 'b1@isolation.invalid', 'admin',  'pending', now() + interval '1 day'),
  ('bbbbbbbb-0000-4000-8000-0000000000bb', 'b2@isolation.invalid', 'member', 'pending', now() + interval '1 day');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email, '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
from (values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'a1@isolation.invalid'),
  ('aaaaaaaa-0000-4000-8000-0000000000a2', 'a2@isolation.invalid'),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', 'b1@isolation.invalid'),
  ('bbbbbbbb-0000-4000-8000-0000000000b2', 'b2@isolation.invalid')
) as u(id, email);

-- ── Workspace A: one row in every table a tenant can own ─────────────────────────────────────────
insert into public.prompts (id, workspace_id, title, content, kind, created_by, published) values
  ('aaaaaaaa-0000-4000-8000-00000000a001', 'aaaaaaaa-0000-4000-8000-0000000000aa', 'A open',    'open body',    'prompt', 'aaaaaaaa-0000-4000-8000-0000000000a1', true),
  ('aaaaaaaa-0000-4000-8000-00000000a002', 'aaaaaaaa-0000-4000-8000-0000000000aa', 'A only me', 'private body', 'skill',  'aaaaaaaa-0000-4000-8000-0000000000a1', true);
insert into public.template_access (template_id, workspace_id, created_by)
  values ('aaaaaaaa-0000-4000-8000-00000000a002', 'aaaaaaaa-0000-4000-8000-0000000000aa', 'aaaaaaaa-0000-4000-8000-0000000000a1');

insert into public.personas (id, workspace_id, title, content, created_by) values
  ('aaaaaaaa-0000-4000-8000-00000000a101', 'aaaaaaaa-0000-4000-8000-0000000000aa', 'A persona', 'be A', 'aaaaaaaa-0000-4000-8000-0000000000a1');
insert into public.persona_templates (persona_id, template_id)
  values ('aaaaaaaa-0000-4000-8000-00000000a101', 'aaaaaaaa-0000-4000-8000-00000000a001');
insert into public.persona_access (persona_id, workspace_id, user_id, created_by)
  values ('aaaaaaaa-0000-4000-8000-00000000a101', 'aaaaaaaa-0000-4000-8000-0000000000aa', 'aaaaaaaa-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-0000000000a1');

insert into public.workspace_groups (id, workspace_id, name, created_by)
  values ('aaaaaaaa-0000-4000-8000-00000000a201', 'aaaaaaaa-0000-4000-8000-0000000000aa', 'A group', 'aaaaaaaa-0000-4000-8000-0000000000a1');
insert into public.workspace_group_members (group_id, user_id)
  values ('aaaaaaaa-0000-4000-8000-00000000a201', 'aaaaaaaa-0000-4000-8000-0000000000a2');
-- SQEM-473 — one editor-list row each, so the per-table probes have A's rows to try to read and change.
insert into public.template_editors (template_id, workspace_id, user_id, created_by)
  values ('aaaaaaaa-0000-4000-8000-00000000a002', 'aaaaaaaa-0000-4000-8000-0000000000aa', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-0000000000a1');
insert into public.persona_editors (persona_id, workspace_id, group_id, created_by)
  values ('aaaaaaaa-0000-4000-8000-00000000a101', 'aaaaaaaa-0000-4000-8000-0000000000aa', 'aaaaaaaa-0000-4000-8000-00000000a201', 'aaaaaaaa-0000-4000-8000-0000000000a1');

insert into public.workspace_files (id, workspace_id, name, mime_type, size_bytes, storage_path, created_by)
  values ('aaaaaaaa-0000-4000-8000-00000000a301', 'aaaaaaaa-0000-4000-8000-0000000000aa', 'a.md', 'text/markdown', 6,
          'aaaaaaaa-0000-4000-8000-0000000000aa/aaaaaaaa-0000-4000-8000-00000000a301/a.md', 'aaaaaaaa-0000-4000-8000-0000000000a1');
update public.prompts set context_file_ids = array['aaaaaaaa-0000-4000-8000-00000000a301'::uuid]
  where id = 'aaaaaaaa-0000-4000-8000-00000000a001';
-- SQEM-517 — a usage count of A's, so the per-table probe has a row to try to read and change.
insert into public.usage_daily (workspace_id, day, channel, action, template_id, count)
  values ('aaaaaaaa-0000-4000-8000-0000000000aa', current_date, 'mcp', 'playbook_loaded', 'aaaaaaaa-0000-4000-8000-00000000a001', 3);
-- SQEM-509 — an ownerless file no template lists (what the MCP server wrote before the fix, once its
-- template was deleted). Visible to A's admin only, so it can be cleaned up.
insert into public.workspace_files (id, workspace_id, name, mime_type, size_bytes, storage_path, created_by)
  values ('aaaaaaaa-0000-4000-8000-00000000a302', 'aaaaaaaa-0000-4000-8000-0000000000aa', 'orphan.md', 'text/markdown', 6,
          'aaaaaaaa-0000-4000-8000-0000000000aa/aaaaaaaa-0000-4000-8000-00000000a302/orphan.md', null);
insert into public.workspace_file_texts (file_id, workspace_id, content)
  values ('aaaaaaaa-0000-4000-8000-00000000a301', 'aaaaaaaa-0000-4000-8000-0000000000aa', 'secret');
insert into storage.objects (bucket_id, name, owner, metadata)
  values ('workspace-files', 'aaaaaaaa-0000-4000-8000-0000000000aa/aaaaaaaa-0000-4000-8000-00000000a301/a.md',
          'aaaaaaaa-0000-4000-8000-0000000000a1', '{"mimetype":"text/markdown","size":6}');

insert into public.chat_sessions (id, workspace_id, user_id, title, visibility) values
  ('aaaaaaaa-0000-4000-8000-00000000a401', 'aaaaaaaa-0000-4000-8000-0000000000aa', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'A private chat', 'private'),
  ('aaaaaaaa-0000-4000-8000-00000000a402', 'aaaaaaaa-0000-4000-8000-0000000000aa', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'A shared chat',  'workspace');
insert into public.chat_messages (session_id, user_id, role, content) values
  ('aaaaaaaa-0000-4000-8000-00000000a401', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'user', 'private message'),
  ('aaaaaaaa-0000-4000-8000-00000000a402', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'user', 'shared message');

insert into public.invitations (workspace_id, email, role, status)
  values ('aaaaaaaa-0000-4000-8000-0000000000aa', 'pending-a@isolation.invalid', 'member', 'pending');

insert into public.sqemes_api_keys (id, workspace_id, name, key_hash, key_prefix, user_id) values
  ('aaaaaaaa-0000-4000-8000-00000000a501', 'aaaaaaaa-0000-4000-8000-0000000000aa', 'A key', 'sqem504-hash-a', 'sqm_live_isolation', 'aaaaaaaa-0000-4000-8000-0000000000a1');
insert into public.mcp_refresh_tokens (token_hash, key_id, workspace_id, scopes)
  values ('sqem504-refresh-a', 'aaaaaaaa-0000-4000-8000-00000000a501', 'aaaaaaaa-0000-4000-8000-0000000000aa', array['read']);
insert into public.mcp_auth_codes (code, workspace_id, user_id, code_challenge, redirect_uri)
  values ('sqem504-code-a', 'aaaaaaaa-0000-4000-8000-0000000000aa', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'x', 'https://isolation.invalid/cb');
insert into public.mcp_call_counters (key_id, window_key, capability) values ('aaaaaaaa-0000-4000-8000-00000000a501', 1, 'read');
insert into public.mcp_rate_counters (key_id, window_key, kind)       values ('aaaaaaaa-0000-4000-8000-00000000a501', 1, 'read');
insert into public.rate_limit_counters (workspace_id, window_key)     values ('aaaaaaaa-0000-4000-8000-0000000000aa', 1);
insert into public.deleted_workspaces_audit (workspace_id)            values ('aaaaaaaa-0000-4000-8000-0000000000aa');

insert into public.workspace_connectors (workspace_id, created_by, name, mcp_url)
  values ('aaaaaaaa-0000-4000-8000-0000000000aa', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'A connector', 'https://isolation.invalid/mcp');
insert into public.workspace_api_keys (workspace_id, provider, encrypted_key)
  values ('aaaaaaaa-0000-4000-8000-0000000000aa', 'openai', 'enc-a');

-- Marketplace: a PENDING submission from A (must stay A's) and a PUBLISHED listing (public by design).
insert into public.library_templates (id, title, workspace_id, created_by, status, published) values
  ('aaaaaaaa-0000-4000-8000-00000000a601', 'SQEM-504 pending from A', 'aaaaaaaa-0000-4000-8000-0000000000aa', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'pending', false),
  ('aaaaaaaa-0000-4000-8000-00000000a602', 'SQEM-504 published',      'aaaaaaaa-0000-4000-8000-0000000000aa', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'published', true);
insert into public.library_template_reports (library_template_id, reporter_id, reason)
  values ('aaaaaaaa-0000-4000-8000-00000000a602', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'spam');
insert into public.library_template_votes (library_template_id, user_id, value)
  values ('aaaaaaaa-0000-4000-8000-00000000a602', 'aaaaaaaa-0000-4000-8000-0000000000a1', 1);

-- Per-person rows of a1.
insert into public.external_chat_history (user_id, platform, chat_key, url)
  values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'chatgpt', 'k-a', 'https://isolation.invalid/c');
insert into public.legal_acceptances (user_id, document, version)
  values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'terms', 'sqem504');
insert into public.user_prompt_favorites (user_id, prompt_id)
  values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-00000000a001');
insert into public.user_persona_favorites (user_id, persona_id)
  values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-00000000a101');

-- Platform rows no tenant may see.
insert into public.marketplace_publishers (display_name, token_hash) values ('SQEM-504 publisher', 'sqem504-publisher-hash');
insert into public.mcp_oauth_clients (client_id, client_name) values ('sqem504-client', 'SQEM-504');

-- ── Workspace B: its own row, for the control (B must see its own data) ─────────────────────────
insert into public.prompts (id, workspace_id, title, content, kind, created_by, published) values
  ('bbbbbbbb-0000-4000-8000-00000000b001', 'bbbbbbbb-0000-4000-8000-0000000000bb', 'B open', 'b body', 'prompt', 'bbbbbbbb-0000-4000-8000-0000000000b1', true);

commit;
