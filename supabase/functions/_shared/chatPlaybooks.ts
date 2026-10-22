/**
 * SQEM-551 — the one number the chat function and the client share about "Used" chips: how many
 * loaded playbooks an answer records. Matches the CHECK on `chat_messages.loaded_template_ids`
 * (migration 20261021213000). Lives here because the client may import from `_shared` (as it does
 * `chatTimeouts.ts`), while an edge function cannot import from `lib/`.
 */
export const MAX_LOADED_IDS = 20;
