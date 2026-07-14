import { createContext, useContext, useState, useCallback } from 'react';
import { User, Workspace, UserRole, Invitation } from '../types';
import { supabase } from '../lib/supabase';
import { setMonitoringUser, clearMonitoringUser, logError } from '../lib/monitoring';
import * as workspacesApi from '../lib/api/workspaces';
import * as membersApi from '../lib/api/members';
import * as invitationsApi from '../lib/api/invitations';

export interface WorkspaceState {
  currentUser: User;
  workspace: Workspace;
  availableWorkspaces: Workspace[];
  activeWorkspaceId: string | null;
  isSqemesAdmin: boolean;
  updateWorkspace: (updates: Partial<Workspace>) => void;
  setWorkspaceManaged: (id: string, managed: boolean) => Promise<void>;
  createWorkspace: (name: string) => void;
  switchWorkspace: (id: string) => void;
  deleteWorkspace: (id: string) => Promise<void>;
  leaveWorkspace: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
  addMember: (email: string, role: UserRole) => void;
  removeMember: (id: string) => void;
  updateMemberRole: (id: string, role: UserRole) => void;
  pendingInvitations: Invitation[];
  fetchInvitations: () => void;
  cancelInvitation: (id: string) => void;
  resendInvitation: (id: string) => void;
}

export const EMPTY_USER: User = { id: '', name: '', email: '', avatar: '', role: 'member' };
export const EMPTY_WORKSPACE: Workspace = {
  id: '', name: '', plan: 'Solo', isManaged: false, creditsUsed: 0, creditsLimit: 0,
  subscriptionStatus: null, trialEndsAt: null, cancelAtPeriodEnd: false,
  apiKeys: {}, members: [], blacklistedTerms: [], blockEmails: false, blockIban: false, blockPhone: false, tags: [], openrouterModels: [],
};

export const WorkspaceContext = createContext<WorkspaceState | undefined>(undefined);

export function useWorkspaceState(
  showToast: (message: string, type: 'success' | 'error' | 'info') => void,
  setNoWorkspace: (v: boolean) => void,
) {
  const [currentUser, setUser] = useState<User>(EMPTY_USER);
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [isSqemesAdmin, setIsSqemesAdmin] = useState(false);
  const [pendingInvitations, setPendingInvitations] = useState<Invitation[]>([]);

  const updateWorkspace = useCallback(async (updates: Partial<Workspace>) => {
    if (!activeWorkspaceId) return;
    try {
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      // SQEM-109: `plan` is billing-controlled (Stripe webhook, service role) — never written
      // from the client. Local optimistic state is still updated below via setWorkspace.
      if (updates.blacklistedTerms !== undefined) dbUpdates.blacklisted_terms = updates.blacklistedTerms;
      if (updates.blockEmails !== undefined) dbUpdates.block_emails = updates.blockEmails;
      if (updates.blockIban !== undefined) dbUpdates.block_iban = updates.blockIban;
      if (updates.blockPhone !== undefined) dbUpdates.block_phone = updates.blockPhone;
      if (updates.tags !== undefined) dbUpdates.tags = updates.tags;
      if (updates.openrouterModels !== undefined) dbUpdates.openrouter_models = updates.openrouterModels;
      if (updates.brandProfile !== undefined) dbUpdates.brand_profile = updates.brandProfile;

      if (Object.keys(dbUpdates).length > 0) {
        await workspacesApi.updateWorkspace(activeWorkspaceId, dbUpdates);
      }

      setWorkspace(prev => {
        const updated = { ...prev, ...updates };
        setAvailableWorkspaces(list => list.map(w => w.id === updated.id ? updated : w));
        return updated;
      });
    } catch (err: any) {
      showToast(err.message || 'Failed to update workspace', 'error');
    }
  }, [activeWorkspaceId, showToast]);

  const setWorkspaceManaged = useCallback(async (id: string, managed: boolean) => {
    try {
      await workspacesApi.setWorkspaceManaged(id, managed);
      setWorkspace(prev => {
        const updated = { ...prev, isManaged: managed };
        setAvailableWorkspaces(list => list.map(w => w.id === id ? updated : w));
        return updated;
      });
      showToast(managed ? 'Workspace set to Managed' : 'Managed mode disabled', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update managed status', 'error');
    }
  }, [showToast]);

  const createWorkspace = useCallback(async (name: string) => {
    try {
      const wsRow = await workspacesApi.createWorkspace(name);
      const members = await workspacesApi.fetchWorkspaceMembers(wsRow.id);
      const newWs = workspacesApi.rowToWorkspace(wsRow, members);

      setAvailableWorkspaces(prev => [...prev, newWs]);
      setWorkspace(newWs);
      setActiveWorkspaceId(newWs.id);
      setUser(prev => ({ ...prev, role: 'admin' }));
      setNoWorkspace(false);
      showToast('Workspace created', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to create workspace', 'error');
    }
  }, [showToast, setNoWorkspace]);

  const switchWorkspace = useCallback(async (id: string) => {
    const target = availableWorkspaces.find(w => w.id === id);
    if (!target || id === activeWorkspaceId) return;

    try {
      setWorkspace({ ...target, members: [] });
      setUser(prev => ({ ...prev, role: 'member' }));
      setActiveWorkspaceId(id);
      localStorage.setItem('activeWorkspaceId', id);
      localStorage.removeItem(`ws_cache_${id}`);

      const members = await workspacesApi.fetchWorkspaceMembers(id);
      const currentMember = members.find((m: any) => m.id === currentUser.id);
      setWorkspace(prev => ({ ...prev, members }));
      setUser(prev => ({ ...prev, role: currentMember?.role || 'member' }));
    } catch (err: any) {
      showToast(err.message || 'Failed to switch workspace', 'error');
    }
  }, [availableWorkspaces, activeWorkspaceId, currentUser.id, showToast]);

  const deleteWorkspace = useCallback(async (id: string) => {
    try {
      await workspacesApi.deleteWorkspace(id);
      const remaining = availableWorkspaces.filter(w => w.id !== id);
      setAvailableWorkspaces(remaining);

      if (remaining.length > 0) {
        const next = remaining[0];
        const members = await workspacesApi.fetchWorkspaceMembers(next.id);
        const currentMember = members.find((m: any) => m.id === currentUser.id);
        setWorkspace({ ...next, members });
        setActiveWorkspaceId(next.id);
        setUser(prev => ({ ...prev, role: currentMember?.role || 'member' }));
      } else {
        setNoWorkspace(true);
      }
      showToast('Workspace deleted', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete workspace', 'error');
    }
  }, [availableWorkspaces, currentUser.id, showToast, setNoWorkspace]);

  const leaveWorkspace = useCallback(async () => {
    if (!activeWorkspaceId || !currentUser.id) return;

    const wsAdmins = workspace.members.filter(m => m.role === 'admin');
    const isSoleAdmin = wsAdmins.length === 1 && wsAdmins[0].id === currentUser.id;
    if (isSoleAdmin) {
      showToast(
        'You are the only admin of this workspace. Transfer admin rights to another member or delete the workspace before leaving.',
        'error'
      );
      return;
    }

    try {
      await membersApi.removeMember(activeWorkspaceId, currentUser.id);
      const remaining = availableWorkspaces.filter(w => w.id !== activeWorkspaceId);
      setAvailableWorkspaces(remaining);

      if (remaining.length > 0) {
        const next = remaining[0];
        const members = await workspacesApi.fetchWorkspaceMembers(next.id);
        const currentMember = members.find((m: any) => m.id === currentUser.id);
        setWorkspace({ ...next, members });
        setActiveWorkspaceId(next.id);
        setUser(prev => ({ ...prev, role: currentMember?.role || 'member' }));
      } else {
        setNoWorkspace(true);
      }
      showToast('You have left the workspace', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to leave workspace', 'error');
    }
  }, [activeWorkspaceId, currentUser.id, workspace.members, availableWorkspaces, showToast, setNoWorkspace]);

  const deleteAccount = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
      const res = await fetch(`${FUNCTIONS_URL}/delete-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete account');
      }

      localStorage.removeItem('pendingInviteToken');
      localStorage.removeItem('pendingInviteEmail');
      localStorage.removeItem('pendingInviteTokenAt');
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('ws_cache_')) localStorage.removeItem(key);
      }
      clearMonitoringUser();
      await supabase.auth.signOut();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete account', 'error');
    }
  }, [showToast]);

  const updateUser = useCallback(async (updates: Partial<User>) => {
    try {
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.email !== undefined) dbUpdates.email = updates.email;
      if (updates.avatar !== undefined) dbUpdates.avatar = updates.avatar;

      if (Object.keys(dbUpdates).length > 0) {
        const { error } = await supabase.from('profiles').update(dbUpdates).eq('id', currentUser.id);
        if (error) throw error;
      }

      setUser(prev => ({ ...prev, ...updates }));
    } catch (err: any) {
      showToast(err.message || 'Failed to update profile', 'error');
    }
  }, [currentUser.id, showToast]);

  const addMember = useCallback(async (email: string, role: UserRole) => {
    if (!activeWorkspaceId) return;
    try {
      const invitation = await invitationsApi.createInvitation(
        activeWorkspaceId,
        email,
        role,
        currentUser.id,
        workspace.name,
        currentUser.name,
      );
      setPendingInvitations(prev => [invitation, ...prev]);
      if ((invitation as any).emailFailed) {
        // SQEM-112 — the invite now appears in Pending Invitations with a "Copy link" action.
        showToast(`Invitation created, but the email couldn't be sent. Use "Copy link" on the pending invitation to share it.`, 'info');
      } else {
        showToast(`Invitation sent to ${email}`, 'success');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to send invitation', 'error');
    }
  }, [activeWorkspaceId, currentUser.id, currentUser.name, workspace.name, showToast]);

  const removeMember = useCallback(async (id: string) => {
    if (!activeWorkspaceId) return;
    try {
      await membersApi.removeMember(activeWorkspaceId, id);
      setWorkspace(prev => ({
        ...prev,
        members: prev.members.filter(m => m.id !== id),
      }));
      showToast('Member removed', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to remove member', 'error');
    }
  }, [activeWorkspaceId, showToast]);

  const updateMemberRole = useCallback(async (id: string, role: UserRole) => {
    if (!activeWorkspaceId) return;
    try {
      await membersApi.updateMemberRole(activeWorkspaceId, id, role);
      setWorkspace(prev => ({
        ...prev,
        members: prev.members.map(m => m.id === id ? { ...m, role } : m),
      }));
      showToast('Role updated', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update role', 'error');
    }
  }, [activeWorkspaceId, showToast]);

  const fetchInvitations = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      const invitations = await invitationsApi.fetchPendingInvitations(activeWorkspaceId);
      setPendingInvitations(invitations);
    } catch (err: any) {
      logError(err instanceof Error ? err : new Error(String(err)), { context: 'fetchInvitations' });
    }
  }, [activeWorkspaceId]);

  const cancelInvitation = useCallback(async (id: string) => {
    try {
      await invitationsApi.cancelInvitation(id);
      setPendingInvitations(prev => prev.filter(inv => inv.id !== id));
      showToast('Invitation cancelled', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to cancel invitation', 'error');
    }
  }, [showToast]);

  const resendInvitation = useCallback(async (id: string) => {
    const invite = pendingInvitations.find(inv => inv.id === id);
    try {
      const updated = await invitationsApi.resendInvitation(id, currentUser.name);
      setPendingInvitations(prev => prev.map(inv => inv.id === id ? updated : inv));
      showToast(`Invite resent to ${invite?.email ?? 'user'}`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to resend invitation', 'error');
    }
  }, [pendingInvitations, currentUser.name, showToast]);

  return {
    currentUser, setUser,
    workspace, setWorkspace,
    availableWorkspaces, setAvailableWorkspaces,
    activeWorkspaceId, setActiveWorkspaceId,
    isSqemesAdmin, setIsSqemesAdmin,
    pendingInvitations, setPendingInvitations,
    updateWorkspace, setWorkspaceManaged, createWorkspace, switchWorkspace,
    deleteWorkspace, leaveWorkspace, deleteAccount, updateUser,
    addMember, removeMember, updateMemberRole,
    fetchInvitations, cancelInvitation, resendInvitation,
  };
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within AppProvider');
  return ctx;
}
