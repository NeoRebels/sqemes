import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { setMonitoringUser, clearMonitoringUser, logError } from '../lib/monitoring';
import * as workspacesApi from '../lib/api/workspaces';
import * as promptsApi from '../lib/api/prompts';
import type { PromptRow } from '../lib/api/prompts';
import * as assistantsApi from '../lib/api/assistants';
import * as libraryApi from '../lib/api/library';
import * as chatSessionsApi from '../lib/api/chatSessions';
import type { ChatSessionRow } from '../lib/api/chatSessions';
import * as invitationsApi from '../lib/api/invitations';
import { getApiKeyStatus } from '../lib/api/apiKeys';
import * as filesApi from '../lib/api/files';
import { CACHE_VERSION, CACHE_TTL_MS } from '../constants';

import { UIContext, ToastContext, useUIState, useUI as useUIHook, useToast as useToastHook } from './ui';
import { WorkspaceContext, useWorkspaceState, useWorkspace as useWorkspaceHook } from './workspace';
import { PromptsContext, usePromptsState, usePrompts as usePromptsHook } from './prompts';
import { DataContext, useDataState, useData as useDataHook } from './data';
import { ChatSessionsContext, useChatSessions as useChatSessionsHook } from './chatSessions';

export { useUI, useToast } from './ui';
export { useWorkspace } from './workspace';
export { usePrompts } from './prompts';
export { useData } from './data';
export { useChatSessions } from './chatSessions';

export type { UIState, ToastState } from './ui';
export type { WorkspaceState } from './workspace';
export type { PromptsState } from './prompts';
export type { DataState } from './data';
export type { ChatSessionsState } from './chatSessions';

export const AppProvider = ({ children }: React.PropsWithChildren<{}>) => {
  // ---- Domain state hooks ----
  const ui = useUIState();
  const ws = useWorkspaceState(ui.showToast, ui.setNoWorkspace);
  const pr = usePromptsState(ws.activeWorkspaceId, ws.currentUser.id, ui.showToast);
  const da = useDataState(ws.activeWorkspaceId, ws.currentUser, ui.showToast);

  const initialDataLoaded = useRef(false);
  const noWorkspaceRef = useRef(ui.noWorkspace);
  const activeWsRef = useRef(ws.activeWorkspaceId);
  noWorkspaceRef.current = ui.noWorkspace;
  activeWsRef.current = ws.activeWorkspaceId;

  // ---- Initial load: fetch user profile + workspaces ----
  const init = useCallback(async () => {
    let workspaceDataWillLoad = false;
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        ui.setNoWorkspace(true);
        return;
      }

      const [profileResult, wsRowsResult] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', authUser.id).single(),
        workspacesApi.fetchUserWorkspaces()
          .then(rows => ({ rows, error: null as Error | null }))
          .catch(err => ({ rows: [] as Awaited<ReturnType<typeof workspacesApi.fetchUserWorkspaces>>, error: err as Error })),
      ]);

      const { data: profile, error: profileError } = profileResult;
      if (profileError || !profile) {
        logError(profileError ?? new Error('Profile not found'), { context: 'init:fetchProfile' });
        clearMonitoringUser();
        return;
      }

      ws.setUser({
        id: profile.id,
        name: profile.name,
        email: profile.email,
        avatar: profile.avatar,
        role: 'member',
      });
      setMonitoringUser(profile.id, profile.email);
      ws.setIsSqemesAdmin(!!profile.is_sqemes_admin);

      const pendingToken = localStorage.getItem('pendingInviteToken');
      const pendingTokenAt = localStorage.getItem('pendingInviteTokenAt');
      let wsRows = wsRowsResult.rows;
      if (pendingToken) {
        const isExpired = pendingTokenAt && Date.now() - parseInt(pendingTokenAt, 10) > 86_400_000;
        if (isExpired) {
          localStorage.removeItem('pendingInviteToken');
          localStorage.removeItem('pendingInviteEmail');
          localStorage.removeItem('pendingInviteTokenAt');
          ui.showToast('Invite link has expired. Please request a new invitation.', 'error');
        } else {
          try {
            await invitationsApi.acceptInvitation(pendingToken);
            wsRows = await workspacesApi.fetchUserWorkspaces();
          } catch (err: any) {
            const msg: string = err?.message || '';
            const isTerminal =
              msg.includes('already been') ||
              msg.includes('Invitation not found') ||
              msg.includes('expired');
            if (!isTerminal) {
              logError(err instanceof Error ? err : new Error(String(err)), { context: 'init:acceptInvitation' });
              ui.showToast('Failed to accept invitation. Try visiting the invite link again.', 'error');
            }
          } finally {
            localStorage.removeItem('pendingInviteToken');
            localStorage.removeItem('pendingInviteEmail');
            localStorage.removeItem('pendingInviteTokenAt');
          }
        }
      } else if (wsRowsResult.error) {
        logError(wsRowsResult.error instanceof Error ? wsRowsResult.error : new Error(String(wsRowsResult.error)), { context: 'init:fetchWorkspaces' });
        ui.showToast((wsRowsResult.error as any).message || 'Failed to load workspaces', 'error');
        return;
      }

      if (wsRows.length === 0) {
        ui.setNoWorkspace(true);
        return;
      }

      const savedId = localStorage.getItem('activeWorkspaceId');
      const firstWsId = (savedId && wsRows.find(w => w.id === savedId))
        ? savedId
        : wsRows[0].id;
      const members = await workspacesApi.fetchWorkspaceMembers(firstWsId);
      const currentMember = members.find((m: any) => m.id === authUser.id);

      ws.setUser(prev => ({
        ...prev,
        role: currentMember?.role || 'member',
      }));

      const workspacesList = wsRows.map(r => workspacesApi.rowToWorkspace(r));
      ws.setAvailableWorkspaces(workspacesList);
      const activeRow = wsRows.find(w => w.id === firstWsId) ?? wsRows[0];
      ws.setWorkspace(workspacesApi.rowToWorkspace(activeRow, members));
      ws.setActiveWorkspaceId(firstWsId);
      ui.setNoWorkspace(false);
      workspaceDataWillLoad = true;
    } catch (err: any) {
      logError(err instanceof Error ? err : new Error(String(err)), { context: 'init' });
      ui.showToast(err.message || 'Failed to initialize', 'error');
    } finally {
      if (!workspaceDataWillLoad) ui.setIsLoading(false);
    }
  }, [ui.showToast]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        if (noWorkspaceRef.current || !activeWsRef.current) {
          ui.setIsLoading(true);
          init();
        }
      }
    });
    return () => subscription.unsubscribe();
  }, [init]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Load workspace data when activeWorkspaceId changes ----
  useEffect(() => {
    if (!ws.activeWorkspaceId) return;

    const wsId = ws.activeWorkspaceId;

    const loadWorkspaceData = async () => {
      const cacheKey = `ws_cache_${wsId}`;
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const cached = JSON.parse(raw);
          const age = Date.now() - cached.cachedAt;
          if (cached.version !== CACHE_VERSION || age >= CACHE_TTL_MS) {
            localStorage.removeItem(cacheKey);
          } else {
            pr.setPrompts(cached.prompts);
            da.setAssistants(cached.assistants);
            da.setChatSessions(cached.chatSessions ?? []);
            if (!initialDataLoaded.current) {
              initialDataLoaded.current = true;
              ui.setIsLoading(false);
            }
          }
        }
      } catch {
        localStorage.removeItem(cacheKey);
      }

      ui.setIsBackgroundFetching(true);
      try {
        const [promptsData, assistantsData, libraryData, chatSessionsData, workspaceFilesData, skillsData, favoriteIds] = await Promise.all([
          promptsApi.fetchPrompts(wsId, ws.currentUser.id),
          assistantsApi.fetchAssistants(wsId),
          libraryApi.fetchLibraryTemplates().catch(() => []),
          chatSessionsApi.fetchChatSessions(wsId, ws.currentUser.id).catch(() => [] as Awaited<ReturnType<typeof chatSessionsApi.fetchChatSessions>>),
          filesApi.fetchWorkspaceFiles(wsId).catch(() => []),
          promptsApi.fetchSkills(wsId).catch(() => []),
          promptsApi.fetchFavoriteIds(ws.currentUser.id).catch(() => new Set<string>()),
        ]);

        if (wsId !== activeWsRef.current) return;

        // SQEM-087 — favourites are per-user across all kinds; fetchPrompts wires them for
        // prompts, but skills/assistants come from fetchers that don't, so apply here too.
        const favSkills = skillsData.map(p => ({ ...p, isFavorite: favoriteIds.has(p.id) }));
        const favAssistants = assistantsData.map(p => ({ ...p, isFavorite: favoriteIds.has(p.id) }));

        pr.setPrompts([...promptsData, ...favSkills, ...favAssistants]);
        da.setAssistants(favAssistants);
        da.setLibraryTemplates(libraryData);
        da.setChatSessions(chatSessionsData);
        da.setWorkspaceFiles(workspaceFilesData);
        da.setSkills(favSkills);

        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            version: CACHE_VERSION,
            cachedAt: Date.now(),
            prompts: [...promptsData, ...skillsData, ...assistantsData],
            assistants: assistantsData,
            chatSessions: chatSessionsData,
          }));
        } catch { /* storage quota exceeded — ignore */ }

        ui.setIsBackgroundFetching(false);

        if (!initialDataLoaded.current) {
          initialDataLoaded.current = true;
          ui.setIsLoading(false);
        }

        getApiKeyStatus(wsId).then(({ keys: apiKeyStatus, fundedAvailable }) => {
          if (wsId !== activeWsRef.current) return;
          const apiKeys: Record<string, string> = {};
          for (const [provider, configured] of Object.entries(apiKeyStatus)) {
            if (configured) apiKeys[provider] = '••••••••';
          }
          ws.setWorkspace(prev => ({ ...prev, apiKeys, fundedAvailable }));
        }).catch(() => {/* non-critical */});

      } catch (err) {
        ui.setIsBackgroundFetching(false);
        logError(err instanceof Error ? err : new Error(String(err)), { context: 'loadWorkspaceData' });
        ui.showToast('Failed to load workspace data', 'error');
        if (!initialDataLoaded.current) {
          initialDataLoaded.current = true;
          ui.setIsLoading(false);
        }
      }
    };

    loadWorkspaceData();
  }, [ws.activeWorkspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Realtime subscriptions ----
  useEffect(() => {
    if (!ws.activeWorkspaceId) return;

    const wsId = ws.activeWorkspaceId;

    const promptsSub = supabase
      .channel(`prompts:${wsId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'prompts',
        filter: `workspace_id=eq.${wsId}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const item = promptsApi.rowToPrompt(payload.new as unknown as PromptRow);
          pr.setPrompts(prev => prev.some(p => p.id === item.id) ? prev : [item, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          const item = promptsApi.rowToPrompt(payload.new as unknown as PromptRow);
          pr.setPrompts(prev => prev.map(p => p.id === item.id ? item : p));
        } else if (payload.eventType === 'DELETE') {
          pr.setPrompts(prev => prev.filter(p => p.id !== payload.old.id));
        }
      })
      .subscribe();

    const chatSessionsSub = supabase
      .channel(`chat_sessions:${wsId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_sessions',
        filter: `workspace_id=eq.${wsId}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const session = chatSessionsApi.rowToChatSessionPublic(payload.new as unknown as ChatSessionRow, ws.currentUser.id);
          da.setChatSessions(prev => prev.some(s => s.id === session.id) ? prev : [session, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          const session = chatSessionsApi.rowToChatSessionPublic(payload.new as unknown as ChatSessionRow, ws.currentUser.id);
          da.setChatSessions(prev => prev.map(s => s.id === session.id ? session : s));
        } else if (payload.eventType === 'DELETE') {
          da.setChatSessions(prev => prev.filter(s => s.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(promptsSub);
      supabase.removeChannel(chatSessionsSub);
    };
  }, [ws.activeWorkspaceId, ws.currentUser.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Memoized context values ----
  const uiValue = useMemo(() => ({
    showToast: ui.showToast,
    isLoading: ui.isLoading, isBackgroundFetching: ui.isBackgroundFetching, noWorkspace: ui.noWorkspace,
    theme: ui.theme, setTheme: ui.setTheme, toggleTheme: ui.toggleTheme,
  }), [ui.showToast, ui.isLoading, ui.isBackgroundFetching, ui.noWorkspace, ui.theme, ui.setTheme, ui.toggleTheme]);

  // SQEM-013 — toast display state, consumed only by App.tsx's renderer. Changes on show/hide/
  // pause/resume; isolated so it doesn't re-render the ~12 components that only call showToast.
  const toastValue = useMemo(() => ({
    toast: ui.toast, hideToast: ui.hideToast, pauseToast: ui.pauseToast, resumeToast: ui.resumeToast,
  }), [ui.toast, ui.hideToast, ui.pauseToast, ui.resumeToast]);

  const workspaceValue = useMemo(() => ({
    currentUser: ws.currentUser, workspace: ws.workspace,
    availableWorkspaces: ws.availableWorkspaces, activeWorkspaceId: ws.activeWorkspaceId,
    isSqemesAdmin: ws.isSqemesAdmin,
    updateWorkspace: ws.updateWorkspace, setWorkspaceManaged: ws.setWorkspaceManaged,
    createWorkspace: ws.createWorkspace, switchWorkspace: ws.switchWorkspace,
    deleteWorkspace: ws.deleteWorkspace, leaveWorkspace: ws.leaveWorkspace,
    deleteAccount: ws.deleteAccount, updateUser: ws.updateUser,
    addMember: ws.addMember, removeMember: ws.removeMember, updateMemberRole: ws.updateMemberRole,
    pendingInvitations: ws.pendingInvitations, fetchInvitations: ws.fetchInvitations,
    cancelInvitation: ws.cancelInvitation, resendInvitation: ws.resendInvitation,
  }), [
    ws.currentUser, ws.workspace, ws.availableWorkspaces, ws.activeWorkspaceId, ws.isSqemesAdmin,
    ws.updateWorkspace, ws.setWorkspaceManaged, ws.createWorkspace, ws.switchWorkspace,
    ws.deleteWorkspace, ws.leaveWorkspace, ws.deleteAccount, ws.updateUser,
    ws.addMember, ws.removeMember, ws.updateMemberRole,
    ws.pendingInvitations, ws.fetchInvitations, ws.cancelInvitation, ws.resendInvitation,
  ]);

  const promptsValue = useMemo(() => ({
    prompts: pr.prompts,
    addPrompt: pr.addPrompt, updatePrompt: pr.updatePrompt, toggleFavorite: pr.toggleFavorite,
    deletePrompt: pr.deletePrompt, deletePrompts: pr.deletePrompts, duplicatePrompt: pr.duplicatePrompt,
  }), [pr.prompts, pr.addPrompt, pr.updatePrompt, pr.toggleFavorite, pr.deletePrompt, pr.deletePrompts, pr.duplicatePrompt]);

  const dataValue = useMemo(() => ({
    assistants: da.assistants,
    libraryTemplates: da.libraryTemplates, fetchLibraryTemplates: da.fetchLibraryTemplates,
    addLibraryTemplate: da.addLibraryTemplate, updateLibraryTemplate: da.updateLibraryTemplate,
    deleteLibraryTemplate: da.deleteLibraryTemplate, copyTemplateToWorkspace: da.copyTemplateToWorkspace,
    workspaceFiles: da.workspaceFiles, addWorkspaceFile: da.addWorkspaceFile,
    patchWorkspaceFile: da.patchWorkspaceFile, removeWorkspaceFile: da.removeWorkspaceFile,
    removeWorkspaceFiles: da.removeWorkspaceFiles,
    skills: da.skills,
  }), [
    da.assistants,
    da.libraryTemplates, da.fetchLibraryTemplates, da.addLibraryTemplate,
    da.updateLibraryTemplate, da.deleteLibraryTemplate, da.copyTemplateToWorkspace,
    da.workspaceFiles, da.addWorkspaceFile, da.patchWorkspaceFile, da.removeWorkspaceFile,
    da.removeWorkspaceFiles,
    da.skills,
  ]);

  // SQEM-013 — chat sessions in their own context. High-frequency (message + realtime echo), read
  // only by Chat + RecentChatsWidget; separated so it no longer re-renders the file/library/skill
  // consumers of DataContext. State stays in useDataState (subscriptions above still drive it).
  const chatSessionsValue = useMemo(() => ({
    chatSessions: da.chatSessions, addChatSession: da.addChatSession,
    updateChatSession: da.updateChatSession, deleteChatSession: da.deleteChatSession,
  }), [da.chatSessions, da.addChatSession, da.updateChatSession, da.deleteChatSession]);

  return (
    <UIContext.Provider value={uiValue}>
      <ToastContext.Provider value={toastValue}>
        <WorkspaceContext.Provider value={workspaceValue}>
          <PromptsContext.Provider value={promptsValue}>
            <DataContext.Provider value={dataValue}>
              <ChatSessionsContext.Provider value={chatSessionsValue}>
                {children}
              </ChatSessionsContext.Provider>
            </DataContext.Provider>
          </PromptsContext.Provider>
        </WorkspaceContext.Provider>
      </ToastContext.Provider>
    </UIContext.Provider>
  );
};

/** @deprecated Use specific hooks: useUI, useToast, useWorkspace, usePrompts, useData, useChatSessions */
export const useStore = () => ({
  ...useUIHook(),
  ...useToastHook(),
  ...useWorkspaceHook(),
  ...usePromptsHook(),
  ...useDataHook(),
  ...useChatSessionsHook(),
});
