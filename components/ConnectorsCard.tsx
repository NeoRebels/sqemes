// SQEM-149 — Settings → Integrations "Connectors" card. Lists a workspace's external MCP connectors
// and lets a user add one (name + hosted MCP URL + optional bearer token), test it (probe → tool
// list), or remove it. Workspace-shared connectors are admin/editor only; anyone can add a personal one.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Plug, Plus, Trash2, Check, Loader2, Wand2, Users, User as UserIcon, AlertCircle, AlertTriangle, LayoutGrid, ArrowUpRight, Settings2 } from 'lucide-react';
import Card from './ui/Card';
import Modal from './ui/Modal';
import { IS_SELF_HOSTED } from '../lib/env';
import { useWorkspace } from '../store';
import type { User } from '../types';
import ConnectorLogo from './ConnectorLogo';
import { OAUTH_APPS, GOOGLE_TESTING_NOTE, tileText, type TokenAppUI, type OAuthIdAppUI, type PublicAppUI } from './connectorAppTiles';
import {
  fetchConnectors, createConnector, deleteConnector, probeConnector, startOAuthConnect, createTokenConnector, setConnectorTools, connectorRedirectUri, inspectConnector,
  type Connector, type ProbeResult, type InspectResult,
} from '../lib/api/connectors';
import { Input } from './ui/Input';
import { m } from '../lib/i18n';

/**
 * SQEM-589 — no app tiles on self-host. The export already ships an EMPTY `OAUTH_APPS`; the flag here
 * is the second lock, so a self-host build from this repo (VITE_SELF_HOSTED=true) cannot show them
 * either. Custom connectors are not affected.
 */
const VISIBLE_APPS = IS_SELF_HOSTED ? [] : OAUTH_APPS;

export default function ConnectorsCard({
  workspaceId,
  currentUser,
  showToast,
}: {
  workspaceId: string;
  currentUser: User;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}) {
  const { isSqemesAdmin } = useWorkspace(); // SQEM-587 — Google tiles unlocked for testing
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
      const name = searchParams.get('name') || m.cc_connector();
      const sc = searchParams.get('scopes'); // compact granted scopes, e.g. "readonly,compose" / "Mail.Read,Mail.ReadWrite"
      if (searchParams.get('read') === '0') {
        // Read scope not granted → data calls will fail with a permission error even though connect succeeds.
        showToast(m.cc_read_missing({ name, granted: sc ? m.cc_granted({ scopes: sc }) : '' }), 'error');
      } else {
        showToast(sc ? m.cc_connected_scopes({ name, scopes: sc }) : m.cc_connected({ name }), 'success');
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
          showToast(m.cc_connected({ name: justNow.name }), 'success');
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
        m.cc_failed({ detail: `${reason ? `: ${reason}` : ''}${code ? ` (${code})` : ''}`, desc: desc ? ` ${desc}` : '' }),
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
    catch (e) { showToast(e instanceof Error ? e.message : m.cc_start_failed(), 'error'); setConnectingProvider(null); }
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
      else setToolsError(r.error || m.cc_tools_load_failed());
    } catch (e) {
      setToolsError(e instanceof Error ? e.message : m.cc_tools_load_failed());
    } finally { setToolsLoading(false); }
  };

  const saveTools = async () => {
    if (!toolsFor) return;
    setToolsSaving(true);
    try {
      const { allowedTools } = await setConnectorTools(toolsFor.id, toolsPick);
      setConnectors(prev => prev.map(c => (c.id === toolsFor.id ? { ...c, allowed_tools: allowedTools } : c)));
      showToast(allowedTools ? m.cc_saved_n({ count: allowedTools.length }) : m.cc_saved_all(), 'success');
      setToolsFor(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : m.cc_save_failed(), 'error');
    } finally { setToolsSaving(false); }
  };

  const [tokenSecret, setTokenSecret] = useState('');
  const [redirectCopied, setRedirectCopied] = useState(false);

  const openTokenModal = (app: TokenAppUI | OAuthIdAppUI | PublicAppUI) => {
    setTokenApp(app); setTokenShop(''); setTokenValue(''); setTokenSecret(''); setTokenShared(false); setRedirectCopied(false);
  };

  const connectToken = async () => {
    if (!tokenApp || !tokenValue.trim() || (tokenApp.auth === 'token' && tokenApp.needsShop && !tokenShop.trim())) return;
    if (tokenApp.auth === 'token' && tokenApp.needsSecret && !tokenSecret.trim()) return;
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
        showToast(m.cc_bad_domain(), 'error');
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
          r.ok ? m.cc_connected_tools({ count: (r.tools || []).length }) : m.cc_store_no_answer({ error: r.error ?? '' }),
          r.ok ? 'success' : 'error',
        );
      } catch (e) {
        showToast(e instanceof Error ? e.message : m.cc_connect_failed(), 'error');
      } finally { setTokenSaving(false); }
      return;
    }

    if (tokenApp.auth === 'oauth-id') {
      setTokenSaving(true);
      try { window.location.href = await startOAuthConnect(workspaceId, tokenApp.id, tokenValue.trim(), tokenSecret.trim() || undefined); }
      catch (e) { showToast(e instanceof Error ? e.message : m.cc_start_failed(), 'error'); setTokenSaving(false); }
      return;
    }
    setTokenSaving(true);
    try {
      await createTokenConnector({ workspaceId, app: tokenApp.id, token: tokenValue.trim(), shared: tokenShared && canShare, ...(tokenApp.needsShop ? { shop: tokenShop.trim() } : {}), ...(tokenApp.needsSecret ? { secret: tokenSecret.trim() } : {}) });
      showToast(m.cc_connected({ name: tokenApp.name }), 'success');
      setTokenApp(null);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : m.cc_connect_failed(), 'error');
    } finally {
      setTokenSaving(false);
    }
  };

  const openAdd = () => {
    setName(''); setMcpUrl(''); setToken(''); setShared(false); setProbe(null); setShowAdd(true);
  };

  const runProbe = async () => {
    if (!/^https:\/\//i.test(mcpUrl.trim())) { setProbe({ ok: false, error: m.cc_https_first() }); return; }
    setProbing(true); setProbe(null);
    try {
      setProbe(await probeConnector({ mcpUrl: mcpUrl.trim(), token: token.trim() || undefined }));
    } catch (e) {
      setProbe({ ok: false, error: e instanceof Error ? e.message : m.cc_probe_failed() });
    } finally {
      setProbing(false);
    }
  };

  const runInspect = async () => {
    setInspecting(true); setInspected(null); setProbe(null);
    try {
      setInspected(await inspectConnector(mcpUrl.trim()));
    } catch (e) {
      showToast(e instanceof Error ? e.message : m.cc_unreachable(), 'error');
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
      showToast(e instanceof Error ? e.message : m.cc_start_failed(), 'error');
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
      showToast(m.cc_added(), 'success');
      setShowAdd(false);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : m.cc_add_failed(), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try { await deleteConnector(id); setConnectors(prev => prev.filter(c => c.id !== id)); }
    catch { showToast(m.cc_remove_failed(), 'error'); }
    finally { setDeletingId(null); }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const r = await probeConnector({ connectorId: id });
      showToast(r.ok ? m.cc_test_ok({ name: r.serverName || m.cc_connected_word(), count: (r.tools || []).length }) : m.cc_test_failed_with({ error: r.error ?? '' }), r.ok ? 'success' : 'error');
    } catch (e) {
      showToast(e instanceof Error ? e.message : m.cc_test_failed(), 'error');
    } finally {
      setTestingId(null);
    }
  };

  const oauthProviders = [...new Set(OAUTH_APPS.map(a => a.provider))];
  const manualConnectors = connectors.filter(c => !oauthProviders.includes(c.provider ?? ''));

  return (
    <>
    <Card className="p-6 md:p-8">
      {/* SQEM-609 — stacked on a phone: the German button label is longer and ran out of the card. */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink-strong flex items-center gap-2">
            <Plug className="w-5 h-5 text-accent" />
            {m.cc_title()}
          </h2>
          <p className="text-sm text-ink-muted mt-1">
            {m.cc_desc()}
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-accent-strong hover:opacity-90 text-white rounded-xl text-sm font-bold transition-all shadow-lg shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> {m.cc_add()}
        </button>
      </div>

      {loaded && manualConnectors.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-line-strong rounded-2xl">
          <Plug className="w-8 h-8 text-ink-subtle mx-auto mb-3" />
          <p className="text-sm font-semibold text-ink-muted">{m.cc_none()}</p>
          <p className="text-xs text-ink-subtle mt-1">{m.cc_none_hint()}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {manualConnectors.map(c => (
            <div key={c.id} className="flex items-center justify-between gap-4 p-4 bg-surface-sunken rounded-xl border border-line">
              {/* SQEM-590 — custom connectors carry a logo too, in the same frame as the app tiles. */}
              <div className="w-10 h-10 shrink-0 self-start rounded-xl bg-surface-raised border border-line flex items-center justify-center">
                <ConnectorLogo mcpUrl={c.mcp_url} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink-strong truncate">{c.name}</p>
                <p className="text-xs font-mono text-ink-subtle mt-0.5 truncate">{c.mcp_url}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className={`text-2xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md flex items-center gap-1 ${c.user_id ? 'bg-success-soft text-ink-strong' : 'bg-accent-soft text-accent'}`}>
                    {c.user_id ? <><UserIcon className="w-3 h-3" /> {m.cc_personal()}</> : <><Users className="w-3 h-3" /> {m.cc_workspace()}</>}
                  </span>
                  {c.allowed_tools?.length ? (
                    <span className="text-2xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-line-strong text-ink">{m.cc_n_tools({ count: c.allowed_tools.length })}</span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => handleTest(c.id)} disabled={testingId === c.id} className="px-3 py-1.5 text-xs font-bold text-ink bg-surface-field border border-line-strong rounded-lg hover:bg-surface-sunken transition-colors disabled:opacity-50 flex items-center gap-1.5">
                  {testingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {m.cc_test()}
                </button>
                <button onClick={() => openToolsModal(c)} className="p-2 text-ink-subtle hover:text-accent hover:bg-accent-soft rounded-lg transition-colors" title={m.cc_tools()}>
                  <Settings2 className="w-4 h-4" />
                </button>
                <button onClick={() => handleDelete(c.id)} disabled={deletingId === c.id} className="p-2 text-ink-subtle hover:text-danger hover:bg-danger-soft rounded-lg transition-colors disabled:opacity-50" title={m.cc_remove()}>
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
        <h2 className="font-display text-xl font-semibold text-ink-strong flex items-center gap-2">
          <LayoutGrid className="w-5 h-5 text-accent" />
          {m.cc_apps()}
        </h2>
        <p className="text-sm text-ink-muted mt-1">
          {m.cc_apps_desc()}
        </p>
      </div>
      {/* SQEM-589 — on self-host the apps are a sqemes Cloud feature: ONE line saying so, in the design
          system (a sunken row like the tiles it stands in for, the link in accent), not a banner. The
          names are written out because the export ships no tile list to derive them from. */}
      {IS_SELF_HOSTED && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 rounded-control bg-surface-sunken border border-line">
          <p className="text-sm text-ink-muted">
            {m.cc_apps_selfhost()}
          </p>
          <a
            href="https://sqemes.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline shrink-0"
          >
            sqemes Cloud <ArrowUpRight className="w-4 h-4" />
          </a>
        </div>
      )}
      <div className="space-y-3">
        {VISIBLE_APPS.map(app => {
          const appConnector = connectors.find(c => c.provider === app.provider && c.name === app.name);
          const connected = !!appConnector;
          // SQEM-274 — an app we cannot authorise yet. The tile stays, so the person can see the
          // feature exists and is coming; only the action that would fail is taken away.
          //
          // ⚠️ **Disconnect keeps working.** An existing connection still functions — the token is
          // already issued — so someone who connected while the app was in Testing must remain able
          // to remove it. Blocking every button would trap a connector nobody could get rid of.
          const testingUnlock = !!app.unavailable && app.provider === 'google' && isSqemesAdmin; // SQEM-587
          const blocked = !!app.unavailable && !testingUnlock;
          return (
            <div key={app.id} className="flex items-center justify-between gap-4 p-4 bg-surface-sunken rounded-xl border border-line">
              <div className={`flex items-center gap-3 min-w-0 ${blocked && !connected ? 'opacity-60' : ''}`}>
                <div className="relative shrink-0">
                  <div className="w-10 h-10 rounded-xl bg-surface-raised border border-line flex items-center justify-center">
                    <app.Icon className="w-6 h-6" />
                  </div>
                  {connected && (
                    <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-success ring-2 ring-surface-raised flex items-center justify-center" title={m.cc_connected_word()}>
                      <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink-strong truncate">{app.name}</p>
                  {/* SQEM-274 — the reason replaces the description rather than sitting beside it.
                      A tile that reads "Read & draft your email" next to a dead button describes a
                      capability the person cannot have; the sentence they need is why not. */}
                  {/* SQEM-554 (f1) — the blocked reason in dark text with an amber icon:
                      amber text at this size misses AA; the icon keeps it reading as a warning. */}
                  <p className={`text-xs mt-0.5 truncate ${
                    connected ? 'text-success font-semibold'
                      : blocked ? 'text-ink font-semibold'
                      : 'text-ink-subtle'}`}>
                    {blocked && !connected && <AlertTriangle aria-hidden className="inline w-3 h-3 mr-1 -mt-0.5 text-warning" />}
                    {connected ? m.cc_connected_word() : blocked ? tileText(app.unavailable) : testingUnlock ? tileText(GOOGLE_TESTING_NOTE) : tileText(app.description)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => (app.auth === 'token' || app.auth === 'oauth-id' || app.auth === 'public' ? openTokenModal(app) : connectApp(app.id))}
                  disabled={connectingApp === app.id || blocked}
                  title={blocked ? tileText(app.unavailable) : undefined}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 ${connected ? 'text-ink bg-surface-field border border-line-strong hover:bg-surface-sunken' : 'text-white bg-accent-strong hover:opacity-90'}`}
                >
                  {connectingApp === app.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : connected ? m.cc_reconnect() : m.cc_connect()}
                </button>
                {connected && appConnector && (
                  <button onClick={() => openToolsModal(appConnector)} className="p-2 text-ink-subtle hover:text-accent hover:bg-accent-soft rounded-lg transition-colors" title={m.cc_tools()}>
                    <Settings2 className="w-4 h-4" />
                  </button>
                )}
                {connected && appConnector && (
                  <button
                    onClick={() => handleDelete(appConnector.id)}
                    disabled={deletingId === appConnector.id}
                    className="p-2 text-ink-subtle hover:text-danger hover:bg-danger-soft rounded-lg transition-colors disabled:opacity-50"
                    title={m.cc_disconnect()}
                  >
                    {deletingId === appConnector.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>

      {/* Add connector modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} size="sm" className="p-6">
        <h3 className="font-display text-xl font-semibold text-ink-strong mb-2">{m.cc_add()}</h3>
        <p className="text-sm text-ink-muted mb-5">{m.cc_add_desc()}</p>

        <label htmlFor="connectors-card-name" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-1.5">{m.cc_name()}</label>
        <Input id="connectors-card-name" value={name} onChange={e => setName(e.target.value)} placeholder={m.cc_name_placeholder()}
          className="mb-4" />

        <label htmlFor="connectors-card-mcp-url" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-1.5">MCP URL</label>
        <Input id="connectors-card-mcp-url" value={mcpUrl} onChange={e => { setMcpUrl(e.target.value); setProbe(null); setInspected(null); }} placeholder="https://…/mcp"
          className="mb-4 font-mono" />

        {/* SQEM-444 — what the server said, and only the fields it actually needs. Nothing below this
            line appears until the address has been checked, because until then we would be guessing. */}
        {inspected?.kind === 'none' && (
          <div className="mb-4 p-3 rounded-xl bg-success-soft text-ink-strong text-xs">
            <div className="font-bold flex items-center gap-1"><Check className="w-3.5 h-3.5" /> {m.cc_open_server()}{inspected.serverName ? ` (${inspected.serverName})` : ''}</div>
            {(inspected.tools || []).length > 0 && <div className="mt-1">{m.cc_tools_available({ count: (inspected.tools || []).length })}</div>}
          </div>
        )}

        {inspected?.kind === 'oauth' && (
          <div className="mb-4 p-3 rounded-xl bg-surface-sunken border border-line text-xs">
            <div className="font-bold text-ink">{m.cc_signs_in_with({ host: new URL(inspected.issuer).hostname })}</div>
            {inspected.registration ? (
              <p className="text-ink-muted mt-1">{m.cc_nothing_to_enter()}</p>
            ) : (
              <>
                {/* ⛔ SQEM-439 — the redirect URI is the one value nobody can guess, and registering the
                    wrong one fails with an error that names neither it nor the mistake. */}
                <p className="text-ink-muted mt-1 mb-2">{m.cc_register_app()}</p>
                <div className="flex items-center gap-2 mb-3">
                  <code className="flex-1 text-2xs font-mono text-ink break-all">{connectorRedirectUri()}</code>
                  <button onClick={() => { navigator.clipboard?.writeText(connectorRedirectUri()); setAddCopied(true); }}
                    className="shrink-0 px-2 py-1 text-2xs font-bold text-ink bg-surface-field border border-line-strong rounded-lg hover:bg-surface-sunken transition-colors">
                    {addCopied ? m.cc_copied() : m.cc_copy()}
                  </button>
                </div>
                <label htmlFor="connectors-card-client-id" className="block text-2xs font-bold text-ink-muted uppercase tracking-wider mb-1">Client ID</label>
                <input id="connectors-card-client-id" value={addClientId} onChange={e => setAddClientId(e.target.value)} type="text" placeholder={m.cc_from_app()}
                  className="w-full p-2.5 mb-2 border border-line-strong bg-surface-field text-ink-strong rounded-lg text-xs outline-none focus:border-accent transition-all placeholder:text-ink-subtle" />
                <label htmlFor="connectors-card-client-secret-optional" className="block text-2xs font-bold text-ink-muted uppercase tracking-wider mb-1">Client Secret <span className="normal-case tracking-normal font-medium text-ink-subtle">{m.cc_optional()}</span></label>
                <input id="connectors-card-client-secret-optional" value={addClientSecret} onChange={e => setAddClientSecret(e.target.value)} type="password" placeholder={m.cc_secret_empty()}
                  className="w-full p-2.5 border border-line-strong bg-surface-field text-ink-strong rounded-lg text-xs outline-none focus:border-accent transition-all placeholder:text-ink-subtle" />
              </>
            )}
          </div>
        )}

        {/* ⚠️ The token field is for servers that publish no usable OAuth metadata — it is a fallback,
            not the default it used to be. */}
        {inspected?.kind === 'token' && (
          <>
            <label htmlFor="connectors-card-bearer-token" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-1.5">{m.cc_bearer()}</label>
            <Input id="connectors-card-bearer-token" value={token} onChange={e => { setToken(e.target.value); setProbe(null); }} type="password" placeholder={m.cc_bearer_placeholder()}
              className="mb-4" />
          </>
        )}

        {canShare && (
          <label className="flex items-start gap-2.5 mb-4 text-sm text-ink cursor-pointer select-none">
            <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} className="mt-0.5 w-4 h-4 rounded accent-brand-600 cursor-pointer shrink-0" />
            <span>{m.cc_share()}<span className="block text-2xs text-ink-subtle">{m.cc_share_hint()}</span></span>
          </label>
        )}

        {/* Test connection */}
        <div className="mb-4">
          {/* SQEM-444 — "check" rather than "test": it decides what the dialog asks for next, so it is
              a step in the flow and not an optional reassurance. */}
          <button onClick={runInspect} disabled={inspecting || !mcpUrl.trim()} className="text-xs font-bold text-accent hover:opacity-80 disabled:opacity-50 flex items-center gap-1.5">
            {inspecting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {m.cc_checking()}</> : <><Check className="w-3.5 h-3.5" /> {m.cc_check()}</>}
          </button>
          {inspected?.kind === 'token' && (
            <button onClick={runProbe} disabled={probing || !mcpUrl.trim()} className="mt-2 text-xs font-bold text-accent hover:opacity-80 disabled:opacity-50 flex items-center gap-1.5">
              {probing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {m.cc_testing()}</> : <><Check className="w-3.5 h-3.5" /> {m.cc_test_token()}</>}
            </button>
          )}
          {probe && (
            <div className={`mt-2 text-xs rounded-lg p-2.5 ${probe.ok ? 'bg-success-soft text-ink-strong' : 'bg-danger-soft text-danger'}`}>
              {probe.ok ? (
                <>
                  <div className="font-bold flex items-center gap-1"><Check className="w-3.5 h-3.5" /> {m.cc_probe_ok({ name: probe.serverName || m.cc_connected_word(), count: (probe.tools || []).length })}</div>
                  {(probe.tools || []).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {(probe.tools || []).slice(0, 12).map(t => (
                        <span key={t.name} className="inline-flex items-center gap-1 bg-surface-raised/70 px-1.5 py-0.5 rounded"><Wand2 className="w-3 h-3" />{t.name}</span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-start gap-1"><AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {probe.error || m.cc_could_not_connect()}</div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={() => setShowAdd(false)} className="flex-1 py-2.5 text-ink bg-surface-sunken rounded-xl hover:bg-line-strong text-xs font-bold transition-colors">{m.pb_cancel()}</button>
          {/* ⛔ SQEM-444 — an OAuth server is not "added", it is *connected*: the row appears when the
              person comes back from the provider. Two different endings, so two different buttons. */}
          {inspected?.kind === 'oauth' ? (
            <button
              onClick={connectAdHoc}
              disabled={saving || !name.trim() || (!inspected.registration && !addClientId.trim())}
              className="flex-1 py-2.5 bg-accent-strong hover:opacity-90 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {m.cc_connecting()}</> : m.cc_continue()}
            </button>
          ) : (
            <button onClick={handleAdd} disabled={saving || !inspected || !name.trim() || !/^https:\/\//i.test(mcpUrl.trim())}
              className="flex-1 py-2.5 bg-accent-strong hover:opacity-90 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {m.cc_adding()}</> : m.cc_add()}
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
              <h3 className="font-display text-xl font-semibold text-ink-strong">{m.cc_connect_app({ name: tokenApp.name })}</h3>
            </div>
            {/* ⛔ SQEM-439 — the redirect URI comes FIRST, before the help text that refers to it.
                It is the one value the person cannot obtain anywhere else, and registering an app
                without it produces a token-endpoint error that names everything except the URI. */}
            {tokenApp.auth === 'oauth-id' && tokenApp.needsRedirectUri && (
              <div className="mb-4 p-3 rounded-xl bg-surface-sunken border border-line">
                <p className="text-2xs font-bold text-ink-muted uppercase tracking-wider mb-1.5">{m.cc_redirect_nifty()}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-2xs font-mono text-ink break-all">{connectorRedirectUri()}</code>
                  <button
                    onClick={() => { navigator.clipboard?.writeText(connectorRedirectUri()); setRedirectCopied(true); }}
                    className="shrink-0 px-2 py-1 text-2xs font-bold text-ink bg-surface-field border border-line-strong rounded-lg hover:bg-surface-sunken transition-colors"
                  >
                    {redirectCopied ? m.cc_copied() : m.cc_copy()}
                  </button>
                </div>
                {/* Staging and production are different hosts, so they need separate apps. */}
                <p className="text-2xs text-ink-subtle mt-1.5">{m.cc_redirect_instance()}</p>
              </div>
            )}

            <p className="text-sm text-ink-muted mb-5">{tileText(tokenApp.help)}</p>

            {tokenApp.auth === 'token' && tokenApp.needsShop && (
              <>
                <label htmlFor="connectors-card-shop-domain" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-1.5">{m.cc_shop_domain()}</label>
                <Input id="connectors-card-shop-domain" value={tokenShop} onChange={e => setTokenShop(e.target.value)} placeholder="your-store.myshopify.com"
                  className="mb-4 font-mono" />
              </>
            )}

            <label htmlFor="connectors-card-" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-1.5">{tileText(tokenApp.auth === 'public' ? tokenApp.hostLabel : tokenApp.tokenLabel)}</label>
            {/* ⚠️ SQEM-437 — a client id is NOT a secret (Microsoft publishes its own in a 401
                header), and masking it would stop the person checking what they pasted. A token is
                masked for the opposite reason. */}
            {/* ⚠️ SQEM-441 — a shop domain is public information, so it is plain text like the client
                id above and unlike a token. */}
            <Input id="connectors-card-" value={tokenValue} onChange={e => setTokenValue(e.target.value)} type={tokenApp.auth === 'token' && !tokenApp.needsSecret ? 'password' : 'text'} placeholder={tileText(tokenApp.placeholder)}
              className="mb-4" />

            {((tokenApp.auth === 'oauth-id') || (tokenApp.auth === 'token' && tokenApp.needsSecret)) && tokenApp.secretLabel && (
              <>
                <label htmlFor="connectors-card--2" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-1.5">
                  {tileText(tokenApp.secretLabel)}{tokenApp.secretOptional && <span className="ml-1 normal-case tracking-normal font-medium text-ink-subtle">{m.cc_optional()}</span>}
                </label>
                {/* ⚠️ Masked, unlike the Client ID above: this one IS a secret. */}
                <Input id="connectors-card--2" value={tokenSecret} onChange={e => setTokenSecret(e.target.value)} type="password" placeholder={tokenApp.auth === 'token' ? 'shpss_…' : m.cc_nifty_secret_empty()}
                  className="mb-4" />
              </>
            )}

            {canShare && (tokenApp.auth === 'token' || tokenApp.auth === 'public') && (
              <label className="flex items-start gap-2.5 mb-4 text-sm text-ink cursor-pointer select-none">
                <input type="checkbox" checked={tokenShared} onChange={e => setTokenShared(e.target.checked)} className="mt-0.5 w-4 h-4 rounded accent-brand-600 cursor-pointer shrink-0" />
                <span>{m.cc_share()}<span className="block text-2xs text-ink-subtle">{m.cc_share_hint()}</span></span>
              </label>
            )}

            <div className="flex gap-2">
              <button onClick={() => setTokenApp(null)} className="flex-1 py-2.5 text-ink bg-surface-sunken rounded-xl hover:bg-line-strong text-xs font-bold transition-colors">{m.pb_cancel()}</button>
              <button onClick={connectToken} disabled={tokenSaving || !tokenValue.trim() || (tokenApp.auth === 'token' && tokenApp.needsShop && !tokenShop.trim())}
                className="flex-1 py-2.5 bg-accent-strong hover:opacity-90 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {tokenSaving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {m.cc_connecting()}</> : (tokenApp.auth === 'oauth-id' ? m.cc_continue() : m.cc_connect())}
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
              <Settings2 className="w-5 h-5 text-ink-subtle" />
              <h3 className="font-display text-xl font-semibold text-ink-strong">{m.cc_tools_title({ name: toolsFor.name })}</h3>
            </div>
            <p className="text-xs font-mono text-ink-subtle mb-4 truncate">{toolsFor.mcp_url}</p>

            {/* ⚠️ The two states mean opposite things and look alike in a list of unticked boxes:
                "no restriction" follows the provider as they add tools, a list freezes today's set. */}
            <div className="space-y-2 mb-4">
              <label className="flex items-start gap-2.5 text-sm text-ink cursor-pointer select-none">
                <input type="radio" checked={toolsPick === null} onChange={() => setToolsPick(null)} className="mt-0.5 w-4 h-4 accent-brand-600 cursor-pointer shrink-0" />
                <span>{m.cc_all_tools()}<span className="block text-2xs text-ink-subtle">{m.cc_all_tools_hint()}</span></span>
              </label>
              <label className="flex items-start gap-2.5 text-sm text-ink cursor-pointer select-none">
                <input type="radio" checked={toolsPick !== null} onChange={() => setToolsPick(toolsList ? toolsList.map(t => t.name) : [])} className="mt-0.5 w-4 h-4 accent-brand-600 cursor-pointer shrink-0" />
                <span>{m.cc_pick()}<span className="block text-2xs text-ink-subtle">{m.cc_pick_hint()}</span></span>
              </label>
            </div>

            {toolsLoading && <p className="text-xs text-ink-subtle flex items-center gap-2 mb-4"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {m.cc_loading_tools()}</p>}

            {toolsError && (
              <div className="flex items-start gap-2 p-3 mb-4 rounded-xl bg-warning-soft text-ink-strong">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {/* Not "no tools" — the saved selection is still in force and still editable. */}
                <p className="text-xs">{m.cc_live_failed({ error: toolsError })}</p>
              </div>
            )}

            {toolsPick !== null && (
              <div className="max-h-56 overflow-y-auto border border-line rounded-xl p-1.5 mb-4">
                {(toolsList ?? (toolsPick.map(name => ({ name, description: undefined })))).map(t => {
                  const on = toolsPick.includes(t.name);
                  return (
                    <label key={t.name} className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-surface-sunken cursor-pointer">
                      <input type="checkbox" checked={on} className="mt-0.5 w-4 h-4 rounded accent-brand-600 cursor-pointer shrink-0"
                        onChange={() => setToolsPick(prev => (prev ?? []).includes(t.name) ? (prev ?? []).filter(x => x !== t.name) : [...(prev ?? []), t.name])} />
                      <span className="min-w-0">
                        <span className="block text-sm font-mono text-ink truncate">{t.name}</span>
                        {t.description && <span className="block text-2xs text-ink-subtle line-clamp-2">{t.description}</span>}
                      </span>
                    </label>
                  );
                })}
                {!toolsList && toolsPick.length === 0 && (
                  <p className="text-xs text-ink-subtle px-2.5 py-2">{m.cc_no_tool_list()}</p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setToolsFor(null)} className="flex-1 py-2.5 text-ink bg-surface-sunken rounded-xl hover:bg-line-strong text-xs font-bold transition-colors">{m.pb_cancel()}</button>
              <button onClick={saveTools} disabled={toolsSaving}
                className="flex-1 py-2.5 bg-accent-strong hover:opacity-90 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {toolsSaving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {m.cc_saving()}</> : m.st_save()}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
