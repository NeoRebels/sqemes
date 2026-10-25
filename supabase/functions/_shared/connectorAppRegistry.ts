// Self-host STUB (SQEM-589). One-click connector apps are a sqemes Cloud feature and are not part of
// this distribution: the public export replaces the Cloud registry with these EMPTY ones, so no app can
// be created on a self-hosted instance. Custom MCP connectors — including ones that sign in with OAuth —
// do not use a registry and work as usual.
import type { ConnectorApp, TokenApp, McpOauthApp } from './connectorApps.ts';

export const CONNECTOR_APPS: Record<string, ConnectorApp> = {};
export const TOKEN_APPS: Record<string, TokenApp> = {};
export const MCP_OAUTH_APPS: Record<string, McpOauthApp> = {};
