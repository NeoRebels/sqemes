// SQEM-621 — "Who can edit" for several playbooks or personas at once.
//
// Pure, so the rule can be tested without the database. It mirrors what the editor writes for ONE item
// (`saveEditors` in PersonaEditor / TemplateEditor, SQEM-473): "only selected people" with nobody named
// writes that item's own OWNER as the single editor — no row would mean "no restriction". The owner is
// per item, not the person running the action.
import type { TemplateAccessValue } from '../components/TemplateAccessControl';
import type { Editors } from './api/editors';

export function editorsForItem(value: TemplateAccessValue, ownerId: string | null, actorId: string): Editors {
  if (value.mode !== 'restricted') return { userIds: [], groupIds: [] };
  const named = { userIds: [...value.userIds], groupIds: [...(value.groupIds ?? [])] };
  if (named.userIds.length === 0 && named.groupIds.length === 0) named.userIds = [ownerId || actorId];
  return named;
}
