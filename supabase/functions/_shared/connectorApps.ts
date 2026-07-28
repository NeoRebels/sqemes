// SQEM-154 — connector "app" registry, shared by connector-oauth-start + -callback. Generalises the
// old one-app-per-provider model: each APP = a provider (for OAuth endpoints + refresh) + its scopes +
// the MCP URL a connector points at (Google's hosted per-app MCP, or our own shim). The provider config
// (endpoints, client env, scope-debug) is separate so many apps can share one OAuth client.
const PUBLIC_API_URL = (Deno.env.get('PUBLIC_API_URL') ?? Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/+$/, '');
const G = 'https://www.googleapis.com/auth/';

export type ConnectorApp = { provider: string; name: string; scopes: string[]; mcpUrl: string };

// App key MUST match the frontend OAUTH_APPS id. name+provider is the dedup/connected key (no migration).
export const CONNECTOR_APPS: Record<string, ConnectorApp> = {
  'google-gmail':      { provider: 'google', name: 'Gmail',           scopes: [G + 'gmail.readonly', G + 'gmail.compose'], mcpUrl: 'https://gmailmcp.googleapis.com/mcp/v1' },
  'google-calendar':   { provider: 'google', name: 'Google Calendar', scopes: [G + 'calendar.events.readonly', G + 'calendar.calendarlist.readonly'], mcpUrl: 'https://calendarmcp.googleapis.com/mcp/v1' },
  'google-drive':      { provider: 'google', name: 'Google Drive',    scopes: [G + 'drive.readonly'], mcpUrl: 'https://drivemcp.googleapis.com/mcp/v1' },
  'google-docs':       { provider: 'google', name: 'Google Docs',     scopes: [G + 'documents.readonly', G + 'drive.file'], mcpUrl: 'https://docsmcp.googleapis.com/mcp/v1' },
  'google-sheets':     { provider: 'google', name: 'Google Sheets',   scopes: [G + 'spreadsheets.readonly', G + 'drive.file'], mcpUrl: 'https://sheetsmcp.googleapis.com/mcp/v1' },
  'microsoft-outlook': { provider: 'microsoft', name: 'Outlook',      scopes: ['Mail.Read', 'Mail.ReadWrite', 'offline_access', 'openid', 'profile', 'email'], mcpUrl: `${PUBLIC_API_URL}/functions/v1/mcp-outlook` },
};

export type ProviderCfg = {
  authUrl: string; tokenUrl: string; clientIdEnv: string; clientSecretEnv: string;
  authExtra: Record<string, string>;
  scopeFilter: (s: string) => boolean; scopeShort: (s: string) => string; hasRead: (parts: string[]) => boolean;
};

export const PROVIDERS: Record<string, ProviderCfg> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    authExtra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    scopeFilter: (s) => s.includes('googleapis.com/auth/'),
    scopeShort: (s) => s.split('/auth/')[1] ?? s,
    hasRead: (parts) => parts.some((p) => /readonly|\.file|events|documents|spreadsheets/i.test(p)),
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientIdEnv: 'MICROSOFT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_OAUTH_CLIENT_SECRET',
    authExtra: { prompt: 'consent', response_mode: 'query' },
    scopeFilter: (s) => /mail\.|calendars\.|files\.|contacts\./i.test(s),
    scopeShort: (s) => s.replace(/^https?:\/\/[^/]+\//, ''),
    hasRead: (parts) => parts.some((p) => /read/i.test(p)),
  },
};
