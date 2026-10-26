import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router';
import { AlertCircle, ArrowRight, Check, Chrome, CreditCard, FilePlus, Loader2, MessageSquare, Sparkles, UserPlus } from 'lucide-react';
import { useWorkspace, usePrompts, useUI } from '../store';
import SetupWizard from '../components/SetupWizard';
import UsageBar, { formatStorage } from '../components/ui/UsageBar';
import { getWorkspaceStorageUsage } from '../lib/api/files';
import McpIcon from '../components/McpIcon';
import KindBadge from '../components/ui/KindBadge';
import AiUsageBar from '../components/AiUsageBar';
import { PLANS } from '../constants';
import { includedCredits } from '../lib/credits';
import { countActiveMcpKeys } from '../lib/mcpKeys';
import { can } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { CHROME_STORE_URL } from '../lib/links';
import { useExtensionInstalled } from '../hooks/useExtensionInstalled';
import { firstTextModelId } from '../lib/authoringAI';
import { buildEnabledModels } from '../lib/enabledModels';
import { isTrialing, trialDaysLeft } from '../lib/subscription';
import { IS_SELF_HOSTED, functionCallUrl } from '../lib/env';
import { canManage } from '../lib/navMode';
import { needsAttention } from '../lib/needsAttention';
import { fetchPersonas } from '../lib/api/personas';
import type { Persona } from '../types';
import { fetchUsageSummary, fetchWebSearchUsage } from '../lib/api/usage';
import { usageLine, type ChannelUsage, type UsageChannel } from '../lib/usageSummary';

/**
 * SQEM-552 — the Manage Overview (redesign 4/4: C's look, the Leitstand from A). The home of the
 * Manage mode for admins and editors; members are sent to Start.
 *
 * Shows only data that exists: whether each channel is set up, how often it was used in the last 7
 * UTC days with its most used playbook (SQEM-553, `workspace_usage_summary` — aggregates, never a
 * person), what needs attention (lib/needsAttention.ts), what changed recently, and the plan. When the
 * usage cannot be loaded the cards show no number at all: a zero we cannot back is a guess shown as a fact.
 *
 * The Connections rows and the plan card moved here from Start (SQEM-550): the plan card's
 * logic is unchanged, only its managed variant uses the brand instead of Tailwind's violet.
 */
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

const Overview = () => {
  const { workspace, currentUser } = useWorkspace();
  const { prompts } = usePrompts();
  const { isLoading, showToast } = useUI();
  const extensionInstalled = useExtensionInstalled();
  const allowed = canManage(currentUser.role);
  const isAdmin = can(currentUser, workspace, 'team:manage');

  // SQEM-555 — the setup banner moved here from Start: it opens the wizard on this page. The
  // first-visit auto-open stays on Start; both read the same per-workspace flag.
  const wizardKey = `sqemes_setup_${workspace.id}`;
  const [showWizard, setShowWizard] = useState(false);
  const [wizardFlag, setWizardFlag] = useState<string | null>(() => {
    try { return localStorage.getItem(wizardKey); } catch { return null; }
  });
  const emptyWorkspace = isAdmin && !isLoading && prompts.length === 0;
  const handleWizardClose = (completed: boolean) => {
    const flag = completed ? 'complete' : 'dismissed';
    try { localStorage.setItem(wizardKey, flag); } catch { /* the banner then simply comes back */ }
    setWizardFlag(flag);
    setShowWizard(false);
  };

  // SQEM-555 — storage for the plan card's usage bar (Cloud only; null on self-host or on failure,
  // and then only that bar is missing).
  const [storage, setStorage] = useState<{ used: number; limit: number | null } | null>(null);
  useEffect(() => {
    if (IS_SELF_HOSTED || !workspace.id) return;
    let cancelled = false;
    getWorkspaceStorageUsage(workspace.id).then(u => { if (!cancelled) setStorage(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [workspace.id]);

  // SQEM-594 — the included web searches of this credit period (Cloud, only while the workspace uses
  // OUR search key; with its own Linkup/Brave key nothing is counted, so there is no bar).
  const ownSearchKey = !!workspace.apiKeys.search_linkup || !!workspace.apiKeys.search_brave;
  const [webSearch, setWebSearch] = useState<{ used: number; limit: number | null } | null>(null);
  useEffect(() => {
    if (IS_SELF_HOSTED || !workspace.id || !workspace.webSearchHosted || ownSearchKey) { setWebSearch(null); return; }
    let cancelled = false;
    fetchWebSearchUsage(workspace.id).then(u => { if (!cancelled) setWebSearch(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [workspace.id, workspace.webSearchHosted, ownSearchKey]);

  // SQEM-057 — reactivate a subscription that's set to cancel (via the Stripe portal).
  const [portalLoading, setPortalLoading] = useState(false);
  const openBillingPortal = async () => {
    setPortalLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch(functionCallUrl('create-portal-session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspaceId: workspace.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to open billing portal');
      window.location.href = data.url;
    } catch (err: any) {
      showToast(err.message || 'Failed to open billing portal', 'error');
      setPortalLoading(false);
    }
  };

  const canManageConnections = can(currentUser, workspace, 'api-keys:manage');

  const [personas, setPersonas] = useState<Persona[] | null>(null);
  useEffect(() => {
    if (!allowed || !workspace.id) return;
    let cancelled = false;
    fetchPersonas(workspace.id).then(p => { if (!cancelled) setPersonas(p); }).catch(() => { if (!cancelled) setPersonas([]); });
    return () => { cancelled = true; };
  }, [allowed, workspace.id]);

  // SQEM-226 — moved from Start: null while loading, so a connected workspace never flashes "Set up".
  // SQEM-553 — usage per channel (last 7 UTC days). `null` = not loaded or refused: then the cards
  // show no number at all rather than a misleading zero.
  const [usage, setUsage] = useState<Partial<Record<UsageChannel, ChannelUsage>> | null>(null);
  useEffect(() => {
    if (!allowed || !workspace.id) return;
    let cancelled = false;
    fetchUsageSummary(workspace.id).then(u => { if (!cancelled) setUsage(u); }).catch(() => { if (!cancelled) setUsage(null); });
    return () => { cancelled = true; };
  }, [allowed, workspace.id]);
  const playbookTitles = useMemo(
    () => new Map(prompts.map(p => [p.id, { title: p.title, kind: p.kind }] as const)),
    [prompts],
  );

  const [mcpKeysActive, setMcpKeysActive] = useState<number | null>(null);
  useEffect(() => {
    if (!canManageConnections || !workspace.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('sqemes_api_keys')
        .select('is_oauth, expires_at, connection_expires_at')
        .eq('workspace_id', workspace.id);
      if (!cancelled) setMcpKeysActive(countActiveMcpKeys(data || []));
    })();
    return () => { cancelled = true; };
  }, [canManageConnections, workspace.id]);

  const enabledModels = useMemo(
    () => buildEnabledModels(workspace.apiKeys, workspace.openrouterModels, workspace.fundedAvailable),
    [workspace.apiKeys, workspace.openrouterModels, workspace.fundedAvailable],
  );
  const apiKeysConfigured = useMemo(() => Object.values(workspace.apiKeys).filter(Boolean).length, [workspace.apiKeys]);

  const attention = useMemo(() => personas === null ? null : needsAttention({
    personas,
    playbooks: prompts,
    hasUsableModel: enabledModels.length > 0,
    canManageKeys: canManageConnections,
  }), [personas, prompts, enabledModels.length, canManageConnections]);

  const recent = useMemo(
    () => [...prompts].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)).slice(0, 6),
    [prompts],
  );

  // ── Plan card values (moved from Start unchanged, SQEM-057/119/207) ──
  const currentPlan = PLANS[workspace.plan];
  const planBadge = isTrialing(workspace)
    ? (() => {
        const d = trialDaysLeft(workspace);
        return d == null ? 'Trial' : d === 1 ? '1 day left' : `${d} days left`;
      })()
    : workspace.cancelAtPeriodEnd
      ? 'Canceling'
      : null;
  const seatsUsed = workspace.members.length;
  const seatsLimit = workspace.isManaged ? null : currentPlan.users;
  const hasByokText = useMemo(() => firstTextModelId(workspace.apiKeys, workspace.openrouterModels) !== null, [workspace.apiKeys, workspace.openrouterModels]);
  const effectiveCreditsLimit = includedCredits(workspace);
  const showAiCredits = !!workspace.fundedAvailable && (hasByokText || effectiveCreditsLimit > 0);

  // ⛔ Decide only once the role is known. While the store loads (and during a workspace switch) the
  // user is a placeholder with role 'member' and an empty member list — redirecting on that sent
  // admins to Start on every reload of /overview (found in the local check).
  const roleKnown = !!currentUser.id && workspace.members.some(m => m.id === currentUser.id);
  if (!roleKnown) return null;
  if (!allowed) return <Navigate to="/" replace />;

  const personaCount = personas?.length;
  // SQEM-553 — the usage block under a card's state; nothing while unknown.
  const usageBlock = (ch: UsageChannel) => {
    if (usage === null) return null;
    const line = usageLine(usage[ch], playbookTitles);
    return (
      <div data-usage={ch}>
        <p className="flex items-baseline gap-2">
          {line.count > 0 && <span className="font-display text-2xl font-semibold text-ink-strong tabular-nums">{line.count}</span>}
          <span className="text-xs text-ink-muted">{line.label}</span>
        </p>
        {line.top && (
          <p className="text-xs text-ink-muted mt-1 truncate">
            Most used: <Link to={`/playbooks?id=${encodeURIComponent(line.top.id)}`} className="font-medium text-ink hover:underline">{line.top.title}</Link>
          </p>
        )}
      </div>
    );
  };
  const channel = (icon: ReactNode, name: string, state: ReactNode, ok: boolean | null, action?: ReactNode, usageNode?: ReactNode) => (
    <div className="rounded-card bg-surface-sunken p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-control bg-surface-raised flex items-center justify-center text-accent shrink-0">{icon}</span>
        <span className="font-semibold text-ink-strong flex-1">{name}</span>
        {ok !== null && (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-raised text-xs font-semibold ${ok ? 'text-success' : 'text-ink-muted'}`}>
            <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-success' : 'bg-ink-subtle'}`} /> {ok ? 'Ready' : 'Not set up'}
          </span>
        )}
      </div>
      <div className="text-sm text-ink-muted">{state}</div>
      {usageNode}
      {action}
    </div>
  );

  return (
    <div className="p-4 md:p-8 pb-16 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div className="min-w-0">
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink-strong">Overview</h1>
          <p className="text-ink-muted mt-2">
            {workspace.name} · {prompts.length} playbook{prompts.length === 1 ? '' : 's'}
            {personaCount !== undefined && ` · ${personaCount} persona${personaCount === 1 ? '' : 's'}`}
            {` · ${seatsUsed} member${seatsUsed === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link to="/settings" state={{ initialTab: 'team' }} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-control border border-line-strong bg-surface-raised text-sm font-semibold text-ink-strong hover:bg-surface-sunken transition-colors">
              <UserPlus className="w-4 h-4" /> Invite
            </Link>
          )}
          <Link to="/playbooks/new" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-control bg-accent-strong text-white text-sm font-semibold hover:opacity-90 transition-opacity">
            <FilePlus className="w-4 h-4" /> New playbook
          </Link>
        </div>
      </div>

      {/* SQEM-057 — trial/canceling + setup banners, moved here from Start by SQEM-555. */}
      {(isTrialing(workspace) || (emptyWorkspace && wizardFlag === 'dismissed' && !showWizard)) && (
        <div className="mb-8 flex flex-col md:flex-row md:justify-end gap-4">
          {isTrialing(workspace) && (
            <div className={`md:w-1/2 animate-step-in flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 rounded-2xl border ${workspace.cancelAtPeriodEnd ? 'border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20' : 'border-brand-200 dark:border-brand-800/50 bg-brand-50 dark:bg-brand-900/20'}`}>
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl shrink-0 ${workspace.cancelAtPeriodEnd ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400' : 'bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400'}`}>
                  {workspace.cancelAtPeriodEnd ? <CreditCard className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                </div>
                <div>
                  {workspace.cancelAtPeriodEnd ? (
                    <>
                      <p className="text-base font-bold text-slate-900 dark:text-slate-100">Your subscription is cancelled</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        {workspace.name} will be deactivated after {workspace.trialEndsAt ? new Date(workspace.trialEndsAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'the trial ends'}.
                      </p>
                    </>
                  ) : (
                    <>
                      {/* SQEM-419 — the remaining time was a sentence among sentences. As a chip it is
                          the one thing this banner exists to say, readable without reading. */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {(() => {
                          const d = trialDaysLeft(workspace);
                          return d == null ? null : (
                            <span className="text-2xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-brand-600 text-white">
                              {d === 1 ? '1 day left' : `${d} days left`}
                            </span>
                          );
                        })()}
                        <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                          Your {workspace.plan} trial is active
                        </p>
                      </div>
                      {/* SQEM-205 — the commitment was named here, the way out was not. The product
                          said the card is on file and the trial converts automatically, while the
                          word "cancel" first appeared four plan cards down on the billing page.
                          Naming both in the same breath is the honest version — and the cancellation
                          itself is already self-serve, so there is nothing to soften. */}
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">Your card is on file — the trial converts to a paid {workspace.plan} subscription automatically. Cancel any time before then and you won&apos;t be charged.</p>
                    </>
                  )}
                </div>
              </div>
              {isAdmin && (
                workspace.cancelAtPeriodEnd ? (
                  <button
                    onClick={openBillingPortal}
                    disabled={portalLoading}
                    className="shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {portalLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Opening…</> : 'Reactivate'}
                  </button>
                ) : (
                  <Link to="/settings" state={{ initialTab: 'plans' }} className="shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-brand-200 dark:border-brand-700 text-brand-700 dark:text-brand-300 rounded-xl text-sm font-bold hover:bg-brand-50 dark:hover:bg-slate-700 transition-all">
                    Manage plan <ArrowRight className="w-4 h-4" />
                  </Link>
                )
              )}
            </div>
          )}

          {/* SQEM-201 — the offer to finish setup depends on the workspace still being empty, not on
              which button someone left through. This used to require `wizardFlag === 'dismissed'`,
              so bailing out at step 1 kept the way back while walking to the last step and declining
              only the generation set the flag to 'complete' and removed it for good — the more
              engaged user was the one who got locked out. `emptyWorkspace` already covers the case
              that matters: once templates exist, the banner is gone regardless of the flag.

              SQEM-419 — this is the invitation into the setup wizard, so it looks like the wizard
              (SQEM-417): the same dark brand band, the icon on a light tile, the button in white.
              ⚠️ The ring is not decoration — on a dark dashboard a dark band without it dissolves
              into the background. */}
          {emptyWorkspace && wizardFlag !== null && !showWizard && (
            <div className="md:w-1/2 relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 text-white shadow-lg dark:ring-1 dark:ring-brand-700/60 animate-step-in">
              <div aria-hidden className="pointer-events-none absolute -top-20 -right-16 w-48 h-48 rounded-full bg-brand-500/30 blur-3xl" />
              <div className="relative flex items-center gap-3.5">
                <div className="p-2.5 rounded-xl bg-white/15 text-white shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-base font-bold tracking-tight">Finish setting up your workspace</p>
                  {/* SQEM-201 — no longer mentions MCP: it left the wizard and lives in the
                      Connections card right below this banner.
                      ⛔ SQEM-424 — and it no longer starts with the provider key. The sentence still
                      carried the pre-SQEM-386 order (key → extension → playbooks), which is exactly the
                      order three UX tests rejected: it opened with the one screen that explains nothing.
                      A banner that advertises the wizard must advertise the wizard's real order.
                      ⚠️ Self-host gets its own sentence: there is no playbook-generation step there
                      (SQEM-170), so promising one would be a lie told on the first screen. */}
                  <p className="text-sm text-brand-100/90 mt-1 leading-relaxed">
                    {IS_SELF_HOSTED
                      ? <>Choose where you want to use your playbooks — and set up only that.</>
                      : <>Let AI write your first playbooks, choose where you want to use them, and set up only that.</>}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowWizard(true)}
                // SQEM-386 — full width on a phone: in testing it read as too unobtrusive.
                className="relative w-full sm:w-auto justify-center shrink-0 inline-flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-brand-50 text-brand-800 rounded-xl text-sm font-bold transition-all shadow-sm"
              >
                Finish setup <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {showWizard && <SetupWizard onClose={handleWizardClose} />}

      {/* Channels — the state, and since SQEM-553 the use of the last 7 days. */}
      {/* SQEM-568 — `grid-cols-1` is `minmax(0, 1fr)`: without it the one phone column sized itself to the
          longest unbreakable content (a truncated title is nowrap) and ran past the screen. */}
      <section aria-label="Channels" className="grid grid-cols-1 gap-4 md:grid-cols-3 mb-6">
        {channel(<Chrome className="w-4 h-4" />, 'Browser extension',
          extensionInstalled ? 'Installed in this browser.' : 'Not found in this browser.',
          extensionInstalled,
          !extensionInstalled && <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent inline-flex items-center gap-1">Install <ArrowRight className="w-3.5 h-3.5" /></a>,
          usageBlock('extension'),
        )}
        {channel(<McpIcon className="w-4 h-4" />, 'MCP server',
          mcpKeysActive === null ? 'Use your playbooks in Claude, ChatGPT, Cursor and other AI tools.' : mcpKeysActive > 0 ? `${mcpKeysActive} active connection${mcpKeysActive === 1 ? '' : 's'}.` : 'No active connection yet.',
          mcpKeysActive === null ? null : mcpKeysActive > 0,
          canManageConnections && <Link to="/settings" state={{ initialTab: 'api' }} className="text-sm font-semibold text-accent inline-flex items-center gap-1">{mcpKeysActive ? 'Manage' : 'Set up'} <ArrowRight className="w-3.5 h-3.5" /></Link>,
          usageBlock('mcp'),
        )}
        {channel(<MessageSquare className="w-4 h-4" />, 'Chat',
          enabledModels.length > 0
            ? (apiKeysConfigured > 0 ? `${apiKeysConfigured} provider key${apiKeysConfigured === 1 ? '' : 's'} · ${enabledModels.length} model${enabledModels.length === 1 ? '' : 's'}` : `${enabledModels.length} managed model${enabledModels.length === 1 ? '' : 's'}`)
            : 'No AI model available yet.',
          enabledModels.length > 0,
          canManageConnections && <Link to="/settings" state={{ initialTab: 'api' }} className="text-sm font-semibold text-accent inline-flex items-center gap-1">{/* SQEM-424 — the same words as the wizard step it leads to. */}{apiKeysConfigured > 0 ? 'AI provider keys' : 'Add AI provider key'} <ArrowRight className="w-3.5 h-3.5" /></Link>,
          usageBlock('chat'),
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-1 order-2 lg:order-1">
          <section aria-labelledby="overview-attention" className="rounded-card border border-line bg-surface-raised p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 id="overview-attention" className="font-display text-lg font-semibold text-ink-strong">Needs attention</h2>
              {attention && attention.length > 0 && <span className="px-2 py-0.5 rounded-full bg-warning-soft text-warning text-xs font-bold">{attention.length}</span>}
            </div>
            {attention === null ? (
              <p className="text-sm text-ink-subtle">Checking…</p>
            ) : attention.length === 0 ? (
              <p className="text-sm text-ink-muted flex items-center gap-2"><Check className="w-4 h-4 text-success" /> All set — nothing needs attention.</p>
            ) : (
              <ul className="space-y-2">
                {attention.map(a => (
                  <li key={a.kind} className="flex items-start gap-3 p-3 rounded-control bg-surface-sunken">
                    <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink-strong">{a.title}</p>
                      <p className="text-xs text-ink-muted">{a.detail}</p>
                    </div>
                    <Link
                      to={a.to}
                      state={a.kind === 'chat-without-model' ? { initialTab: 'api' } : undefined}
                      className="text-sm font-semibold text-accent inline-flex items-center gap-1 shrink-0"
                    >
                      {a.actionLabel} <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* SQEM-119 — no subscription model on self-host, so no plan card */}
          {!IS_SELF_HOSTED && (workspace.isManaged ? (
            <div className="bg-gradient-to-br from-brand-900 to-brand-800 rounded-2xl p-6 text-white shadow-lg">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-brand-200 flex items-center gap-2">
                    <CreditCard className="w-3 h-3" /> Current Plan
                  </span>
                  <h3 className="text-2xl font-bold mt-1">Managed</h3>
                </div>
                <span className="bg-brand-700/50 px-3 py-1 rounded-lg text-xs font-bold border border-brand-600">€0/mo</span>
              </div>
              <div className="flex justify-between text-xs mb-1.5 text-brand-100">
                <span className="font-medium">Team Members</span>
                <span className="font-bold">Unlimited</span>
              </div>
              <div className="flex justify-between items-center mt-1.5">
                <p className="text-xs text-brand-300">{seatsUsed} member{seatsUsed !== 1 ? 's' : ''} · BYOK</p>
              </div>
              {storage && <div className="mt-4"><UsageBar label="Storage" used={storage.used} limit={storage.limit} format={formatStorage} tone="onBrand" /></div>}
            </div>
          ) : (
          <div className="bg-gradient-to-br from-brand-900 to-brand-800 rounded-2xl p-6 text-white shadow-lg">
            <div className="flex justify-between items-start mb-1">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-brand-200 flex items-center gap-2">
                  <CreditCard className="w-3 h-3" /> Current Plan
                </span>
                <h3 className="text-2xl font-bold mt-1">{workspace.plan}</h3>
              </div>
              {planBadge && (
                <span className={`px-3 py-1 rounded-lg text-xs font-bold border ${
                  workspace.cancelAtPeriodEnd
                    ? 'bg-amber-400/20 border-amber-300/50 text-amber-100'
                    : 'bg-brand-700/50 border-brand-600'
                }`}>
                  {planBadge}
                </span>
              )}
            </div>
            <p className="text-xs text-brand-300 mb-4">{currentPlan.tagline}</p>

            {/* SQEM-555 — usage as bars: seats, storage (and credits below, as before). */}
            <div className="mb-4 space-y-3">
              <UsageBar label="Seats" used={seatsUsed} limit={seatsLimit} tone="onBrand" />
              {storage && <UsageBar label="Storage" used={storage.used} limit={storage.limit} format={formatStorage} tone="onBrand" />}
              {webSearch && <UsageBar label="Web searches" used={webSearch.used} limit={webSearch.limit} format={n => n.toLocaleString('en-US')} tone="onBrand" />}
            </div>

            {showAiCredits && (
              <div className="mb-4">
                <AiUsageBar used={workspace.creditsUsed} limit={effectiveCreditsLimit} fundedAvailable={workspace.fundedAvailable} hasByokText={hasByokText} />
              </div>
            )}

            <ul className="space-y-1.5 mb-5">
              {currentPlan.features.map(feature => (
                <li key={feature} className="flex items-center gap-2 text-xs text-brand-100">
                  <Check className="w-3 h-3 text-brand-400 shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>

            {isAdmin && (
              <Link to="/settings" state={{ initialTab: 'plans' }} className="block w-full py-3 bg-white text-brand-900 text-center rounded-xl text-xs font-bold hover:bg-brand-50 transition-colors shadow-md">
                Manage plan
              </Link>
            )}
          </div>
          ))}
        </div>

        <section aria-labelledby="overview-recent" className="min-w-0 lg:col-span-2 rounded-card border border-line bg-surface-raised p-5 order-1 lg:order-2">
          <div className="flex items-center justify-between mb-3">
            <h2 id="overview-recent" className="font-display text-lg font-semibold text-ink-strong">Recently changed</h2>
            <Link to="/playbooks" className="text-sm font-semibold text-accent inline-flex items-center gap-1">All playbooks <ArrowRight className="w-3.5 h-3.5" /></Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-ink-muted">No playbooks yet.</p>
          ) : (
            <ul>
              {recent.map(p => (
                <li key={p.id}>
                  <Link to={`/playbooks?id=${p.id}`} className="flex items-center gap-3 px-2 py-2.5 rounded-control hover:bg-surface-sunken transition-colors">
                    <span aria-hidden className={`w-2.5 h-2.5 rounded-full shrink-0 ${p.kind === 'prompt' ? 'bg-accent' : 'bg-skill'}`} />
                    <span className="flex-1 min-w-0 text-sm font-semibold text-ink-strong truncate">{p.title}</span>
                    <span className="hidden sm:block"><KindBadge kind={p.kind} /></span>
                    {p.tag && <span className="hidden md:block text-xs text-ink-muted w-24 truncate">{p.tag}</span>}
                    <span className="text-xs text-ink-subtle w-24 text-right shrink-0">{ago(p.updatedAt || p.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};

export default Overview;
