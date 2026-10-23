import { createContext, useContext, useState, useCallback } from 'react';
import { Prompt } from '../types';
import * as promptsApi from '../lib/api/prompts';
import { fetchCanEditMany } from '../lib/api/editors';
import { applyToEditable, type BulkOutcome } from '../lib/bulkApply';

export interface PromptsState {
  prompts: Prompt[];
  addPrompt: (prompt: Prompt) => Promise<Prompt | undefined>;
  updatePrompt: (prompt: Prompt) => void;
  toggleFavorite: (prompt: Prompt) => void;
  deletePrompt: (id: string) => void;
  deletePrompts: (ids: string[]) => Promise<void>;
  duplicatePrompt: (prompt: Prompt) => void;
  /** SQEM-564 — set or clear one tag on many playbooks; only those the person may change. */
  setTagMany: (ids: string[], tag: string | null) => Promise<BulkOutcome>;
}

export const PromptsContext = createContext<PromptsState | undefined>(undefined);

export function usePromptsState(
  activeWorkspaceId: string | null,
  currentUserId: string,
  showToast: (message: string, type: 'success' | 'error' | 'info') => void,
) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);

  const addPrompt = useCallback(async (prompt: Prompt): Promise<Prompt | undefined> => {
    if (!activeWorkspaceId) return;
    try {
      const created = await promptsApi.createPrompt(prompt, activeWorkspaceId);
      setPrompts(prev => [created, ...prev]);
      return created;
    } catch (err: any) {
      showToast(err.message || 'Failed to create prompt', 'error');
    }
  }, [activeWorkspaceId, showToast]);

  const updatePrompt = useCallback(async (prompt: Prompt) => {
    if (!activeWorkspaceId) return;
    try {
      const updated = await promptsApi.updatePrompt(prompt, activeWorkspaceId);
      setPrompts(prev => prev.map(p => p.id === updated.id ? { ...updated, isFavorite: p.isFavorite } : p));
    } catch (err: any) {
      showToast(err.message || 'Failed to update prompt', 'error');
    }
  }, [activeWorkspaceId, showToast]);

  const toggleFavorite = useCallback(async (prompt: Prompt) => {
    if (!currentUserId) return;
    const newValue = !prompt.isFavorite;
    setPrompts(prev => prev.map(p => p.id === prompt.id ? { ...p, isFavorite: newValue } : p));
    try {
      await promptsApi.setFavorite(prompt.id, currentUserId, newValue);
    } catch (err: any) {
      setPrompts(prev => prev.map(p => p.id === prompt.id ? { ...p, isFavorite: prompt.isFavorite } : p));
      showToast(err.message || 'Failed to update favourite', 'error');
    }
  }, [currentUserId, showToast]);

  const deletePrompt = useCallback(async (id: string) => {
    try {
      await promptsApi.deletePrompt(id);
      setPrompts(prev => prev.filter(p => p.id !== id));
      showToast('Prompt deleted', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete prompt', 'error');
    }
  }, [showToast]);

  const deletePrompts = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const results = await Promise.allSettled(ids.map(id => promptsApi.deletePrompt(id)));
    const okIds = new Set(ids.filter((_, i) => results[i].status === 'fulfilled'));
    if (okIds.size > 0) setPrompts(prev => prev.filter(p => !okIds.has(p.id)));
    const failed = results.length - okIds.size;
    if (failed === 0) showToast(`Deleted ${okIds.size} template${okIds.size === 1 ? '' : 's'}`, 'success');
    else showToast(`Deleted ${okIds.size} of ${results.length} — ${failed} failed`, 'error');
  }, [showToast]);

  // SQEM-564 — one tag for many playbooks (or none). Checks the edit right per playbook first, writes
  // only those, and returns the outcome instead of toasting per item: the page shows one summary.
  const setTagMany = useCallback(async (ids: string[], tag: string | null): Promise<BulkOutcome> => {
    const outcome = await applyToEditable(ids, list => fetchCanEditMany('template', list), id => promptsApi.setPromptTag(id, tag));
    if (outcome.changed.length) {
      const changed = new Set(outcome.changed);
      setPrompts(prev => prev.map(p => changed.has(p.id) ? { ...p, tag } : p));
    }
    return outcome;
  }, []);

  const duplicatePrompt = useCallback(async (prompt: Prompt) => {
    if (!activeWorkspaceId) return;
    try {
      // SQEM-241 — the duplicate belongs to the person making it, not to the original's author.
      const dup = await promptsApi.duplicatePrompt(prompt, activeWorkspaceId, currentUserId);
      setPrompts(prev => [dup, ...prev]);
      showToast('Prompt duplicated', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to duplicate prompt', 'error');
    }
  }, [activeWorkspaceId, currentUserId, showToast]);

  return {
    prompts, setPrompts,
    addPrompt, updatePrompt, toggleFavorite, deletePrompt, deletePrompts, duplicatePrompt, setTagMany,
  };
}

export function usePrompts(): PromptsState {
  const ctx = useContext(PromptsContext);
  if (!ctx) throw new Error('usePrompts must be used within AppProvider');
  return ctx;
}
