import { createContext, useContext, useState, useCallback } from 'react';
import { Prompt, LibraryTemplate, ChatSession, User, WorkspaceFile } from '../types';
import { logError } from '../lib/monitoring';
import * as assistantsApi from '../lib/api/assistants';
import * as libraryApi from '../lib/api/library';
import * as chatSessionsApi from '../lib/api/chatSessions';
import * as filesApi from '../lib/api/files';

export interface DataState {
  assistants: Prompt[];
  libraryTemplates: LibraryTemplate[];
  fetchLibraryTemplates: () => void;
  addLibraryTemplate: (template: LibraryTemplate) => Promise<LibraryTemplate | undefined>;
  updateLibraryTemplate: (template: LibraryTemplate) => void;
  deleteLibraryTemplate: (id: string) => void;
  copyTemplateToWorkspace: (templateId: string) => Promise<string | undefined>;
  // SQEM-013 — chatSessions + its methods moved to ChatSessionsContext (see store/chatSessions.tsx).
  workspaceFiles: WorkspaceFile[];
  addWorkspaceFile: (file: WorkspaceFile) => void;
  patchWorkspaceFile: (id: string, patch: Partial<WorkspaceFile>) => void;
  removeWorkspaceFile: (id: string) => Promise<void>;
  removeWorkspaceFiles: (ids: string[]) => Promise<void>;
  skills: Prompt[];
}

export const DataContext = createContext<DataState | undefined>(undefined);

export function useDataState(
  activeWorkspaceId: string | null,
  currentUser: User,
  showToast: (message: string, type: 'success' | 'error' | 'info') => void,
) {
  const [assistants, setAssistants] = useState<Prompt[]>([]);
  const [libraryTemplates, setLibraryTemplates] = useState<LibraryTemplate[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [skills, setSkills] = useState<Prompt[]>([]);

  // ---- Library Template actions ----
  const fetchLibraryTemplatesAction = useCallback(async () => {
    try {
      const data = await libraryApi.fetchLibraryTemplates();
      setLibraryTemplates(data);
    } catch (err: any) {
      logError(err instanceof Error ? err : new Error(String(err)), { context: 'fetchLibraryTemplates' });
    }
  }, []);

  const addLibraryTemplate = useCallback(async (template: LibraryTemplate): Promise<LibraryTemplate | undefined> => {
    try {
      const created = await libraryApi.createLibraryTemplate(template);
      setLibraryTemplates(prev => [created, ...prev]);
      return created;
    } catch (err: any) {
      showToast(err.message || 'Failed to create template', 'error');
    }
  }, [showToast]);

  const updateLibraryTemplateAction = useCallback(async (template: LibraryTemplate) => {
    try {
      const updated = await libraryApi.updateLibraryTemplate(template);
      setLibraryTemplates(prev => prev.map(t => t.id === updated.id ? updated : t));
    } catch (err: any) {
      showToast(err.message || 'Failed to update template', 'error');
    }
  }, [showToast]);

  const deleteLibraryTemplateAction = useCallback(async (id: string) => {
    try {
      await libraryApi.deleteLibraryTemplate(id);
      setLibraryTemplates(prev => prev.filter(t => t.id !== id));
      showToast('Template deleted', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete template', 'error');
    }
  }, [showToast]);

  const copyTemplateToWorkspaceAction = useCallback(async (templateId: string): Promise<string | undefined> => {
    if (!activeWorkspaceId) return;
    try {
      const promptId = await libraryApi.copyTemplateToWorkspace(templateId, activeWorkspaceId, currentUser.id);
      setLibraryTemplates(prev => prev.map(t =>
        t.id === templateId ? { ...t, usageCount: t.usageCount + 1 } : t
      ));
      showToast('Template saved to workspace', 'success');
      return promptId;
    } catch (err: any) {
      showToast(err.message || 'Failed to copy template', 'error');
    }
  }, [activeWorkspaceId, currentUser.id, showToast]);

  // ---- Workspace File actions ----
  const addWorkspaceFile = useCallback((file: WorkspaceFile) => {
    setWorkspaceFiles(prev => prev.some(f => f.id === file.id) ? prev : [file, ...prev]);
  }, []);

  const patchWorkspaceFile = useCallback((id: string, patch: Partial<WorkspaceFile>) => {
    setWorkspaceFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  }, []);

  const removeWorkspaceFile = useCallback(async (id: string) => {
    const file = workspaceFiles.find(f => f.id === id);
    if (!file) return;
    try {
      await filesApi.deleteWorkspaceFile(id, file.storagePath);
      setWorkspaceFiles(prev => prev.filter(f => f.id !== id));
      showToast('File deleted', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete file', 'error');
    }
  }, [workspaceFiles, showToast]);

  const removeWorkspaceFiles = useCallback(async (ids: string[]) => {
    const targets = workspaceFiles.filter(f => ids.includes(f.id));
    if (targets.length === 0) return;
    const results = await Promise.allSettled(
      targets.map(f => filesApi.deleteWorkspaceFile(f.id, f.storagePath))
    );
    const okIds = new Set(targets.filter((_, i) => results[i].status === 'fulfilled').map(f => f.id));
    if (okIds.size > 0) setWorkspaceFiles(prev => prev.filter(f => !okIds.has(f.id)));
    const failed = results.length - okIds.size;
    if (failed === 0) showToast(`Deleted ${okIds.size} file${okIds.size === 1 ? '' : 's'}`, 'success');
    else showToast(`Deleted ${okIds.size} of ${results.length} — ${failed} failed`, 'error');
  }, [workspaceFiles, showToast]);

  // ---- Chat Session actions ----
  const addChatSession = useCallback((session: ChatSession) => {
    setChatSessions(prev => prev.some(s => s.id === session.id) ? prev : [session, ...prev]);
  }, []);

  const updateChatSession = useCallback(async (id: string, updates: { title?: string; visibility?: 'private' | 'workspace'; model?: string; isGenerating?: boolean; pinned?: boolean }) => {
    try {
      const updated = await chatSessionsApi.updateChatSession(id, updates);
      if (updated) setChatSessions(prev => prev.map(s => s.id === id ? updated : s));
    } catch (err: any) {
      showToast(err.message || 'Failed to update chat', 'error');
    }
  }, [showToast]);

  const deleteChatSession = useCallback(async (id: string) => {
    try {
      await chatSessionsApi.deleteChatSession(id);
      setChatSessions(prev => prev.filter(s => s.id !== id));
      showToast('Chat deleted', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete chat', 'error');
    }
  }, [showToast]);

  return {
    assistants, setAssistants,
    libraryTemplates, setLibraryTemplates,
    chatSessions, setChatSessions,
    workspaceFiles, setWorkspaceFiles,
    skills, setSkills,
    fetchLibraryTemplates: fetchLibraryTemplatesAction,
    addLibraryTemplate,
    updateLibraryTemplate: updateLibraryTemplateAction,
    deleteLibraryTemplate: deleteLibraryTemplateAction,
    copyTemplateToWorkspace: copyTemplateToWorkspaceAction,
    addChatSession, updateChatSession, deleteChatSession,
    addWorkspaceFile, patchWorkspaceFile, removeWorkspaceFile, removeWorkspaceFiles,
  };
}

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within AppProvider');
  return ctx;
}
