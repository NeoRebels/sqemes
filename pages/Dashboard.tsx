import { useState, useMemo, useEffect } from 'react';
import { useUI, useWorkspace, usePrompts } from '../store';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CreditCard, Check, Sparkles, Loader2, MessageSquarePlus, FilePlus, Key, Chrome } from 'lucide-react';
import McpIcon from '../components/McpIcon';
import { PLANS, PLAN_AI_CREDITS } from '../constants';
import { can } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import Card from '../components/ui/Card';
import KindBadge from '../components/ui/KindBadge';
import SetupWizard from '../components/SetupWizard';
import AiUsageBar from '../components/AiUsageBar';
import RecentChatsWidget from '../components/RecentChatsWidget';
import { CHROME_STORE_URL } from '../lib/links';
import { useExtensionInstalled } from '../hooks/useExtensionInstalled';
import { firstTextModelId } from '../lib/authoringAI';
import { isTrialing, trialDaysLeft } from '../lib/subscription';
import { IS_SELF_HOSTED } from '../lib/env';

const Dashboard = () => {
  const { workspace, currentUser } = useWorkspace();
  const { prompts } = usePrompts();
  const { isLoading, showToast } = useUI();
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash;
    const queryStart = hash.indexOf('?');
    if (queryStart !== -1) {
      const params = new URLSearchParams(hash.slice(queryStart));
      if (params.get('checkout') === 'success') {
        showToast('Subscription activated! Your plan has been updated.', 'success');
        window.history.replaceState({}, '', window.location.pathname + '#/');
      }
    }
  }, []);

  const isAdmin = can(currentUser, workspace, 'team:manage');
  const canCreate = can(currentUser, workspace, 'prompts:edit');
  // SQEM-093 — provider keys + MCP server are workspace connections members can't manage; hide them for members.
  const canManageConnections = can(currentUser, workspace, 'api-keys:manage');
  const extensionInstalled = useExtensionInstalled();

  // --- Setup wizard (SQEM-035): admins of an empty workspace ---
  const wizardKey = `sqemes_setup_${workspace.id}`;
  const [showWizard, setShowWizard] = useState(false);
  const [wizardFlag, setWizardFlag] = useState<string | null>(() => localStorage.getItem(wizardKey));
  const emptyWorkspace = isAdmin && !isLoading && prompts.length === 0;

  useEffect(() => {
    if (emptyWorkspace && wizardFlag === null) setShowWizard(true);
  }, [emptyWorkspace, wizardFlag]);

  const handleWizardClose = (completed: boolean) => {
    const flag = completed ? 'complete' : 'dismissed';
    localStorage.setItem(wizardKey, flag);
    setWizardFlag(flag);
    setShowWizard(false);
  };

  // SQEM-057 — reactivate a subscription that's set to cancel (via the Stripe portal).
  const [portalLoading, setPortalLoading] = useState(false);
  const openBillingPortal = async () => {
    setPortalLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-portal-session`, {
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

  const currentPlan = PLANS[workspace.plan];
  const displayPrice = workspace.billingCycle === 'yearly'
    ? `€${currentPlan.priceYearly}/mo`
    : currentPlan.price;
  const seatsUsed = workspace.members.length;
  const seatsLimit = workspace.isManaged ? null : currentPlan.users;
  const seatsPercentage = seatsLimit ? Math.min((seatsUsed / seatsLimit) * 100, 100) : 0;
  const apiKeysConfigured = useMemo(
    () => Object.values(workspace.apiKeys).filter(Boolean).length,
    [workspace.apiKeys]
  );
  // SQEM-082 — a BYOK text key means funded credits are never consumed (own key wins).
  const hasByokText = useMemo(() => firstTextModelId(workspace.apiKeys) !== null, [workspace.apiKeys]);
  // Effective allowance: the provisioned DB limit if set, else the tier's decided
  // allowance (display-only until SQEM-057 provisions credits_limit). Managed stays
  // genuinely unlimited (no plan fallback).
  const effectiveCreditsLimit = workspace.creditsLimit > 0
    ? workspace.creditsLimit
    : (workspace.isManaged ? 0 : (PLAN_AI_CREDITS[workspace.plan] ?? 0));
  const showAiCredits = !!workspace.fundedAvailable && (hasByokText || effectiveCreditsLimit > 0);

  // SQEM-086 — "Favourites": the user's starred templates (all kinds, incl. skills).
  // Click re-launches the template into a new chat.
  const quickTemplates = useMemo(
    () => prompts.filter(p => p.isFavorite).slice(0, 6),
    [prompts],
  );

  // SQEM-086 — primary create actions, shown above Connections in the right column.
  const actions = [
    { label: 'New chat', to: '/chat', icon: MessageSquarePlus },
    ...(canCreate ? [{ label: 'New template', to: '/prompts/new', icon: FilePlus }] : []),
  ];

  return (
    <div className="p-4 md:p-8 pb-16 max-w-7xl mx-auto">
      {showWizard && <SetupWizard onClose={handleWizardClose} />}

      <div className="mb-8 md:mb-10 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">Overview of <span className="font-semibold text-brand-600">{workspace.name}</span> workspace</p>
        </div>
        <div className="text-sm text-slate-500 dark:text-slate-400 font-medium">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {/* SQEM-057 — trial/canceling + setup banners: 50% each in one row, right-aligned
          (a lone banner sits on the right). */}
      {(isTrialing(workspace) || (emptyWorkspace && wizardFlag === 'dismissed' && !showWizard)) && (
        <div className="mb-8 flex flex-col md:flex-row md:justify-end gap-4">
          {isTrialing(workspace) && (
            <div className={`md:w-1/2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 rounded-2xl border ${workspace.cancelAtPeriodEnd ? 'border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20' : 'border-brand-200 dark:border-brand-800/50 bg-brand-50 dark:bg-brand-900/20'}`}>
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl shrink-0 ${workspace.cancelAtPeriodEnd ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400' : 'bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400'}`}>
                  {workspace.cancelAtPeriodEnd ? <CreditCard className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                </div>
                <div>
                  {workspace.cancelAtPeriodEnd ? (
                    <>
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Your subscription is cancelled</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {workspace.name} will be deactivated after {workspace.trialEndsAt ? new Date(workspace.trialEndsAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'the trial ends'}.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {(() => {
                          const d = trialDaysLeft(workspace);
                          if (d == null) return `Your ${workspace.plan} trial is active`;
                          return `${d === 1 ? '1 day' : `${d} days`} left in your ${workspace.plan} trial`;
                        })()}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Your card is on file — the trial converts to a paid {workspace.plan} subscription automatically.</p>
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

          {emptyWorkspace && wizardFlag === 'dismissed' && !showWizard && (
            <div className="md:w-1/2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 rounded-2xl border border-brand-200 dark:border-brand-800/50 bg-brand-50 dark:bg-brand-900/20">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400 shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Finish setting up your workspace</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Connect a provider key, MCP, or the extension to get started.</p>
                </div>
              </div>
              <button
                onClick={() => setShowWizard(true)}
                className="shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-brand-200 dark:shadow-none"
              >
                Finish setup <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
        {/* Left column */}
        <div className="lg:col-span-2 flex flex-col gap-6">

          {/* SQEM-086 — Favourites (starred templates, quick re-launch) */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Favourites</h2>
              <Link to="/templates" className="text-sm font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1">
                All templates <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
            {isLoading && quickTemplates.length === 0 ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-300" /></div>
            ) : quickTemplates.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <p className="text-sm text-slate-400 dark:text-slate-500">No favourite templates yet.</p>
                <Link to="/templates" className="text-sm font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1">
                  Star a template to pin it here <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {quickTemplates.map(t => (
                  <button
                    key={t.id}
                    onClick={() => navigate('/chat', { state: { launchTemplateId: t.id } })}
                    className="group flex items-center gap-2.5 p-3 rounded-xl border border-slate-100 dark:border-slate-700 hover:border-brand-200 dark:hover:border-brand-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-left transition-all"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <KindBadge kind={t.kind} />
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{t.title}</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-brand-500 shrink-0 transition-colors" />
                  </button>
                ))}
              </div>
            )}
          </Card>

          {/* SQEM-085 — unified recent chats (Sqemes + extension external history) */}
          <RecentChatsWidget />
        </div>

        {/* Right column */}
        <div className="space-y-6">

          {/* SQEM-086 — primary create actions (side by side; full-width if lone) */}
          <div className={`grid gap-3 ${actions.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {actions.map(a => (
              <Link
                key={a.label}
                to={a.to}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white shadow-lg shadow-brand-200 dark:shadow-none transition-all"
              >
                <a.icon className="w-4 h-4" /> {a.label}
              </Link>
            ))}
          </div>

          {/* SQEM-086 — Connections */}
          <Card className="p-6">
            <h2 className="font-bold text-slate-800 dark:text-slate-100 text-lg mb-4">Connections</h2>
            <div className="space-y-1">
              {canManageConnections && (
                <>
                  <Link to="/settings" state={{ initialTab: 'api' }} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0"><Key className="w-4 h-4 text-slate-500 dark:text-slate-400" /></div>
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex-1">Provider keys</span>
                    {apiKeysConfigured > 0
                      ? <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><Check className="w-3.5 h-3.5" />{apiKeysConfigured} set</span>
                      : <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">None set</span>}
                  </Link>
                  <Link to="/settings" state={{ initialTab: 'api' }} className="group flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0"><McpIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" /></div>
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex-1">MCP server</span>
                    <span className="text-xs font-semibold text-brand-600 dark:text-brand-400 flex items-center gap-1">Set up <ArrowRight className="w-3.5 h-3.5" /></span>
                  </Link>
                </>
              )}
              <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0"><Chrome className="w-4 h-4 text-slate-500 dark:text-slate-400" /></div>
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex-1">Browser extension</span>
                {extensionInstalled
                  ? <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><Check className="w-3.5 h-3.5" />Installed</span>
                  : <span className="text-xs font-semibold text-brand-600 dark:text-brand-400 flex items-center gap-1">Install <ArrowRight className="w-3.5 h-3.5" /></span>}
              </a>
            </div>
          </Card>

          {/* SQEM-119 — no subscription model on self-host, so no plan card */}
          {!IS_SELF_HOSTED && (workspace.isManaged ? (
            <div className="bg-gradient-to-br from-violet-900 to-violet-800 rounded-2xl p-6 text-white shadow-lg">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-violet-200 flex items-center gap-2">
                    <CreditCard className="w-3 h-3" /> Current Plan
                  </span>
                  <h3 className="text-2xl font-bold mt-1">Managed</h3>
                </div>
                <span className="bg-violet-700/50 px-3 py-1 rounded-lg text-xs font-bold border border-violet-600">€0/mo</span>
              </div>
              <div className="flex justify-between text-xs mb-1.5 text-violet-100">
                <span className="font-medium">Team Members</span>
                <span className="font-bold">Unlimited</span>
              </div>
              <div className="flex justify-between items-center mt-1.5">
                <p className="text-xs text-violet-300">{seatsUsed} member{seatsUsed !== 1 ? 's' : ''} · BYOK</p>
              </div>
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
              <span className="bg-brand-700/50 px-3 py-1 rounded-lg text-xs font-bold border border-brand-600">{displayPrice}</span>
            </div>
            <p className="text-xs text-brand-300 mb-4">{currentPlan.tagline}</p>

            <div className="mb-4">
              <div className="flex justify-between text-xs mb-1.5 text-brand-100">
                <span className="font-medium">Seats</span>
                <span className="font-bold">{seatsUsed} / {seatsLimit}</span>
              </div>
              <div className="h-1.5 w-full bg-brand-950/40 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${seatsPercentage > 90 ? 'bg-red-400' : 'bg-white'}`}
                  style={{ width: `${seatsPercentage}%` }}
                />
              </div>
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
                Manage Subscription
              </Link>
            )}
          </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
