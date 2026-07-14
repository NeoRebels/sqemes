import { supabase } from '../supabase';
import type { Database } from '../database.types';
import type { ChatSession, StoredChatMessage } from '../../types';

export type ChatSessionRow = Database['public']['Tables']['chat_sessions']['Row'] & {
  profiles?: { name: string; avatar: string } | null;
};

type ChatMessageRow = Database['public']['Tables']['chat_messages']['Row'] & {
  profiles?: { name: string; avatar: string } | null;
};

// Exported for realtime handlers in the store
export function rowToChatSessionPublic(row: ChatSessionRow, currentUserId: string): ChatSession {
  return rowToChatSession(row, currentUserId);
}

function rowToChatSession(row: ChatSessionRow, currentUserId: string): ChatSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    title: row.title,
    model: row.model,
    assistantId: row.assistant_id || undefined,
    visibility: row.visibility,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    isOwner: row.user_id === currentUserId,
    isGenerating: row.is_generating ?? false,
    pinned: row.pinned ?? false,
    ownerName: row.profiles?.name || undefined,
    ownerAvatar: row.profiles?.avatar || undefined,
  };
}

function rowToStoredMessage(row: ChatMessageRow): StoredChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    model: row.model || undefined,
    createdAt: row.created_at,
    userId: row.user_id || undefined,
    userName: row.profiles?.name || undefined,
    userAvatar: row.profiles?.avatar || undefined,
  };
}

export async function createChatSession(
  workspaceId: string,
  currentUserId: string,
  title: string,
  model: string,
  assistantId?: string
): Promise<ChatSession> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({
      workspace_id: workspaceId,
      user_id: currentUserId,
      title,
      model,
      assistant_id: assistantId || null,
    })
    .select()
    .single();

  if (error) throw error;
  return rowToChatSession(data, currentUserId);
}

export async function fetchChatSessions(
  workspaceId: string,
  userId: string
): Promise<ChatSession[]> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('id, title, user_id, created_at, last_active_at, visibility, model, assistant_id, is_generating, workspace_id, pinned')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .order('last_active_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(row => rowToChatSession(row, userId));
}

export async function fetchSharedChatSessions(
  workspaceId: string,
  currentUserId: string
): Promise<ChatSession[]> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('*, profiles:user_id(id, name, avatar)')
    .eq('workspace_id', workspaceId)
    .eq('visibility', 'workspace')
    .order('last_active_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(row => rowToChatSession(row as unknown as ChatSessionRow, currentUserId));
}

export async function fetchChatMessages(sessionId: string): Promise<StoredChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*, profiles:user_id(id, name, avatar)')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map(row => rowToStoredMessage(row as unknown as ChatMessageRow));
}

export async function addChatMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  model?: string,
  userId?: string,
  id?: string
): Promise<StoredChatMessage> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ ...(id ? { id } : {}), session_id: sessionId, role, content, model: model || null, user_id: userId || null })
    .select()
    .single();

  if (error) throw error;

  // Touch last_active_at on the session
  await supabase
    .from('chat_sessions')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', sessionId);

  return rowToStoredMessage(data);
}

export async function updateChatSession(
  id: string,
  updates: { title?: string; visibility?: 'private' | 'workspace'; model?: string; isGenerating?: boolean; pinned?: boolean }
): Promise<ChatSession | null> {
  const row: Record<string, unknown> = {};
  if (updates.title !== undefined) row.title = updates.title;
  if (updates.visibility !== undefined) row.visibility = updates.visibility;
  if (updates.model !== undefined) row.model = updates.model;
  if (updates.isGenerating !== undefined) row.is_generating = updates.isGenerating;
  if (updates.pinned !== undefined) row.pinned = updates.pinned;

  const { data, error } = await supabase
    .from('chat_sessions')
    .update(row)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  // isOwner is always true here since only owners can update
  return rowToChatSession(data, data.user_id);
}

export async function deleteChatSession(id: string): Promise<void> {
  const { error } = await supabase
    .from('chat_sessions')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// SQEM-115 — delete specific messages (used to prune the tail superseded by an edit-and-resend).
// RLS (chat_messages_delete) restricts this to the caller's own / assistant messages in their own
// sessions, so a collaborator's message can never be removed here.
export async function deleteChatMessages(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase
    .from('chat_messages')
    .delete()
    .in('id', ids);

  if (error) throw error;
}

