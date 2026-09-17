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

// SQEM-157/159 — token-paste apps (no OAuth). The user pastes a static token (a Shopify custom-app
// token, a GitHub PAT); `manage-connectors` `create-token` encrypts it and points the connector at
// `mcpUrl`. `needsShop` apps (Shopify) append `?shop=` to the URL. GitHub points at its vendor-hosted
// MCP, which accepts a PAT bearer — no shim needed.
//
// ⚠️ **Notion left this list in SQEM-440.** It runs its own MCP server with dynamic registration, so
// it is an `MCP_OAUTH_APPS` entry now and needs no pasted token at all. Our `mcp-notion` shim existed
// only because that server was DCR-only and could not take a static token; SQEM-426 removed that
// obstacle, and the shim with it.
export type TokenApp = { provider: string; name: string; mcpUrl: string; needsShop?: boolean };
export const TOKEN_APPS: Record<string, TokenApp> = {
  shopify: { provider: 'shopify', name: 'Shopify', mcpUrl: `${PUBLIC_API_URL}/functions/v1/mcp-shopify`, needsShop: true },
  github:  { provider: 'github',  name: 'GitHub',  mcpUrl: 'https://api.githubcopilot.com/mcp/' },
};

// SQEM-426 — the third kind: an MCP server that authenticates with OAuth. `mcpUrl` is both the
// resource we call AND the starting point of discovery.
//
// ⭐ Adding a server here is the whole integration: no client to create by hand, no contact with the
// vendor, no secret to store. That is the point of building it generically rather than for Plaud.
//
// ⚠️ **SQEM-430 — `clientIdEnv` is for the servers that have no `/register`.** Measured 2026-09-17:
// Plaud and Notion hand out a client on request; Nifty and Microsoft do not. Microsoft names its own
// `client_id` in the `WWW-Authenticate` header, so it needs nothing here either; Nifty expects one to
// be entered. The env var holds it — per installation, like `GOOGLE_OAUTH_CLIENT_ID`, so a
// self-hoster sets their own and nothing vendor-specific is baked into the source.
export type McpOauthApp = { provider: string; name: string; mcpUrl: string; scopes?: string[]; clientIdEnv?: string };
export const MCP_OAUTH_APPS: Record<string, McpOauthApp> = {
  plaud: { provider: 'plaud', name: 'Plaud', mcpUrl: 'https://mcp.plaud.ai/mcp' },
  // SQEM-437 — same protocol as Plaud, no `/register`. Nifty issues a client id PER USER in their
  // MCP settings, so it is neither registered nor configured here: the person pastes it when they
  // connect, and it travels through `state` into `workspace_connectors.oauth_client_id`.
  /**
   * ⛔ **The scopes are required, and their absence fails in a way that names nothing.** Nifty's
   * authorization endpoint accepts a request without `scope` and forwards it to the consent screen —
   * which then has no permission to ask about and answers *"this connection request is invalid or
   * expired"*. Measured 2026-09-17: the same request with `scope` reaches the consent UI intact, the
   * one without arrives with no scope parameter at all. (`state` and `resource` both survive, so
   * neither of those was the cause.)
   *
   * ⚠️ **`delete` is deliberately NOT requested**, although Nifty's own example includes it. A chat
   * assistant that can delete tasks is the one case where a mistake cannot be undone, and a granted
   * scope is not something `allowed_tools` (SQEM-438) can take back — that limits which TOOLS are
   * offered, not what the token may do. `read write` covers search, create and update. Add it here if
   * the owner decides otherwise; it is one word.
   */
  nifty: { provider: 'nifty', name: 'Nifty', mcpUrl: 'https://mcp.niftypm.com/mcp', scopes: ['read', 'write'] },
  // SQEM-440 — Notion's own server, replacing our `mcp-notion` REST shim. It registers dynamically
  // like Plaud, so nothing is pasted and nothing is configured. ⚠️ Its TOOLS are Notion's, not the
  // ones the shim offered — that is the point of the change and also its cost.
  notion: { provider: 'notion', name: 'Notion', mcpUrl: 'https://mcp.notion.com/mcp' },
  /**
   * SQEM-442 — Noota (meeting recordings and transcripts). Dynamic registration, like Plaud.
   *
   * ⚠️ The scope is declared from the start. SQEM-439 cost three rounds, and the last one was a
   * missing `scope`: Nifty's consent screen had no permission to ask about and rejected the request
   * with an error naming neither. Noota publishes `scopes_supported: ['read']`, so that is what we
   * send. (Plaud needs none — not a counter-example, just the other case.)
   */
  noota: { provider: 'noota', name: 'Noota', mcpUrl: 'https://mcp.noota.io/mcp', scopes: ['read'] },
};

/**
 * The client id configured for an MCP app, or `undefined` when the app does not use one.
 *
 * ⚠️ **Declared-but-empty must not read as "not declared".** An app that names a `clientIdEnv` whose
 * variable is empty is misconfigured, and saying "this server offers no dynamic client registration"
 * would point at the server instead of at the missing value. `mcpClientIdSource` reports the
 * distinction so the error can name the variable — the same trap `VITE_MARKETPLACE_API_URL` set in
 * SQEM-405, where "defined and empty" produced an error that pointed somewhere else entirely.
 */
export function mcpClientIdSource(app: McpOauthApp): { configuredClientId?: string; configuredClientIdEnv?: string } {
  if (!app.clientIdEnv) return {};
  const value = (Deno.env.get(app.clientIdEnv) ?? '').trim();
  // ⚠️ The env NAME is returned even when the value is empty — that is the whole point: it is what
  // lets the failure say "NIFTY_MCP_CLIENT_ID is declared for this app but empty".
  return { configuredClientId: value || undefined, configuredClientIdEnv: app.clientIdEnv };
}

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
    // SQEM-359 — `prompt: 'consent'` stays HERE and must not be "harmonised" with Microsoft below.
    // Google returns the `refresh_token` **only on the first consent**; on every later authorization
    // the response carries an access token and no refresh token, so the connector would work for an
    // hour and then die with nothing in the logs saying why. Forcing the dialog is the documented way
    // to get one every time. `access_type: 'offline'` is required for the same reason.
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
    // SQEM-359 — ⛔ this said `prompt: 'consent'` until 2026-09-10, and it was never a decision: both
    // provider blocks were written in the same commit (SQEM-154) and Microsoft inherited Google's
    // value. **Google's reason does not transfer.** Microsoft returns a refresh token on every code
    // exchange that asked for `offline_access` — which all three Microsoft apps do — so nothing here
    // depends on forcing the dialog.
    //
    // What it cost: `prompt=consent` shows the consent dialog *every* time, ignoring consent that is
    // already granted. In a tenant where an admin consented org-wide it re-asks each user; in a
    // tenant that disables user consent (a common hardening) the user is shown a dialog they are not
    // allowed to accept and the connect **fails**. Reported by a customer.
    //
    // ⚠️ Not simply dropped. With no `prompt` Microsoft signs in "the sole current user" silently —
    // and `connector-oauth-callback` stores no account identity, so a connector bound to the wrong
    // (often personal) mailbox looks exactly like a correct one. `select_account` always shows the
    // picker and forces no consent: one click, and nobody connects the wrong mailbox unknowingly.
    //
    // ⛔ `prompt=none` is not an option here: it errors with `interaction_required` whenever the
    // request cannot complete silently, which on a first connect is always.
    authExtra: { prompt: 'select_account', response_mode: 'query' },
    scopeFilter: (s) => /mail\.|calendars\.|files\.|contacts\./i.test(s),
    scopeShort: (s) => s.replace(/^https?:\/\/[^/]+\//, ''),
    hasRead: (parts) => parts.some((p) => /read/i.test(p)),
  },
};
