// Self-host STUB (SQEM-589). One-click connector apps are a sqemes Cloud feature and are not part of this
// distribution: the public export replaces the Cloud tile list with this EMPTY one. Settings → Connectors
// shows one line pointing to sqemes Cloud instead; custom MCP connectors work as usual.
//
// ⛔ The exports must match the Cloud module's (names and types), or the public `npm run typecheck`
// fails — `tests/types/publishStubs.tsx` renders the stubs against their originals (SQEM-411).
import type { ComponentType, ReactElement } from 'react';

type Icon = ComponentType<{ className?: string }>;
export type OAuthApp = { id: string; provider: string; name: string; description: string; auth: 'oauth'; Icon: Icon; unavailable?: string };
export type PublicAppUI = { id: string; provider: string; name: string; description: string; auth: 'public'; Icon: Icon; hostLabel: string; placeholder: string; help: string; path: string; unavailable?: string };
export type OAuthIdAppUI = { id: string; provider: string; name: string; description: string; auth: 'oauth-id'; Icon: Icon; tokenLabel: string; placeholder: string; help: string; unavailable?: string; needsRedirectUri?: boolean; secretLabel?: string; secretOptional?: boolean };
export type TokenAppUI = { id: string; provider: string; name: string; description: string; auth: 'token'; Icon: Icon; tokenLabel: string; placeholder: string; help: string; needsShop?: boolean; needsSecret?: boolean; secretLabel?: string; secretOptional?: boolean; unavailable?: string };
export type AppTile = OAuthApp | TokenAppUI | OAuthIdAppUI | PublicAppUI;

export const GOOGLE_PENDING_REVIEW = '';
export const GOOGLE_TESTING_NOTE = '';
export const OAUTH_APPS: AppTile[] = [];
export const TILE_TEXT_DE: Record<string, string> = {};

/** No tiles, no tile texts (SQEM-615). */
export function tileText(text: string | undefined): string {
  return text ?? '';
}

/** No app logos ship with self-host; custom connectors show their site's favicon instead. */
export function appLogoForMcpUrl(_url: string, _className: string): ReactElement | null {
  return null;
}
