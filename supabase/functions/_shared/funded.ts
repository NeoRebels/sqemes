// SQEM-082 — the Sqemes-funded model. Direct Mistral (EU/GDPR — `api.mistral.ai`,
// no OpenRouter/US hop) on a single cheap model, metered against the workspace's
// monthly AI-credit allowance. Shared by execute-step (authoring) and chat-message
// (chat + the editor test panel) so there is one source of truth.
export const FUNDED_MODEL = 'mistral-small-latest';
