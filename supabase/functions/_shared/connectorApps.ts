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
  'microsoft-outlook':  { provider: 'microsoft', name: 'Outlook',         scopes: ['Mail.Read', 'Mail.ReadWrite', 'offline_access', 'openid', 'profile', 'email'], mcpUrl: `${PUBLIC_API_URL}/functions/v1/mcp-outlook` },
  'microsoft-calendar': { provider: 'microsoft', name: 'Outlook Calendar', scopes: ['Calendars.Read', 'offline_access', 'openid', 'profile', 'email'], mcpUrl: `${PUBLIC_API_URL}/functions/v1/mcp-msgraph?service=calendar` },
  'microsoft-onedrive': { provider: 'microsoft', name: 'OneDrive',         scopes: ['Files.Read', 'offline_access', 'openid', 'profile', 'email'], mcpUrl: `${PUBLIC_API_URL}/functions/v1/mcp-msgraph?service=files` },
};

// SQEM-157/159 — token-paste apps (no OAuth). The user pastes a static token (Shopify custom-app token,
// GitHub PAT, Notion internal-integration token); `manage-connectors` `create-token` encrypts it and
// points the connector at `mcpUrl`. `needsShop` apps (Shopify) append `?shop=` to the URL. GitHub points
// at its vendor-hosted MCP (accepts a PAT bearer — no shim); Notion at our mcp-notion REST shim.
export type TokenApp = { provider: string; name: string; mcpUrl: string; needsShop?: boolean };
export const TOKEN_APPS: Record<string, TokenApp> = {
  shopify: { provider: 'shopify', name: 'Shopify', mcpUrl: `${PUBLIC_API_URL}/functions/v1/mcp-shopify`, needsShop: true },
  github:  { provider: 'github',  name: 'GitHub',  mcpUrl: 'https://api.githubcopilot.com/mcp/' },
  notion:  { provider: 'notion',  name: 'Notion',  mcpUrl: `${PUBLIC_API_URL}/functions/v1/mcp-notion` },
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
