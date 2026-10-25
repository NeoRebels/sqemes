// SQEM-154 — connector "app" registry, shared by connector-oauth-start + -callback. Generalises the
// old one-app-per-provider model: each APP = a provider (for OAuth endpoints + refresh) + its scopes +
// the MCP URL a connector points at (Google's hosted per-app MCP, or our own shim). The provider config
// (endpoints, client env, scope-debug) is separate so many apps can share one OAuth client.

export type ConnectorApp = { provider: string; name: string; scopes: string[]; mcpUrl: string };
export type TokenApp = { provider: string; name: string; mcpUrl: string; needsShop?: boolean; needsSecret?: boolean };
export type McpOauthApp = { provider: string; name: string; mcpUrl: string; scopes?: string[]; clientIdEnv?: string };

// SQEM-589 — the registries live in connectorAppRegistry.ts (empty in the public export).
export { CONNECTOR_APPS, TOKEN_APPS, MCP_OAUTH_APPS } from './connectorAppRegistry.ts';

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
    scopeFilter: (s) => /mail\.|calendars\.|files\.|contacts\.|sites\.|team\.|channel|chat\./i.test(s), // SQEM-586 + SharePoint, Teams
    scopeShort: (s) => s.replace(/^https?:\/\/[^/]+\//, ''),
    hasRead: (parts) => parts.some((p) => /read/i.test(p)),
  },
};
