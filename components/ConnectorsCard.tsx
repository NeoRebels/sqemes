// SQEM-149 — Settings → Integrations "Connectors" card. Lists a workspace's external MCP connectors
// and lets a user add one (name + hosted MCP URL + optional bearer token), test it (probe → tool
// list), or remove it. Workspace-shared connectors are admin/editor only; anyone can add a personal one.
import { useEffect, useState, type ComponentType } from 'react';
import { useSearchParams } from 'react-router';
import { Plug, Plus, Trash2, Check, Loader2, Wand2, Users, User as UserIcon, AlertCircle, LayoutGrid, ArrowUpRight } from 'lucide-react';
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
import type { User } from '../types';
import {
  fetchConnectors, createConnector, deleteConnector, probeConnector, startOAuthConnect, createTokenConnector,
  type Connector, type ProbeResult,
} from '../lib/api/connectors';

// SQEM-150/153/154/157/159 — one-click "apps". `id` matches the backend app registry; `provider`+`name`
// is the connected/dedup key. `auth: 'oauth'` (redirect) or 'token' (paste a static token). Token apps
// carry `tokenLabel`/`help`, `needsShop` (Shopify), and a `placeholder`.
type OAuthApp = { id: string; provider: string; name: string; description: string; auth: 'oauth'; Icon: ComponentType<{ className?: string }> };
type TokenAppUI = { id: string; provider: string; name: string; description: string; auth: 'token'; Icon: ComponentType<{ className?: string }>; tokenLabel: string; placeholder: string; help: string; needsShop?: boolean };
const OAUTH_APPS: (OAuthApp | TokenAppUI)[] = [
  { id: 'google-gmail', provider: 'google', name: 'Gmail', description: 'Read & draft your email', auth: 'oauth', Icon: GmailIcon },
  { id: 'google-calendar', provider: 'google', name: 'Google Calendar', description: 'Read your events & schedule', auth: 'oauth', Icon: GoogleCalendarIcon },
  { id: 'google-drive', provider: 'google', name: 'Google Drive', description: 'Search & read your files', auth: 'oauth', Icon: GoogleDriveIcon },
  { id: 'google-docs', provider: 'google', name: 'Google Docs', description: 'Read your documents', auth: 'oauth', Icon: GoogleDocsIcon },
  { id: 'google-sheets', provider: 'google', name: 'Google Sheets', description: 'Read your spreadsheets', auth: 'oauth', Icon: GoogleSheetsIcon },
  { id: 'microsoft-outlook', provider: 'microsoft', name: 'Outlook', description: 'Read & draft your email', auth: 'oauth', Icon: OutlookIcon },
  { id: 'microsoft-calendar', provider: 'microsoft', name: 'Outlook Calendar', description: 'Read your events & schedule', auth: 'oauth', Icon: OutlookCalendarIcon },
  { id: 'microsoft-onedrive', provider: 'microsoft', name: 'OneDrive', description: 'Search & read your files', auth: 'oauth', Icon: OneDriveIcon },
  {
    id: 'github', provider: 'github', name: 'GitHub', description: 'Read repos, issues & PRs', auth: 'token', Icon: GitHubIcon,
    tokenLabel: 'Personal access token', placeholder: 'ghp_… / github_pat_…',
    help: 'Create a GitHub Personal Access Token (Settings → Developer settings → Personal access tokens) with read access to the repositories you want to use, and paste it.',
  },
  {
    id: 'notion', provider: 'notion', name: 'Notion', description: 'Search pages & databases', auth: 'token', Icon: NotionIcon,
    tokenLabel: 'Internal integration token', placeholder: 'ntn_… / secret_…',
    help: 'Create an internal integration at notion.so/my-integrations, share the pages/databases you want with it, and paste its token.',
  },
  {
    id: 'shopify', provider: 'shopify', name: 'Shopify', description: 'Read products, orders & customers', auth: 'token', Icon: ShopifyIcon, needsShop: true,
    tokenLabel: 'Admin API access token', placeholder: 'shpat_…',
    help: 'In your store, create a custom app (Settings → Apps → Develop apps), grant read_products, read_orders, read_customers, install it, and paste its Admin API access token.',
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
  const [tokenApp, setTokenApp] = useState<TokenAppUI | null>(null);
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

  const load = async () => {
    try { setConnectors(await fetchConnectors(workspaceId)); } catch { /* non-fatal */ }
    setLoaded(true);
  };
  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [workspaceId]);

  // SQEM-150 — the Gmail OAuth callback returns here with ?connector=connected|error. Surface + refresh.
  useEffect(() => {
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
      showToast(
        `Connection failed${reason ? `: ${reason}` : ''}${code ? ` (${code})` : ''}`,
        'error',
      );
    }
    const next = new URLSearchParams(searchParams);
    ['connector', 'name', 'reason', 'code', 'scopes', 'read'].forEach(k => next.delete(k));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const connectApp = async (appId: string) => {
    setConnectingProvider(appId);
    try { window.location.href = await startOAuthConnect(workspaceId, appId); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Could not start connect', 'error'); setConnectingProvider(null); }
  };

  const openTokenModal = (app: TokenAppUI) => {
    setTokenApp(app); setTokenShop(''); setTokenValue(''); setTokenShared(false);
  };

  const connectToken = async () => {
    if (!tokenApp || !tokenValue.trim() || (tokenApp.needsShop && !tokenShop.trim())) return;
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
            <Plug className="w-5 h-5 text-violet-500" />
            Connectors
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Connect external MCP tools to use in Chat.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-violet-200 dark:shadow-none shrink-0"
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
          <LayoutGrid className="w-5 h-5 text-violet-500" />
          Apps
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {IS_SELF_HOSTED
            ? 'One-click app connectors are available on Sqemes Cloud.'
            : 'One-click connectors — sign in once, then use them in Chat.'}
        </p>
      </div>
      {IS_SELF_HOSTED ? (
        /* Self-host: the managed one-click apps need Cloud OAuth infra — show a CTA, not broken tiles. */
        <div className="rounded-2xl border border-violet-100 dark:border-violet-900/40 bg-gradient-to-br from-violet-50 to-white dark:from-violet-900/20 dark:to-slate-800/50 p-6 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-4">
            {OAUTH_APPS.map(app => (
              <div key={app.id} className="w-9 h-9 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 flex items-center justify-center shadow-sm">
                <app.Icon className="w-5 h-5" />
              </div>
            ))}
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">One-click app connectors</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-md mx-auto">
            Connect Gmail, Google Calendar, Docs, Sheets, Drive, and Outlook straight into your chat — no API keys, no setup. Available on Sqemes Cloud.
          </p>
          <a
            href="https://sqemes.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-violet-200 dark:shadow-none"
          >
            Explore Sqemes Cloud <ArrowUpRight className="w-4 h-4" />
          </a>
        </div>
      ) : (
      <div className="space-y-3">
        {OAUTH_APPS.map(app => {
          const appConnector = connectors.find(c => c.provider === app.provider && c.name === app.name);
          const connected = !!appConnector;
          return (
            <div key={app.id} className="flex items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-3 min-w-0">
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
                  <p className={`text-xs mt-0.5 truncate ${connected ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400 dark:text-slate-500'}`}>
                    {connected ? 'Connected' : app.description}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => (app.auth === 'token' ? openTokenModal(app) : connectApp(app.id))}
                  disabled={connectingApp === app.id}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5 ${connected ? 'text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600' : 'text-white bg-violet-600 hover:bg-violet-700'}`}
                >
                  {connectingApp === app.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : connected ? 'Reconnect' : 'Connect'}
                </button>
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
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">Point at a hosted MCP endpoint. Test it, then add.</p>

        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My Shopify store"
          className="w-full p-3 mb-4 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all placeholder:text-slate-400" />

        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">MCP URL</label>
        <input value={mcpUrl} onChange={e => { setMcpUrl(e.target.value); setProbe(null); }} placeholder="https://…/mcp"
          className="w-full p-3 mb-4 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm font-mono outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all placeholder:text-slate-400" />

        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Bearer token <span className="text-slate-400 normal-case font-normal">(optional)</span></label>
        <input value={token} onChange={e => { setToken(e.target.value); setProbe(null); }} type="password" placeholder="Leave empty for a no-auth connector"
          className="w-full p-3 mb-4 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all placeholder:text-slate-400" />

        {canShare && (
          <label className="flex items-start gap-2.5 mb-4 text-sm text-slate-700 dark:text-slate-200 cursor-pointer select-none">
            <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} className="mt-0.5 w-4 h-4 rounded accent-violet-600 cursor-pointer shrink-0" />
            <span>Share with the whole workspace<span className="block text-2xs text-slate-400">Off = personal to you. Shared connectors need admin/editor.</span></span>
          </label>
        )}

        {/* Test connection */}
        <div className="mb-4">
          <button onClick={runProbe} disabled={probing || !mcpUrl.trim()} className="text-xs font-bold text-violet-600 hover:text-violet-700 disabled:opacity-50 flex items-center gap-1.5">
            {probing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing…</> : <><Check className="w-3.5 h-3.5" /> Test connection</>}
          </button>
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
          <button onClick={handleAdd} disabled={saving || !name.trim() || !/^https:\/\//i.test(mcpUrl.trim())}
            className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Adding…</> : 'Add connector'}
          </button>
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
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">{tokenApp.help}</p>

            {tokenApp.needsShop && (
              <>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Shop domain</label>
                <input value={tokenShop} onChange={e => setTokenShop(e.target.value)} placeholder="your-store.myshopify.com"
                  className="w-full p-3 mb-4 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm font-mono outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all placeholder:text-slate-400" />
              </>
            )}

            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">{tokenApp.tokenLabel}</label>
            <input value={tokenValue} onChange={e => setTokenValue(e.target.value)} type="password" placeholder={tokenApp.placeholder}
              className="w-full p-3 mb-4 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all placeholder:text-slate-400" />

            {canShare && (
              <label className="flex items-start gap-2.5 mb-4 text-sm text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                <input type="checkbox" checked={tokenShared} onChange={e => setTokenShared(e.target.checked)} className="mt-0.5 w-4 h-4 rounded accent-violet-600 cursor-pointer shrink-0" />
                <span>Share with the whole workspace<span className="block text-2xs text-slate-400">Off = personal to you. Shared connectors need admin/editor.</span></span>
              </label>
            )}

            <div className="flex gap-2">
              <button onClick={() => setTokenApp(null)} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors">Cancel</button>
              <button onClick={connectToken} disabled={tokenSaving || !tokenValue.trim() || (tokenApp.needsShop && !tokenShop.trim())}
                className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {tokenSaving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting…</> : 'Connect'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
