import { createContext, useContext } from 'react';
import { ChatSession } from '../types';

// SQEM-013 — chat sessions split out of DataContext. `chatSessions` updates on every message and
// every realtime `chat_sessions` echo (high frequency), but only Chat + RecentChatsWidget read it;
// the other 6 DataContext consumers (files/library/skills) were re-rendering on every chat update.
// State still lives in useDataState — this is just a separate delivery context so those consumers
// no longer re-render on chat activity. (The value is assembled in store/index.tsx.)
export interface ChatSessionsState {
  chatSessions: ChatSession[];
  addChatSession: (session: ChatSession) => void;
  updateChatSession: (id: string, updates: { title?: string; visibility?: 'private' | 'workspace'; model?: string; isGenerating?: boolean; pinned?: boolean }) => Promise<void>;
  deleteChatSession: (id: string) => Promise<void>;
}

export const ChatSessionsContext = createContext<ChatSessionsState | undefined>(undefined);

export function useChatSessions(): ChatSessionsState {
  const ctx = useContext(ChatSessionsContext);
  if (!ctx) throw new Error('useChatSessions must be used within AppProvider');
  return ctx;
}
