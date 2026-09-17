// SQEM-149 — Settings → Integrations "Connectors" card. Lists a workspace's external MCP connectors
// and lets a user add one (name + hosted MCP URL + optional bearer token), test it (probe → tool
// list), or remove it. Workspace-shared connectors are admin/editor only; anyone can add a personal one.
import { useEffect, useState, type ComponentType } from 'react';
import { useSearchParams } from 'react-router';
import { Plug, Plus, Trash2, Check, Loader2, Wand2, Users, User as UserIcon, AlertCircle, LayoutGrid, ArrowUpRight, Settings2 } from 'lucide-react';
import Card from './ui/Card';
import Modal from './ui/Modal';
import { IS_SELF_HOSTED } from '../lib/env';
import GmailIcon from './icons/GmailIcon';
import OutlookIcon from './icons/OutlookIcon';
import GoogleCalendarIcon from './icons/GoogleCalendarIcon';
import GoogleDriveIcon from './icons/GoogleDriveIcon';
import GoogleDocsIcon from './icons/GoogleDocsIcon';
import GoogleSheetsIcon from './icons/GoogleSheetsIcon';
import ShopifyIcon from './icons/ShopifyIcon';
import OutlookCalendarIcon from './icons/OutlookCalendarIcon';
import OneDriveIcon from './icons/OneDriveIcon';
import GitHubIcon from './icons/GitHubIcon';
import NotionIcon from './icons/NotionIcon';
import PlaudIcon from './icons/PlaudIcon';
import NiftyIcon from './icons/NiftyIcon';
import NootaIcon from './icons/NootaIcon';
import type { User } from '../types';
import {
  fetchConnectors, createConnector, deleteConnector, probeConnector, startOAuthConnect, createTokenConnector, setConnectorTools, connectorRedirectUri, inspectConnector,
  type Connector, type ProbeResult, type InspectResult,
} from '../lib/api/connectors';

// SQEM-150/153/154/157/159 — one-click "apps". `id` matches the backend app registry; `provider`+`name`
// is the connected/dedup key. `auth: 'oauth'` (redirect) or 'token' (paste a static token). Token apps
// carry `tokenLabel`/`help`, `needsShop` (Shopify), and a `placeholder`.
type OAuthApp = { id: string; provider: string; name: string; description: string; auth: 'oauth'; Icon: ComponentType<{ className?: string }>; unavailable?: string };
/**
 * SQEM-437 — an OAuth app that needs one value from the PERSON before the redirect.
 *
 * ⭐ It reuses the token dialog wholesale, because the dialog is the right shape already: a label, a
 * placeholder, a help line. Only what happens on submit differs — a token app stores the value AS the
 * credential, this one hands it to the consent flow and never stores it as one.
 *
 * ⚠️ No `shared` option, and that is not an omission: `connector-oauth-callback` writes MCP
 * connectors with `user_id` set, i.e. always personal. Offering a checkbox the backend ignores would
 * be worse than not offering one.
 */
/**
 * SQEM-441 — an app that needs no credentials at all, only the host it lives on.
 *
 * Every Shopify store runs a public MCP server at `https://<shop>/api/mcp` — measured against
 * allbirds.com on 2026-09-17: HTTP 200 on `tools/list`, no auth header of any kind. So the dialog asks
 * for a domain and nothing else, and the connector is created through the ordinary `create` action,
 * which has always treated the token as optional.
 */
type PublicAppUI = { id: string; provider: string; name: string; description: string; auth: 'public'; Icon: ComponentType<{ className?: string }>; hostLabel: string; placeholder: string; help: string; path: string; unavailable?: string };

type OAuthIdAppUI = { id: string; provider: string; name: string; description: string; auth: 'oauth-id'; Icon: ComponentType<{ className?: string }>; tokenLabel: string; placeholder: string; help: string; unavailable?: string; needsRedirectUri?: boolean; secretLabel?: string; secretOptional?: boolean };
type TokenAppUI = { id: string; provider: string; name: string; description: string; auth: 'token'; Icon: ComponentType<{ className?: string }>; tokenLabel: string; placeholder: string; help: string; needsShop?: boolean; unavailable?: string };

/**
 * SQEM-274 — why the five Google tiles cannot be connected yet.
 *
 * Our Google OAuth app sits at publishing status **Testing**, where only registered test users may
 * authorise — at most a hundred. That is the delivery state of an app that was never published, not
 * a defect in our code: `connector-oauth-start`, the callback and the scopes were all checked on
 * 2026-08-25 and are correct.
 *
 * ⛔ **Until this ticket, the tiles were connectable and led straight into a Google warning page
 * carrying our name.** That is the worst of the three options: the customer experiences a failure
 * that looks like ours. Hiding the tiles was the other candidate and was rejected — it also hides
 * that the feature is coming. **Saying so is better than either failing or pretending.**
 *
 * Removing this line is the whole of the UI work once Google approves the app. Gmail and Drive need
 * more than approval — their scopes are *restricted*, which additionally requires the annual, paid
 * CASA audit; Calendar, Docs and Sheets are *sensitive* and need only the review. `drive.file`, which
 * Docs and Sheets use, is deliberately not restricted.
 */
const GOOGLE_PENDING_REVIEW = 'Awaiting Google’s review — not connectable yet';

const OAUTH_APPS: (OAuthApp | TokenAppUI | OAuthIdAppUI | PublicAppUI)[] = [
  { id: 'google-gmail', provider: 'google', name: 'Gmail', description: 'Read & draft your email', auth: 'oauth', Icon: GmailIcon, unavailable: GOOGLE_PENDING_REVIEW },
  { id: 'google-calendar', provider: 'google', name: 'Google Calendar', description: 'Read your events & schedule', auth: 'oauth', Icon: GoogleCalendarIcon, unavailable: GOOGLE_PENDING_REVIEW },
  { id: 'google-drive', provider: 'google', name: 'Google Drive', description: 'Search & read your files', auth: 'oauth', Icon: GoogleDriveIcon, unavailable: GOOGLE_PENDING_REVIEW },
  { id: 'google-docs', provider: 'google', name: 'Google Docs', description: 'Read your documents', auth: 'oauth', Icon: GoogleDocsIcon, unavailable: GOOGLE_PENDING_REVIEW },
  { id: 'google-sheets', provider: 'google', name: 'Google Sheets', description: 'Read your spreadsheets', auth: 'oauth', Icon: GoogleSheetsIcon, unavailable: GOOGLE_PENDING_REVIEW },
  { id: 'microsoft-outlook', provider: 'microsoft', name: 'Outlook', description: 'Read & draft your email', auth: 'oauth', Icon: OutlookIcon },
  /**
   * SQEM-426 — the first connector whose OAuth client did not exist until we asked for one. Nothing
   * about this tile says so, and that is the point: for the person connecting it, an MCP server with
   * dynamic registration looks exactly like Gmail.
   */
  { id: 'plaud', provider: 'plaud', name: 'Plaud', description: 'Search your recordings & transcripts', auth: 'oauth', Icon: PlaudIcon },
  /**
   * SQEM-440 — Notion moved from a pasted integration token to its own MCP server, which registers a
   * client on request. Nothing to create at notion.so, nothing to paste; the tile is a plain redirect
   * like Plaud's. ⚠️ The tools are Notion's own now, not the ones our `mcp-notion` shim offered.
   */
  { id: 'notion', provider: 'notion', name: 'Notion', description: 'Search pages & databases', auth: 'oauth', Icon: NotionIcon },
  // SQEM-442 — dynamic registration again: nothing to paste, nothing to configure.
  { id: 'noota', provider: 'noota', name: 'Noota', description: 'Search your meetings & transcripts', auth: 'oauth', Icon: NootaIcon },
  /**
   * SQEM-437 — the same protocol as Plaud with one difference the person has to supply: Nifty hands
   * out a client id per user rather than registering one on request.
   */
  {
    id: 'nifty', provider: 'nifty', name: 'Nifty', description: 'Search your tasks, projects & docs', auth: 'oauth-id', Icon: NiftyIcon,
    tokenLabel: 'Client ID', placeholder: 'from the app you created in Nifty',
    // ⛔ SQEM-439 — NOT the id from Nifty's MCP settings tab: that one is registered for Claude
    // Desktop's redirect URI and Nifty rejects the exchange for anyone else. An app of our own has to
    // be registered in their App Center against OUR redirect URI, which the dialog shows.
    help: 'In Nifty, open the App Center and create an OAuth app using the redirect URI shown above. Paste the Client ID it gives you — and the Client Secret too, if it issues one. You will then be sent to Nifty to approve the connection.',
    needsRedirectUri: true, secretLabel: 'Client Secret', secretOptional: true,
  },
  { id: 'microsoft-calendar', provider: 'microsoft', name: 'Outlook Calendar', description: 'Read your events & schedule', auth: 'oauth', Icon: OutlookCalendarIcon },
  { id: 'microsoft-onedrive', provider: 'microsoft', name: 'OneDrive', description: 'Search & read your files', auth: 'oauth', Icon: OneDriveIcon },
  {
    id: 'github', provider: 'github', name: 'GitHub', description: 'Read repos, issues & PRs', auth: 'token', Icon: GitHubIcon,
    tokenLabel: 'Personal access token', placeholder: 'ghp_… / github_pat_…',
    help: 'Create a GitHub Personal Access Token (Settings → Developer settings → Personal access tokens) with read access to the repositories you want to use, and paste it.',
  },

  {
    id: 'shopify', provider: 'shopify', name: 'Shopify', description: 'Read products, orders & customers', auth: 'token', Icon: ShopifyIcon, needsShop: true,
    tokenLabel: 'Admin API access token', placeholder: 'shpat_…',
    help: 'In your store, create a custom app (Settings → Apps → Develop apps), grant read_products, read_orders, read_customers, install it, and paste its Admin API access token.',
  },
  /**
   * SQEM-441 — the storefront side of a shop: catalogue, policies, cart. A different capability from
   * the admin connector above, not a replacement for it — and it needs no credentials, so it works for
   * ANY shop, including ones you do not own.
   */
  {
    id: 'shopify-storefront', provider: 'shopify-storefront', name: 'Shopify Storefront', description: "Browse any store's catalogue & policies", auth: 'public', Icon: ShopifyIcon,
    hostLabel: 'Store domain', placeholder: 'example.com', path: '/api/mcp',
    help: "Enter the store's own domain — the one customers visit. No login, no token: a Shopify storefront answers publicly. It works for any Shopify store, including ones you do not run.",
  },
];

export default function ConnectorsCard({
  workspaceId,
  currentUser,
  showToast,
}: {
  workspaceId: string;
  currentUser: User;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}) {
  const canShare = currentUser.role === 'admin' || currentUser.role === 'editor';
  const [searchParams, setSearchParams] = useSearchParams();
  const [connectingApp, setConnectingProvider] = useState<string | null>(null);

  // SQEM-157/159 — token-paste apps (GitHub/Notion/Shopify) connect via a modal, not OAuth.
  // SQEM-437 — holds either kind: the dialog is shared, only the submit differs.
  const [tokenApp, setTokenApp] = useState<TokenAppUI | OAuthIdAppUI | PublicAppUI | null>(null);
  const [tokenShop, setTokenShop] = useState('');
  const [tokenValue, setTokenValue] = useState('');
  const [tokenShared, setTokenShared] = useState(false);
  const [tokenSaving, setTokenSaving] = useState(false);

  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [mcpUrl, setMcpUrl] = useState('');
  const [token, setToken] = useState('');
  const [shared, setShared] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [saving, setSaving] = useState(false);
  /**
   * SQEM-444 — what the server said about itself, and the two fields only some servers need.
   *
   * ⛔ The dialog used to make the person choose between "paste a token" and "leave it empty" — two of
   * four shapes, and not the ones most MCP servers use. The answer is in the server's own reply, so
   * the dialog asks it and then shows only what is actually required.
   */
  const [inspected, setInspected] = useState<InspectResult | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [addClientId, setAddClientId] = useState('');
  const [addClientSecret, setAddClientSecret] = useState('');
  const [addCopied, setAddCopied] = useState(false);

  const load = async () => {
    try { setConnectors(await fetchConnectors(workspaceId)); } catch { /* non-fatal */ }
    setLoaded(true);
  };
  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [workspaceId]);

  // SQEM-150 — the Gmail OAuth callback returns here with ?connector=connected|error. Surface + refresh.
  // ⚠️ SQEM-443 — the error branch awaits a connector fetch, so the body is async and wrapped: an
  // effect callback itself must stay synchronous.
  useEffect(() => { void (async () => {
    const status = searchParams.get('connector');
    if (!status) return;
    if (status === 'connected') {
      const name = searchParams.get('name') || 'Connector';
      const sc = searchParams.get('scopes'); // compact granted scopes, e.g. "readonly,compose" / "Mail.Read,Mail.ReadWrite"
      if (searchParams.get('read') === '0') {
        // Read scope not granted → data calls will fail with a permission error even though connect succeeds.
        showToast(`${name} connected, but the READ scope is missing${sc ? ` (granted: ${sc})` : ''}. Grant the read scope on the consent screen and reconnect.`, 'error');
      } else {
        showToast(sc ? `${name} connected — scopes: ${sc}` : `${name} connected`, 'success');
      }
      load();
    } else {
      // SQEM-273 — show the provider's own error code when we have it. `reason` names our stage,
      // `code` names what the provider said; without the second, "token_exchange" is a dead end for
      // whoever has to fix it, and they are usually the person reading this toast.
      const reason = searchParams.get('reason');
      const code = searchParams.get('code');
      // SQEM-448 — the provider's own sentence, when it sent one. It is what actually says why.
      const desc = searchParams.get('desc');

      /**
       * ⛔ SQEM-443, second layer — the server-side check needs the `state` back, and some providers do
       * not return it on an error. Nifty is one: the tile said connected, the toast said
       * "Connection failed: invalid_request", and both were true because the callback was reached
       * twice and the second arrival carried no state to recognise the first by.
       *
       * So the client decides on what it CAN see: a connector created moments ago means this error
       * belongs to a flow that already succeeded.
       *
       * ⚠️ Narrow on purpose:
       *   - only for a PROVIDER error. Our own stage names (`token_exchange`, `save_failed`,
       *     `bad_state`, …) stay loud, because those describe something that really went wrong here.
       *   - only within two minutes, measured against `created_at`.
       * A genuine failure moments after a successful *different* connect would be swallowed. That is
       * the residual cost, and it is smaller than telling someone to reconnect something that works —
       * advice that, followed, breaks it.
       */
      const OUR_STAGES = ['missing_code', 'bad_state', 'expired', 'bad_app', 'token_exchange', 'save_failed', 'mcp_oauth', 'no_token'];
      if (reason && !OUR_STAGES.includes(reason)) {
        const fresh = await fetchConnectors(workspaceId).catch(() => [] as Connector[]);
        const justNow = fresh.find(c => Date.now() - new Date(c.created_at).getTime() < 120_000);
        if (justNow) {
          setConnectors(fresh);
          showToast(`${justNow.name} connected`, 'success');
          const cleaned = new URLSearchParams(searchParams);
          ['connector', 'name', 'reason', 'code', 'desc', 'scopes', 'read'].forEach(k => cleaned.delete(k));
          setSearchParams(cleaned, { replace: true });
          return;
        }
      }

      showToast(
        // SQEM-287 — the codes above name the stage and the provider's answer, which is what a
        // maintainer needs. The person reading this is often not that maintainer, so the sentence
        // after them says what *they* can do. Reconnecting genuinely fixes the common cases
        // (expired consent, a revoked grant); where it does not, the code is there to pass on.
        `Connection failed${reason ? `: ${reason}` : ''}${code ? ` (${code})` : ''}.${desc ? ` ${desc}` : ''} Try connecting again — if it keeps failing, send us this message.`,
        'error',
      );
    }
    const next = new URLSearchParams(searchParams);
    ['connector', 'name', 'reason', 'code', 'desc', 'scopes', 'read'].forEach(k => next.delete(k));
    setSearchParams(next, { replace: true });
  })(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const connectApp = async (appId: string) => {
    setConnectingProvider(appId);
    try { window.location.href = await startOAuthConnect(workspaceId, appId); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Could not start connect', 'error'); setConnectingProvider(null); }
  };

  /**
   * SQEM-438 — the tool picker for one connector.
   *
   * ⚠️ `toolsPick === null` is "no restriction", NOT "none selected". The two look identical in a list
   * of unticked boxes and mean opposite things, so they are separate states here and the dialog says
   * which one is in force.
   */
  const [toolsFor, setToolsFor] = useState<Connector | null>(null);
  const [toolsList, setToolsList] = useState<{ name: string; description?: string }[] | null>(null);
  const [toolsPick, setToolsPick] = useState<string[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsSaving, setToolsSaving] = useState(false);

  const openToolsModal = async (c: Connector) => {
    setToolsFor(c); setToolsList(null); setToolsError(null); setToolsLoading(true);
    setToolsPick(c.allowed_tools?.length ? [...c.allowed_tools] : null);
    try {
      const r = await probeConnector({ connectorId: c.id });
      // ⚠️ A failed probe must NOT render as "this connector has no tools" — the saved selection is
      // still valid and still editable; only the live list is missing.
      if (r.ok) setToolsList((r.tools || []).map(t => ({ name: t.name, description: t.description })));
      else setToolsError(r.error || 'Could not load the tool list');
    } catch (e) {
      setToolsError(e instanceof Error ? e.message : 'Could not load the tool list');
    } finally { setToolsLoading(false); }
  };

  const saveTools = async () => {
    if (!toolsFor) return;
    setToolsSaving(true);
    try {
      const { allowedTools } = await setConnectorTools(toolsFor.id, toolsPick);
      setConnectors(prev => prev.map(c => (c.id === toolsFor.id ? { ...c, allowed_tools: allowedTools } : c)));
      showToast(allowedTools ? `Saved — ${allowedTools.length} tools enabled` : 'Saved — all tools enabled', 'success');
      setToolsFor(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save', 'error');
    } finally { setToolsSaving(false); }
  };

  const [tokenSecret, setTokenSecret] = useState('');
  const [redirectCopied, setRedirectCopied] = useState(false);

  const openTokenModal = (app: TokenAppUI | OAuthIdAppUI | PublicAppUI) => {
    setTokenApp(app); setTokenShop(''); setTokenValue(''); setTokenSecret(''); setTokenShared(false); setRedirectCopied(false);
  };

  const connectToken = async () => {
    if (!tokenApp || !tokenValue.trim() || (tokenApp.auth === 'token' && tokenApp.needsShop && !tokenShop.trim())) return;
    /**
     * SQEM-437 — the same dialog, two endings. A token app stores the value as the credential; an
     * `oauth-id` app hands it to the consent flow, which is a REDIRECT — so nothing is saved here and
     * the success toast belongs to the callback, not to this function.
     */
    /**
     * SQEM-441 — no credentials: compose the URL from the domain and use the ordinary `create` action.
     *
     * ⚠️ The domain is checked here but **not** forced to `*.myshopify.com` the way the admin connector
     * is: a storefront almost always runs on the shop's own domain, and that rule would reject exactly
     * the cases this tile exists for.
     */
    if (tokenApp.auth === 'public') {
      const host = tokenValue.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || /^\d+(\.\d+){3}$/.test(host)) {
        showToast('That does not look like a store domain — try example.com', 'error');
        return;
      }
      setTokenSaving(true);
      try {
        const { connector } = await createConnector({
          workspaceId, name: tokenApp.name, mcpUrl: `https://${host}${tokenApp.path}`,
          shared: tokenShared && canShare,
        });
        setConnectors(prev => [...prev, connector]);
        setTokenApp(null);
        // ⚠️ Not every shop is Shopify — a storefront on another platform answers 404. Say so instead
        // of leaving a connector that looks fine and fails on first use.
        const r = await probeConnector({ connectorId: connector.id });
        showToast(
          r.ok ? `✓ Connected — ${(r.tools || []).length} tools` : `Connected, but the store did not answer: ${r.error}`,
          r.ok ? 'success' : 'error',
        );
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Could not connect', 'error');
      } finally { setTokenSaving(false); }
      return;
    }

    if (tokenApp.auth === 'oauth-id') {
      setTokenSaving(true);
      try { window.location.href = await startOAuthConnect(workspaceId, tokenApp.id, tokenValue.trim(), tokenSecret.trim() || undefined); }
      catch (e) { showToast(e instanceof Error ? e.message : 'Could not start connect', 'error'); setTokenSaving(false); }
      return;
    }
    setTokenSaving(true);
    try {
      await createTokenConnector({ workspaceId, app: tokenApp.id, token: tokenValue.trim(), shared: tokenShared && canShare, ...(tokenApp.needsShop ? { shop: tokenShop.trim() } : {}) });
      showToast(`${tokenApp.name} connected`, 'success');
      setTokenApp(null);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not connect', 'error');
    } finally {
      setTokenSaving(false);
    }
  };

  const openAdd = () => {
    setName(''); setMcpUrl(''); setToken(''); setShared(false); setProbe(null); setShowAdd(true);
  };

  const runProbe = async () => {
    if (!/^https:\/\//i.test(mcpUrl.trim())) { setProbe({ ok: false, error: 'Enter a https:// MCP URL first.' }); return; }
    setProbing(true); setProbe(null);
    try {
      setProbe(await probeConnector({ mcpUrl: mcpUrl.trim(), token: token.trim() || undefined }));
    } catch (e) {
      setProbe({ ok: false, error: e instanceof Error ? e.message : 'Probe failed' });
    } finally {
      setProbing(false);
    }
  };

  const runInspect = async () => {
    setInspecting(true); setInspected(null); setProbe(null);
    try {
      setInspected(await inspectConnector(mcpUrl.trim()));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not reach that address', 'error');
    } finally { setInspecting(false); }
  };

  /**
   * SQEM-444 — an OAuth server, added by hand. Same flow as a tile: the start function takes the URL
   * instead of a registry id, and the callback creates the connector when the person comes back.
   */
  const connectAdHoc = async () => {
    setSaving(true);
    try {
      const scopes = inspected?.kind === 'oauth' ? inspected.scopes : undefined;
      window.location.href = await startOAuthConnect(
        workspaceId, 'manual',
        addClientId.trim() || undefined, addClientSecret.trim() || undefined,
        { mcpUrl: mcpUrl.trim(), name: name.trim(), scopes },
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not start connect', 'error');
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!name.trim() || !/^https:\/\//i.test(mcpUrl.trim())) return;
    setSaving(true);
    try {
      await createConnector({
        workspaceId, name: name.trim(), mcpUrl: mcpUrl.trim(),
        token: token.trim() || undefined, shared: shared && canShare,
      });
      showToast('Connector added', 'success');
      setShowAdd(false);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to add connector', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try { await deleteConnector(id); setConnectors(prev => prev.filter(c => c.id !== id)); }
    catch { showToast('Failed to remove connector', 'error'); }
    finally { setDeletingId(null); }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const r = await probeConnector({ connectorId: id });
      showToast(r.ok ? `✓ ${r.serverName || 'Connected'} — ${(r.tools || []).length} tools` : `Failed: ${r.error}`, r.ok ? 'success' : 'error');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Test failed', 'error');
    } finally {
      setTestingId(null);
    }
  };

  const oauthProviders = [...new Set(OAUTH_APPS.map(a => a.provider))];
  const manualConnectors = connectors.filter(c => !oauthProviders.includes(c.provider ?? ''));

  return (
    <>
    <Card className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Plug className="w-5 h-5 text-brand-500" />
            Connectors
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Connect external MCP tools to use in Chat.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-brand-200 dark:shadow-none shrink-0"
        >
          <Plus className="w-4 h-4" /> Add connector
        </button>
      </div>

      {loaded && manualConnectors.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">
          <Plug className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">No connectors yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Add a hosted MCP endpoint to use its tools in Chat.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {manualConnectors.map(c => (
            <div key={c.id} className="flex items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-100 dark:border-slate-700">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{c.name}</p>
                <p className="text-xs font-mono text-slate-400 dark:text-slate-500 mt-0.5 truncate">{c.mcp_url}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className={`text-2xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md flex items-center gap-1 ${c.user_id ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'}`}>
                    {c.user_id ? <><UserIcon className="w-3 h-3" /> Personal</> : <><Users className="w-3 h-3" /> Workspace</>}
                  </span>
                  {c.allowed_tools?.length ? (
                    <span className="text-2xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300">{c.allowed_tools.length} tools</span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => handleTest(c.id)} disabled={testingId === c.id} className="px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors disabled:opacity-50 flex items-center gap-1.5">
                  {testingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Test
                </button>
                <button onClick={() => openToolsModal(c)} className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-lg transition-colors" title="Tools">
                  <Settings2 className="w-4 h-4" />
                </button>
                <button onClick={() => handleDelete(c.id)} disabled={deletingId === c.id} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50" title="Remove">
                  {deletingId === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>

    {/* SQEM-150 — one-click OAuth connectors (sign-in apps). Extensible via OAUTH_APPS. */}
    <Card className="p-6 md:p-8">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <LayoutGrid className="w-5 h-5 text-brand-500" />
          Apps
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {IS_SELF_HOSTED
            ? 'One-click app connectors are available on sqemes Cloud.'
            : 'One-click connectors — sign in once, then use them in Chat.'}
        </p>
      </div>
      {IS_SELF_HOSTED ? (
        /* Self-host: the managed one-click apps need Cloud OAuth infra — show a CTA, not broken tiles. */
        <div className="rounded-2xl border border-brand-100 dark:border-brand-900/40 bg-gradient-to-br from-brand-50 to-white dark:from-brand-900/20 dark:to-slate-800/50 p-6 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-4">
            {OAUTH_APPS.map(app => (
              <div key={app.id} className="w-9 h-9 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 flex items-center justify-center shadow-sm">
                <app.Icon className="w-5 h-5" />
              </div>
            ))}
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">One-click app connectors</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-md mx-auto">
            Connect Gmail, Google Calendar, Docs, Sheets, Drive, and Outlook straight into your chat — no API keys, no setup. Available on sqemes Cloud.
          </p>
          <a
            href="https://sqemes.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-brand-200 dark:shadow-none"
          >
            Explore sqemes Cloud <ArrowUpRight className="w-4 h-4" />
          </a>
        </div>
      ) : (
      <div className="space-y-3">
        {OAUTH_APPS.map(app => {
          const appConnector = connectors.find(c => c.provider === app.provider && c.name === app.name);
          const connected = !!appConnector;
          // SQEM-274 — an app we cannot authorise yet. The tile stays, so the person can see the
          // feature exists and is coming; only the action that would fail is taken away.
          //
          // ⚠️ **Disconnect keeps working.** An existing connection still functions — the token is
          // already issued — so someone who connected while the app was in Testing must remain able
          // to remove it. Blocking every button would trap a connector nobody could get rid of.
          const blocked = !!app.unavailable;
          return (
            <div key={app.id} className="flex items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-100 dark:border-slate-700">
              <div className={`flex items-center gap-3 min-w-0 ${blocked && !connected ? 'opacity-60' : ''}`}>
                <div className="relative shrink-0">
                  <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 flex items-center justify-center">
                    <app.Icon className="w-6 h-6" />
                  </div>
                  {connected && (
                    <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-800 flex items-center justify-center" title="Connected">
                      <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{app.name}</p>
                  {/* SQEM-274 — the reason replaces the description rather than sitting beside it.
                      A tile that reads "Read & draft your email" next to a dead button describes a
                      capability the person cannot have; the sentence they need is why not. */}
                  <p className={`text-xs mt-0.5 truncate ${
                    connected ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                      : blocked ? 'text-amber-600 dark:text-amber-400 font-semibold'
                      : 'text-slate-400 dark:text-slate-500'}`}>
                    {connected ? 'Connected' : blocked ? app.unavailable : app.description}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => (app.auth === 'token' || app.auth === 'oauth-id' || app.auth === 'public' ? openTokenModal(app) : connectApp(app.id))}
                  disabled={connectingApp === app.id || blocked}
                  title={blocked ? app.unavailable : undefined}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 ${connected ? 'text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600' : 'text-white bg-brand-600 hover:bg-brand-700'}`}
                >
                  {connectingApp === app.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : connected ? 'Reconnect' : 'Connect'}
                </button>
                {connected && appConnector && (
                  <button onClick={() => openToolsModal(appConnector)} className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-lg transition-colors" title="Tools">
                    <Settings2 className="w-4 h-4" />
                  </button>
                )}
                {connected && appConnector && (
                  <button
                    onClick={() => handleDelete(appConnector.id)}
                    disabled={deletingId === appConnector.id}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                    title="Disconnect"
                  >
                    {deletingId === appConnector.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}
    </Card>

      {/* Add connector modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} size="sm" className="p-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">Add connector</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">Point at a hosted MCP endpoint. We ask the server how it wants to be connected.</p>

        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My Shopify store"
          className="w-full p-3 mb-4 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-slate-400" />

        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">MCP URL</label>
        <input value={mcpUrl} onChange={e => { setMcpUrl(e.target.value); setProbe(null); setInspected(null); }} placeholder="https://…/mcp"
          className="w-full p-3 mb-4 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm font-mono outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-slate-400" />

        {/* SQEM-444 — what the server said, and only the fields it actually needs. Nothing below this
            line appears until the address has been checked, because until then we would be guessing. */}
        {inspected?.kind === 'none' && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 text-xs">
            <div className="font-bold flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Open server — no sign-in needed{inspected.serverName ? ` (${inspected.serverName})` : ''}</div>
            {(inspected.tools || []).length > 0 && <div className="mt-1">{(inspected.tools || []).length} tools available.</div>}
          </div>
        )}

        {inspected?.kind === 'oauth' && (
          <div className="mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700 text-xs">
            <div className="font-bold text-slate-700 dark:text-slate-200">Signs you in with {new URL(inspected.issuer).hostname}</div>
            {inspected.registration ? (
              <p className="text-slate-500 dark:text-slate-400 mt-1">Nothing to enter — this server issues its own credentials.</p>
            ) : (
              <>
                {/* ⛔ SQEM-439 — the redirect URI is the one value nobody can guess, and registering the
                    wrong one fails with an error that names neither it nor the mistake. */}
                <p className="text-slate-500 dark:text-slate-400 mt-1 mb-2">This server needs an app you register yourself. Use this redirect URI:</p>
                <div className="flex items-center gap-2 mb-3">
                  <code className="flex-1 text-2xs font-mono text-slate-700 dark:text-slate-200 break-all">{connectorRedirectUri()}</code>
                  <button onClick={() => { navigator.clipboard?.writeText(connectorRedirectUri()); setAddCopied(true); }}
                    className="shrink-0 px-2 py-1 text-2xs font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">
                    {addCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <label className="block text-2xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Client ID</label>
                <input value={addClientId} onChange={e => setAddClientId(e.target.value)} type="text" placeholder="from the app you registered"
                  className="w-full p-2.5 mb-2 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg text-xs outline-none focus:border-brand-500 transition-all placeholder:text-slate-400" />
                <label className="block text-2xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Client Secret <span className="normal-case tracking-normal font-medium text-slate-400">— optional</span></label>
                <input value={addClientSecret} onChange={e => setAddClientSecret(e.target.value)} type="password" placeholder="leave empty if none was issued"
                  className="w-full p-2.5 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg text-xs outline-none focus:border-brand-500 transition-all placeholder:text-slate-400" />
              </>
            )}
          </div>
        )}

        {/* ⚠️ The token field is for servers that publish no usable OAuth metadata — it is a fallback,
            not the default it used to be. */}
        {inspected?.kind === 'token' && (
          <>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Bearer token</label>
            <input value={token} onChange={e => { setToken(e.target.value); setProbe(null); }} type="password" placeholder="the token this server expects"
              className="w-full p-3 mb-4 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-slate-400" />
          </>
        )}

        {canShare && (
          <label className="flex items-start gap-2.5 mb-4 text-sm text-slate-700 dark:text-slate-200 cursor-pointer select-none">
            <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} className="mt-0.5 w-4 h-4 rounded accent-brand-600 cursor-pointer shrink-0" />
            <span>Share with the whole workspace<span className="block text-2xs text-slate-400">Off = personal to you. Shared connectors need admin/editor.</span></span>
          </label>
        )}

        {/* Test connection */}
        <div className="mb-4">
          {/* SQEM-444 — "check" rather than "test": it decides what the dialog asks for next, so it is
              a step in the flow and not an optional reassurance. */}
          <button onClick={runInspect} disabled={inspecting || !mcpUrl.trim()} className="text-xs font-bold text-brand-600 hover:text-brand-700 disabled:opacity-50 flex items-center gap-1.5">
            {inspecting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…</> : <><Check className="w-3.5 h-3.5" /> Check server</>}
          </button>
          {inspected?.kind === 'token' && (
            <button onClick={runProbe} disabled={probing || !mcpUrl.trim()} className="mt-2 text-xs font-bold text-brand-600 hover:text-brand-700 disabled:opacity-50 flex items-center gap-1.5">
              {probing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing…</> : <><Check className="w-3.5 h-3.5" /> Test with this token</>}
            </button>
          )}
          {probe && (
            <div className={`mt-2 text-xs rounded-lg p-2.5 ${probe.ok ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300'}`}>
              {probe.ok ? (
                <>
                  <div className="font-bold flex items-center gap-1"><Check className="w-3.5 h-3.5" /> {probe.serverName || 'Connected'} — {(probe.tools || []).length} tools</div>
                  {(probe.tools || []).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {(probe.tools || []).slice(0, 12).map(t => (
                        <span key={t.name} className="inline-flex items-center gap-1 bg-white/70 dark:bg-slate-800/60 px-1.5 py-0.5 rounded"><Wand2 className="w-3 h-3" />{t.name}</span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-start gap-1"><AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {probe.error || 'Could not connect.'}</div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={() => setShowAdd(false)} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors">Cancel</button>
          {/* ⛔ SQEM-444 — an OAuth server is not "added", it is *connected*: the row appears when the
              person comes back from the provider. Two different endings, so two different buttons. */}
          {inspected?.kind === 'oauth' ? (
            <button
              onClick={connectAdHoc}
              disabled={saving || !name.trim() || (!inspected.registration && !addClientId.trim())}
              className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting…</> : 'Continue'}
            </button>
          ) : (
            <button onClick={handleAdd} disabled={saving || !inspected || !name.trim() || !/^https:\/\//i.test(mcpUrl.trim())}
              className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Adding…</> : 'Add connector'}
            </button>
          )}
        </div>
      </Modal>

      {/* SQEM-157/159 — Connect a token-paste app (GitHub/Notion/Shopify) */}
      <Modal open={!!tokenApp} onClose={() => setTokenApp(null)} size="sm" className="p-6">
        {tokenApp && (
          <>
            <div className="flex items-center gap-2.5 mb-2">
              <tokenApp.Icon className="w-6 h-6" />
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Connect {tokenApp.name}</h3>
            </div>
            {/* ⛔ SQEM-439 — the redirect URI comes FIRST, before the help text that refers to it.
                It is the one value the person cannot obtain anywhere else, and registering an app
                without it produces a token-endpoint error that names everything except the URI. */}
            {tokenApp.auth === 'oauth-id' && tokenApp.needsRedirectUri && (
              <div className="mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700">
                <p className="text-2xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Redirect URI — register this in Nifty</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-2xs font-mono text-slate-700 dark:text-slate-200 break-all">{connectorRedirectUri()}</code>
                  <button
                    onClick={() => { navigator.clipboard?.writeText(connectorRedirectUri()); setRedirectCopied(true); }}
                    className="shrink-0 px-2 py-1 text-2xs font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
                  >
                    {redirectCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                {/* Staging and production are different hosts, so they need separate apps. */}
                <p className="text-2xs text-slate-400 mt-1.5">This address is specific to this sqemes instance — an app registered for another one will be rejected.</p>
              </div>
            )}

            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">{tokenApp.help}</p>

            {tokenApp.auth === 'token' && tokenApp.needsShop && (
              <>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Shop domain</label>
                <input value={tokenShop} onChange={e => setTokenShop(e.target.value)} placeholder="your-store.myshopify.com"
                  className="w-full p-3 mb-4 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm font-mono outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-slate-400" />
              </>
            )}

            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">{tokenApp.auth === 'public' ? tokenApp.hostLabel : tokenApp.tokenLabel}</label>
            {/* ⚠️ SQEM-437 — a client id is NOT a secret (Microsoft publishes its own in a 401
                header), and masking it would stop the person checking what they pasted. A token is
                masked for the opposite reason. */}
            {/* ⚠️ SQEM-441 — a shop domain is public information, so it is plain text like the client
                id above and unlike a token. */}
            <input value={tokenValue} onChange={e => setTokenValue(e.target.value)} type={tokenApp.auth === 'token' ? 'password' : 'text'} placeholder={tokenApp.placeholder}
              className="w-full p-3 mb-4 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-slate-400" />

            {tokenApp.auth === 'oauth-id' && tokenApp.secretLabel && (
              <>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                  {tokenApp.secretLabel}{tokenApp.secretOptional && <span className="ml-1 normal-case tracking-normal font-medium text-slate-400">— optional</span>}
                </label>
                {/* ⚠️ Masked, unlike the Client ID above: this one IS a secret. */}
                <input value={tokenSecret} onChange={e => setTokenSecret(e.target.value)} type="password" placeholder="leave empty if Nifty did not issue one"
                  className="w-full p-3 mb-4 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-slate-400" />
              </>
            )}

            {canShare && (tokenApp.auth === 'token' || tokenApp.auth === 'public') && (
              <label className="flex items-start gap-2.5 mb-4 text-sm text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                <input type="checkbox" checked={tokenShared} onChange={e => setTokenShared(e.target.checked)} className="mt-0.5 w-4 h-4 rounded accent-brand-600 cursor-pointer shrink-0" />
                <span>Share with the whole workspace<span className="block text-2xs text-slate-400">Off = personal to you. Shared connectors need admin/editor.</span></span>
              </label>
            )}

            <div className="flex gap-2">
              <button onClick={() => setTokenApp(null)} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors">Cancel</button>
              <button onClick={connectToken} disabled={tokenSaving || !tokenValue.trim() || (tokenApp.auth === 'token' && tokenApp.needsShop && !tokenShop.trim())}
                className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {tokenSaving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting…</> : (tokenApp.auth === 'oauth-id' ? 'Continue' : 'Connect')}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* SQEM-438 — which tools this connector may use. Since SQEM-436 there is no per-chat picker,
          so this is the only lever on scope, tokens and wrong-service calls. */}
      <Modal open={!!toolsFor} onClose={() => setToolsFor(null)} size="sm" className="p-6">
        {toolsFor && (
          <>
            <div className="flex items-center gap-2.5 mb-1">
              <Settings2 className="w-5 h-5 text-slate-400" />
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{toolsFor.name} — tools</h3>
            </div>
            <p className="text-xs font-mono text-slate-400 dark:text-slate-500 mb-4 truncate">{toolsFor.mcp_url}</p>

            {/* ⚠️ The two states mean opposite things and look alike in a list of unticked boxes:
                "no restriction" follows the provider as they add tools, a list freezes today's set. */}
            <div className="space-y-2 mb-4">
              <label className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                <input type="radio" checked={toolsPick === null} onChange={() => setToolsPick(null)} className="mt-0.5 w-4 h-4 accent-brand-600 cursor-pointer shrink-0" />
                <span>All tools<span className="block text-2xs text-slate-400">Whatever this service offers, now and later. New tools are included automatically.</span></span>
              </label>
              <label className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                <input type="radio" checked={toolsPick !== null} onChange={() => setToolsPick(toolsList ? toolsList.map(t => t.name) : [])} className="mt-0.5 w-4 h-4 accent-brand-600 cursor-pointer shrink-0" />
                <span>Only the ones I pick<span className="block text-2xs text-slate-400">Fewer tools means smaller requests and fewer wrong guesses — but a tool added later stays off until you come back.</span></span>
              </label>
            </div>

            {toolsLoading && <p className="text-xs text-slate-400 flex items-center gap-2 mb-4"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading the tool list…</p>}

            {toolsError && (
              <div className="flex items-start gap-2 p-3 mb-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {/* Not "no tools" — the saved selection is still in force and still editable. */}
                <p className="text-xs">Could not load the live tool list ({toolsError}). Your saved selection is unchanged and can still be edited below.</p>
              </div>
            )}

            {toolsPick !== null && (
              <div className="max-h-56 overflow-y-auto border border-slate-100 dark:border-slate-700 rounded-xl p-1.5 mb-4">
                {(toolsList ?? (toolsPick.map(name => ({ name, description: undefined })))).map(t => {
                  const on = toolsPick.includes(t.name);
                  return (
                    <label key={t.name} className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                      <input type="checkbox" checked={on} className="mt-0.5 w-4 h-4 rounded accent-brand-600 cursor-pointer shrink-0"
                        onChange={() => setToolsPick(prev => (prev ?? []).includes(t.name) ? (prev ?? []).filter(x => x !== t.name) : [...(prev ?? []), t.name])} />
                      <span className="min-w-0">
                        <span className="block text-sm font-mono text-slate-700 dark:text-slate-200 truncate">{t.name}</span>
                        {t.description && <span className="block text-2xs text-slate-400 line-clamp-2">{t.description}</span>}
                      </span>
                    </label>
                  );
                })}
                {!toolsList && toolsPick.length === 0 && (
                  <p className="text-xs text-slate-400 px-2.5 py-2">No tool list available right now.</p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setToolsFor(null)} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors">Cancel</button>
              <button onClick={saveTools} disabled={toolsSaving}
                className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {toolsSaving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : 'Save'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
