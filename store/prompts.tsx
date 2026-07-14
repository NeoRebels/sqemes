import { createContext, useContext, useState, useCallback } from 'react';
import { Prompt } from '../types';
import * as promptsApi from '../lib/api/prompts';

export interface PromptsState {
  prompts: Prompt[];
  addPrompt: (prompt: Prompt) => Promise<Prompt | undefined>;
  updatePrompt: (prompt: Prompt) => void;
  toggleFavorite: (prompt: Prompt) => void;
  deletePrompt: (id: string) => void;
  deletePrompts: (ids: string[]) => Promise<void>;
  duplicatePrompt: (prompt: Prompt) => void;
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

  const duplicatePrompt = useCallback(async (prompt: Prompt) => {
    if (!activeWorkspaceId) return;
    try {
      const dup = await promptsApi.duplicatePrompt(prompt, activeWorkspaceId);
      setPrompts(prev => [dup, ...prev]);
      showToast('Prompt duplicated', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to duplicate prompt', 'error');
    }
  }, [activeWorkspaceId, showToast]);

  return {
    prompts, setPrompts,
    addPrompt, updatePrompt, toggleFavorite, deletePrompt, deletePrompts, duplicatePrompt,
  };
}

export function usePrompts(): PromptsState {
  const ctx = useContext(PromptsContext);
  if (!ctx) throw new Error('usePrompts must be used within AppProvider');
  return ctx;
}
