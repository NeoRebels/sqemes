// Global assistants have been removed (SQEM-040).
// These stubs keep existing call-sites compiling until they are cleaned up.

export async function fetchGlobalAssistants(): Promise<never[]> {
  return [];
}

export async function createGlobalAssistant(_assistant: unknown): Promise<never> {
  throw new Error('Global assistants have been removed.');
}

export async function updateGlobalAssistant(_assistant: unknown): Promise<never> {
  throw new Error('Global assistants have been removed.');
}

export async function deleteGlobalAssistant(_id: string): Promise<void> {
  // no-op
}

export async function fetchDismissedIds(_workspaceId: string): Promise<never[]> {
  return [];
}

export async function dismissGlobalAssistant(
  _workspaceId: string,
  _globalAssistantId: string,
  _dismissedBy: string,
): Promise<void> {
  // no-op
}

export async function restoreGlobalAssistant(
  _workspaceId: string,
  _globalAssistantId: string,
): Promise<void> {
  // no-op
}
