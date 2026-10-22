/**
 * SQEM-552 — "Needs attention" on the Manage Overview (redesign C).
 * Computed in the browser from data the page already has — no new backend.
 *
 * ⛔ At most these three kinds, each one item with a count, so the box stays worth reading. A list
 * that always has something in it is a list nobody looks at; when nothing applies it says "All set".
 * New kinds are a product decision, not a line added in passing.
 *
 * Pure (no store, no Supabase), so the rules are unit-tested directly.
 */
export type AttentionKind = 'persona-without-playbooks' | 'playbook-without-description' | 'chat-without-model';

export type AttentionItem = {
  kind: AttentionKind;
  count: number;
  title: string;
  detail: string;
  actionLabel: string;
  /** Route to fix it; for the model the Settings tab is passed as router state by the page. */
  to: string;
};

export function needsAttention(input: {
  personas: { routes?: unknown[] }[];
  playbooks: { description?: string | null }[];
  hasUsableModel: boolean;
  /** Only someone who may add a key gets the model item (SQEM-536: members cannot act on it). */
  canManageKeys: boolean;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  const emptyPersonas = input.personas.filter(p => !p.routes || p.routes.length === 0).length;
  if (emptyPersonas > 0) {
    items.push({
      kind: 'persona-without-playbooks',
      count: emptyPersonas,
      title: emptyPersonas === 1 ? '1 persona loads no playbooks' : `${emptyPersonas} personas load no playbooks`,
      detail: 'Without a playbook a persona is a role description and nothing else.',
      actionLabel: 'Fix',
      to: '/personas',
    });
  }

  const undescribed = input.playbooks.filter(p => !(p.description || '').trim()).length;
  if (undescribed > 0) {
    items.push({
      kind: 'playbook-without-description',
      count: undescribed,
      title: undescribed === 1 ? '1 playbook has no description' : `${undescribed} playbooks have no description`,
      detail: 'Members and AI tools cannot tell it apart in search.',
      actionLabel: 'Review',
      to: '/playbooks',
    });
  }

  if (!input.hasUsableModel && input.canManageKeys) {
    items.push({
      kind: 'chat-without-model',
      count: 1,
      title: 'Chat has no AI model',
      detail: 'Add a provider key so the team can chat.',
      actionLabel: 'Add key',
      to: '/settings',
    });
  }

  return items;
}
