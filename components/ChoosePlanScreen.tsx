import { useState } from 'react';
import { useWorkspace, useUI } from '../store';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { PLANS, TRIAL_DAYS } from '../constants';
import { can } from '../lib/permissions';
import { isPaymentFailing } from '../lib/subscription';
import type { PlanTier } from '../types';
import { Check, Loader2, LogOut, Building2, CreditCard, ExternalLink } from 'lucide-react';

// SQEM-057/083 — gate shown when a non-managed workspace has no active/trialing
// subscription: never-subscribed (pick a plan) or lapsed (resubscribe / fix payment).
// Admins act; members are told to ask an admin. A workspace switcher + sign-out keep
// users with several workspaces from being stranded.
const ChoosePlanScreen = () => {
  const { workspace, currentUser, availableWorkspaces, switchWorkspace } = useWorkspace();
  const { showToast } = useUI();
  const { signOut } = useAuth();

  const isAdmin = can(currentUser, workspace, 'plans:manage');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  // Lapsed with a live sub + failing card → fix in the portal (a fresh checkout would
  // duplicate the subscription). Otherwise (null/canceled) → pick a plan via checkout.
  const paymentFailing = isPaymentFailing(workspace);
  // Distinguish a brand-new workspace (null) from one whose subscription ended.
  const isLapsed = workspace.subscriptionStatus != null;

  const otherWorkspaces = availableWorkspaces.filter(w => w.id !== workspace.id);

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

  const startTrial = async (tier: PlanTier) => {
    setLoadingTier(tier);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspaceId: workspace.id, plan: tier, billingCycle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start checkout');
      window.location.href = data.url;
    } catch (err: any) {
      showToast(err.message || 'Failed to start checkout', 'error');
      setLoadingTier(null);
    }
  };

  return (
    <div className="h-screen overflow-y-auto bg-slate-50 dark:bg-slate-900 flex flex-col items-center px-4 pt-10 pb-32">
      <div className="w-full max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div className="inline-flex items-center gap-2">
            <img src="/logo-favicon-V2.png" alt="sqemes" className="w-9 h-9 rounded-xl shadow-soft" />
            <span className="text-xl font-bold text-slate-900 dark:text-slate-100">sqemes</span>
          </div>
          <button
            onClick={() => signOut()}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>

        {isAdmin ? (
          paymentFailing ? (
            <div className="max-w-md mx-auto text-center bg-white dark:bg-slate-800 rounded-2xl shadow-soft border border-slate-100 dark:border-slate-700 p-8">
              <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
                <CreditCard className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Your last payment failed</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                Update your payment method to keep <span className="font-semibold">{workspace.name}</span> active. Your plan and data are unchanged.
              </p>
              <button
                onClick={openBillingPortal}
                disabled={portalLoading}
                className="w-full mt-6 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2 bg-slate-900 dark:bg-brand-600 text-white hover:bg-slate-700 dark:hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {portalLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Opening…</> : 'Update payment method'}
              </button>
            </div>
          ) : (
          <>
            <div className="text-center mb-8">
              <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">{isLapsed ? 'Your subscription has ended' : 'Choose a plan to get started'}</h1>
              <p className="text-slate-500 dark:text-slate-400 mt-2">
                {isLapsed
                  ? <>Resubscribe to restore access to <span className="font-semibold text-brand-600">{workspace.name}</span>.</>
                  : <>Start a {TRIAL_DAYS}-day free trial for <span className="font-semibold text-brand-600">{workspace.name}</span>. Cancel anytime before it ends.</>}
              </p>
            </div>

            {/* Billing cycle toggle */}
            <div className="flex justify-center mb-8">
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                <button
                  onClick={() => setBillingCycle('monthly')}
                  className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${billingCycle === 'monthly' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setBillingCycle('yearly')}
                  className={`px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${billingCycle === 'yearly' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                >
                  Yearly <span className="text-2xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-md uppercase tracking-wide">Save 20%</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {(Object.keys(PLANS) as PlanTier[]).map(tier => {
                const p = PLANS[tier];
                const price = billingCycle === 'yearly' ? p.priceYearly : parseInt(p.price.replace(/[^0-9]/g, ''), 10);
                const billingText = billingCycle === 'yearly' ? `€${p.priceYearly * 12} billed yearly` : 'Billed monthly';
                const isLoading = loadingTier === tier;
                return (
                  <div key={tier} className="relative p-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-col hover:border-brand-300 dark:hover:border-brand-500 hover:shadow-soft-lg transition-all">
                    <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100">{tier}</h3>
                    <p className="text-xs mt-0.5 mb-4 text-slate-500 dark:text-slate-400">{p.tagline}</p>
                    <div className="mb-6">
                      <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">€{price}<span className="text-base font-medium text-slate-400">/mo</span></p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-1">{billingText}</p>
                    </div>
                    <ul className="space-y-2.5 text-sm flex-1 text-slate-600 dark:text-slate-300">
                      {p.features.map(feature => (
                        <li key={feature} className="flex items-center gap-2.5">
                          <Check className="w-3.5 h-3.5 shrink-0 text-brand-500" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <button
                      disabled={isLoading}
                      onClick={() => startTrial(tier)}
                      className="w-full mt-6 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2 bg-slate-900 dark:bg-brand-600 text-white hover:bg-slate-700 dark:hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting…</> : isLapsed ? 'Resubscribe' : `Start ${TRIAL_DAYS}-day trial`}
                    </button>
                  </div>
                );
              })}

              {/* SQEM-098 — Enterprise: contact-sales card (not a Stripe plan). */}
              <div className="relative p-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-col hover:border-brand-300 dark:hover:border-brand-500 hover:shadow-soft-lg transition-all">
                <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100">Enterprise</h3>
                <p className="text-xs mt-0.5 mb-4 text-slate-500 dark:text-slate-400">For organisations with custom needs</p>
                <div className="mb-6">
                  <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">Let's talk</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-1">Custom pricing for your team</p>
                </div>
                <ul className="space-y-2.5 text-sm flex-1 text-slate-600 dark:text-slate-300">
                  {['Everything in Business', '30+ team members', 'Custom AI credit volume', 'Dedicated support & SLA', 'Custom onboarding'].map(feature => (
                    <li key={feature} className="flex items-center gap-2.5">
                      <Check className="w-3.5 h-3.5 shrink-0 text-brand-500" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <a
                  href="https://sqemes.com/enterprise"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full mt-6 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2 bg-slate-900 dark:bg-brand-600 text-white hover:bg-slate-700 dark:hover:bg-brand-700"
                >
                  Talk to us <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
            <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-4">
              {isLapsed ? 'You’ll be charged when you resubscribe.' : "A card is required to start the trial. You won't be charged until it ends."}{' '}
              Prices exclude VAT, calculated at checkout.
            </p>
          </>
          )
        ) : (
          <div className="max-w-md mx-auto text-center bg-white dark:bg-slate-800 rounded-2xl shadow-soft border border-slate-100 dark:border-slate-700 p-8">
            <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{isLapsed ? "This workspace's subscription is inactive" : 'This workspace needs an active plan'}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              <span className="font-semibold">{workspace.name}</span> {isLapsed ? 'no longer has an active subscription' : "doesn't have an active subscription yet"}. Ask a workspace admin to {paymentFailing ? 'update billing' : 'start a plan'}.
            </p>
          </div>
        )}

        {/* Workspace switcher — for users who belong to other workspaces */}
        {otherWorkspaces.length > 0 && (
          <div className="max-w-md mx-auto mt-8">
            <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 text-center">Or switch workspace</p>
            <select
              value=""
              onChange={(e) => { if (e.target.value) switchWorkspace(e.target.value); }}
              className="w-full px-4 py-3 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
            >
              <option value="" disabled>Select workspace</option>
              {otherWorkspaces.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChoosePlanScreen;
