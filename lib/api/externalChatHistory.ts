// SQEM-085 — webapp read/write of the extension's external chat history (per-user, RLS).
// Same table the extension uses (source of truth), so pins + list stay in sync across
// the Dashboard widget and the extension drawer.
import { supabase } from '../supabase';

export interface ExternalChat {
  id: string;
  platform: string; // chatgpt | claude | gemini | grok | deepseek | perplexity
  title: string;
  url: string;
  pinned: boolean;
  lastSeenAt: string;
}

export async function fetchExternalChatHistory(): Promise<ExternalChat[]> {
  const { data, error } = await supabase
    .from('external_chat_history')
    .select('id, platform, title, url, pinned, last_seen_at')
    .order('last_seen_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map(r => ({
    id: r.id, platform: r.platform, title: r.title, url: r.url, pinned: r.pinned, lastSeenAt: r.last_seen_at,
  }));
}

export async function setExternalChatPinned(id: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.from('external_chat_history').update({ pinned }).eq('id', id);
  if (error) throw error;
}
