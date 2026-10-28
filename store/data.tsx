import { createContext, useContext, useState, useCallback } from 'react';
import { Prompt, LibraryTemplate, ChatSession, User, WorkspaceFile } from '../types';
import { logError } from '../lib/monitoring';
import { m } from '../lib/i18n';
import * as libraryApi from '../lib/api/library';
import * as chatSessionsApi from '../lib/api/chatSessions';
import * as filesApi from '../lib/api/files';

export interface DataState {
  libraryTemplates: LibraryTemplate[];
  fetchLibraryTemplates: () => void;
  addLibraryTemplate: (template: LibraryTemplate) => Promise<LibraryTemplate | undefined>;
  /** SQEM-606 — false when the save failed (the store has already said so). */
  updateLibraryTemplate: (template: LibraryTemplate) => Promise<boolean>;
  deleteLibraryTemplate: (id: string) => Promise<void>;
  copyTemplateToWorkspace: (templateId: string) => Promise<string | undefined>;
  // SQEM-013 — chatSessions + its methods moved to ChatSessionsContext (see store/chatSessions.tsx).
  workspaceFiles: WorkspaceFile[];
  addWorkspaceFile: (file: WorkspaceFile) => void;
  patchWorkspaceFile: (id: string, patch: Partial<WorkspaceFile>) => void;
  removeWorkspaceFile: (id: string) => Promise<void>;
  removeWorkspaceFiles: (ids: string[]) => Promise<void>;
  /** SQEM-561 — replace the list after a change made elsewhere (Chat's library tools); no API call. */
  setWorkspaceFiles: (files: WorkspaceFile[]) => void;
  skills: Prompt[];
}

export const DataContext = createContext<DataState | undefined>(undefined);

export function useDataState(
  activeWorkspaceId: string | null,
  currentUser: User,
  showToast: (message: string, type: 'success' | 'error' | 'info') => void,
) {
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
      showToast(err.message || m.pb_create_failed(), 'error');
    }
  }, [showToast]);

  const updateLibraryTemplateAction = useCallback(async (template: LibraryTemplate): Promise<boolean> => {
    try {
      const updated = await libraryApi.updateLibraryTemplate(template);
      setLibraryTemplates(prev => prev.map(t => t.id === updated.id ? updated : t));
      return true;
    } catch (err: any) {
      showToast(err.message || m.pb_update_failed(), 'error');
      return false;
    }
  }, [showToast]);

  const deleteLibraryTemplateAction = useCallback(async (id: string) => {
    try {
      await libraryApi.deleteLibraryTemplate(id);
      setLibraryTemplates(prev => prev.filter(t => t.id !== id));
      showToast(m.pb_deleted(), 'success');
    } catch (err: any) {
      showToast(err.message || m.pb_delete_failed(), 'error');
    }
  }, [showToast]);

  const copyTemplateToWorkspaceAction = useCallback(async (templateId: string): Promise<string | undefined> => {
    if (!activeWorkspaceId) return;
    try {
      const promptId = await libraryApi.copyTemplateToWorkspace(templateId, activeWorkspaceId, currentUser.id);
      setLibraryTemplates(prev => prev.map(t =>
        t.id === templateId ? { ...t, usageCount: t.usageCount + 1 } : t
      ));
      showToast(m.lib_copied(), 'success');
      return promptId;
    } catch (err: any) {
      showToast(err.message || m.lib_copy_failed(), 'error');
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
      showToast(m.fi_deleted(), 'success');
    } catch (err: any) {
      showToast(err.message || m.fi_delete_failed(), 'error');
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
    if (failed === 0) showToast(m.fi_deleted_many({ files: m.count_file({ count: okIds.size }) }), 'success');
    else showToast(m.ps_deleted_partial({ done: okIds.size, total: results.length, failed }), 'error');
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
      showToast(err.message || m.chat_update_failed(), 'error');
    }
  }, [showToast]);

  const deleteChatSession = useCallback(async (id: string) => {
    try {
      await chatSessionsApi.deleteChatSession(id);
      setChatSessions(prev => prev.filter(s => s.id !== id));
      showToast(m.chat_deleted_toast(), 'success');
    } catch (err: any) {
      showToast(err.message || m.chat_delete_failed(), 'error');
    }
  }, [showToast]);

  // SQEM-576 — bulk delete from History. In parallel, every result counted; only what was really
  // deleted leaves the list, and the page shows ONE toast instead of one per chat.
  const deleteChatSessions = useCallback(async (ids: string[]) => {
    const results = await Promise.allSettled(ids.map(id => chatSessionsApi.deleteChatSession(id)));
    const done = new Set(ids.filter((_, i) => results[i].status === 'fulfilled'));
    setChatSessions(prev => prev.filter(s => !done.has(s.id)));
    return { deleted: done.size, failed: ids.length - done.size };
  }, []);

  return {
    libraryTemplates, setLibraryTemplates,
    chatSessions, setChatSessions,
    workspaceFiles, setWorkspaceFiles,
    skills, setSkills,
    fetchLibraryTemplates: fetchLibraryTemplatesAction,
    addLibraryTemplate,
    updateLibraryTemplate: updateLibraryTemplateAction,
    deleteLibraryTemplate: deleteLibraryTemplateAction,
    copyTemplateToWorkspace: copyTemplateToWorkspaceAction,
    addChatSession, updateChatSession, deleteChatSession, deleteChatSessions,
    addWorkspaceFile, patchWorkspaceFile, removeWorkspaceFile, removeWorkspaceFiles,
  };
}

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within AppProvider');
  return ctx;
}
