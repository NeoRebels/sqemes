import { useState, useEffect } from 'react';
import { functionCallUrl } from '../lib/env';
import { useWorkspace, useUI } from '../store';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { startCheckout } from '../lib/billing';
import { PLANS, TRIAL_DAYS } from '../constants';
import { can } from '../lib/permissions';
import { isPaymentFailing } from '../lib/subscription';
import type { PlanTier } from '../types';
import { Check, Loader2, LogOut, Building2, CreditCard, ExternalLink, Download, Shield } from 'lucide-react';
import { buildAccountExport, accountExportFilename } from '../lib/accountExport';
import { downloadBlob } from '../lib/bundleFormat';
import Select from './ui/Select';
import { m } from '../lib/i18n';
import { planFeature, planTagline, planMonthly, planMonthlyAmount, formatEuro } from '../lib/labels';

// SQEM-057/083 — gate shown when a non-managed workspace has no active/trialing
// subscription: never-subscribed (pick a plan) or lapsed (resubscribe / fix payment).
// Admins act; members are told to ask an admin. A workspace switcher + sign-out keep
// users with several workspaces from being stranded.
const ChoosePlanScreen = () => {
  const { workspace, currentUser, availableWorkspaces, switchWorkspace, isSqemesAdmin, setWorkspaceManaged } = useWorkspace();
  const { showToast } = useUI();
  const { signOut } = useAuth();

  const isAdmin = can(currentUser, workspace, 'plans:manage');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [managedBusy, setManagedBusy] = useState(false);

  // SQEM-267 — see the block above the button for why this lives on the gated screen at all.
  // It calls the **existing** account export from SQEM-205, unchanged: that function already
  // gathers templates, chats, files, profile and a README that names its own gaps. Nothing about
  // the export needed building — only a route to it from the screen a lapsed customer is stuck on.
  const [exportStep, setExportStep] = useState<string | null>(null);
  const handleExport = async () => {
    if (!workspace.id || !currentUser) return;
    setExportBusy(true);
    try {
      const blob = await buildAccountExport(workspace, currentUser, p => setExportStep(p.step));
      downloadBlob(blob, accountExportFilename(workspace.name));
      showToast(m.cp_downloaded(), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : m.cp_export_failed(), 'error');
    } finally {
      setExportBusy(false);
      setExportStep(null);
    }
  };

  // SQEM-141 — back from a successful checkout but still gated ⇒ the Stripe webhook hasn't
  // flipped subscription_status yet. Poll for it and reload once it lands, so the paid user
  // isn't stranded on the plan screen (their new/current workspace is upgraded in place).
  const [confirming, setConfirming] = useState(
    () => new URLSearchParams(window.location.hash.split('?')[1] || '').get('checkout') === 'success',
  );
  useEffect(() => {
    if (!confirming || !workspace.id) return;
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      tries += 1;
      const { data } = await supabase
        .from('workspaces')
        .select('subscription_status')
        .eq('id', workspace.id)
        .maybeSingle();
      if (cancelled) return;
      const status = (data as { subscription_status?: string } | null)?.subscription_status;
      if (status === 'active' || status === 'trialing') { window.location.reload(); return; }
      if (tries >= 8) { setConfirming(false); return; } // ~16s → give up, show plans
      timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [confirming, workspace.id]);

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
      if (!session) throw new Error(m.ov_not_authenticated());
      const res = await fetch(functionCallUrl('create-portal-session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspaceId: workspace.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || m.ov_portal_failed());
      window.location.href = data.url;
    } catch (err: any) {
      showToast(err.message || m.ov_portal_failed(), 'error');
      setPortalLoading(false);
    }
  };

  const startTrial = async (tier: PlanTier) => {
    setLoadingTier(tier);
    try {
      // SQEM-209 — shared with the create-workspace flow so checkout is opened in exactly one place.
      await startCheckout(workspace.id, tier, billingCycle);
    } catch (err: any) {
      showToast(err.message || m.stl_start_failed(), 'error');
      setLoadingTier(null);
    }
  };

  return (
    <div className="h-dvh overflow-y-auto bg-surface flex flex-col items-center px-4 pt-10 pb-32">
      <div className="w-full max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div className="inline-flex items-center gap-2">
            <img src="/logo-favicon-V2.png" alt="sqemes" className="w-9 h-9 rounded-xl shadow-soft" />
            <span className="text-xl font-bold text-ink-strong">sqemes</span>
          </div>
          <button
            onClick={() => signOut()}
            className="inline-flex items-center gap-2 text-sm font-medium text-ink-muted hover:text-ink-strong transition-colors"
          >
            <LogOut className="w-4 h-4" /> {m.cp_sign_out()}
          </button>
        </div>

        {confirming ? (
          <div className="max-w-md mx-auto text-center bg-surface-raised rounded-2xl shadow-soft border border-line p-8">
            <Loader2 className="w-8 h-8 text-accent animate-spin mx-auto mb-4" />
            <h2 className="font-display text-xl font-semibold text-ink-strong">{m.cp_confirming()}</h2>
            <p className="text-sm text-ink-muted mt-2">{m.cp_confirming_body_1()} <span className="font-semibold">{workspace.name}</span> {m.cp_confirming_body_2()}</p>
          </div>
        ) : isAdmin ? (
          paymentFailing ? (
            <div className="max-w-md mx-auto text-center bg-surface-raised rounded-2xl shadow-soft border border-line p-8">
              <div className="w-12 h-12 rounded-full bg-warning-soft flex items-center justify-center mx-auto mb-4">
                <CreditCard className="w-5 h-5 text-warning" />
              </div>
              <h2 className="font-display text-xl font-semibold text-ink-strong">{m.cp_failed_title()}</h2>
              <p className="text-sm text-ink-muted mt-2">
                {m.cp_failed_body_1()} <span className="font-semibold">{workspace.name}</span> {m.cp_failed_body_2()}
              </p>
              <button
                onClick={openBillingPortal}
                disabled={portalLoading}
                className="w-full mt-6 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2 bg-ink-strong text-surface-raised hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {portalLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> {m.cp_opening()}</> : m.cp_update_payment()}
              </button>
            </div>
          ) : (
          <>
            <div className="text-center mb-8">
              <h1 className="font-display text-2xl md:text-3xl font-semibold text-ink-strong tracking-tight">{isLapsed ? m.cp_ended_title() : m.cp_choose_title()}</h1>
              <p className="text-ink-muted mt-2">
                {isLapsed
                  ? <>{m.cp_resubscribe_1()} <span className="font-semibold text-accent">{workspace.name}</span>{m.cp_resubscribe_2()}</>
                  : <>{m.cp_trial_1({ days: TRIAL_DAYS })} <span className="font-semibold text-accent">{workspace.name}</span>{m.cp_trial_2()}</>}
              </p>
            </div>

            {/* Billing cycle toggle */}
            <div className="flex justify-center mb-8">
              <div className="flex bg-surface-sunken p-1 rounded-xl">
                <button
                  onClick={() => setBillingCycle('monthly')}
                  className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${billingCycle === 'monthly' ? 'bg-surface-field shadow-sm text-ink-strong' : 'text-ink-muted hover:text-ink-strong'}`}
                >
                  {m.stl_monthly()}
                </button>
                <button
                  onClick={() => setBillingCycle('yearly')}
                  className={`px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${billingCycle === 'yearly' ? 'bg-surface-field shadow-sm text-ink-strong' : 'text-ink-muted hover:text-ink-strong'}`}
                >
                  {m.stl_yearly()} <span className="text-2xs bg-success-soft text-ink-strong px-1.5 py-0.5 rounded-md uppercase tracking-wide">{m.stl_save20()}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {(Object.keys(PLANS) as PlanTier[]).map(tier => {
                const p = PLANS[tier];
                const price = billingCycle === 'yearly' ? p.priceYearly : planMonthlyAmount(p.price);
                const billingText = billingCycle === 'yearly' ? m.cp_billed_yearly({ amount: formatEuro(p.priceYearly * 12) }) : m.stl_billed_monthly();
                const isLoading = loadingTier === tier;
                return (
                  <div key={tier} className="relative p-6 rounded-2xl border border-line-strong bg-surface-raised flex flex-col hover:border-accent/50 hover:shadow-soft-lg transition-all">
                    <h3 className="font-bold text-lg text-ink-strong">{tier}</h3>
                    <p className="text-xs mt-0.5 mb-4 text-ink-muted">{planTagline(tier, p.tagline)}</p>
                    <div className="mb-6">
                      <p className="text-3xl font-bold text-ink-strong">{planMonthly(price)}</p>
                      <p className="text-xs text-ink-muted font-medium mt-1">{billingText}</p>
                      {/* SQEM-283 — the Terms promise consumers that a shown price includes VAT (VAT_NOTE; SQEM-609: shown as stl_vat).
                          This is where that promise has to be visible, not two screens later. */}
                      <p className="text-2xs text-ink-subtle mt-1">{m.stl_vat()}</p>
                    </div>
                    <ul className="space-y-2.5 text-sm flex-1 text-ink">
                      {p.features.map(feature => (
                        <li key={feature} className="flex items-center gap-2.5">
                          <Check className="w-3.5 h-3.5 shrink-0 text-accent" />
                          {planFeature(feature)}
                        </li>
                      ))}
                    </ul>
                    <button
                      disabled={isLoading}
                      onClick={() => startTrial(tier)}
                      className="w-full mt-6 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2 bg-ink-strong text-surface-raised hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> {m.cp_redirecting()}</> : isLapsed ? m.cp_resubscribe() : m.stl_start_trial({ days: TRIAL_DAYS })}
                    </button>
                  </div>
                );
              })}

              {/* SQEM-098 — Enterprise: contact-sales card (not a Stripe plan). */}
              <div className="relative p-6 rounded-2xl border border-line-strong bg-surface-raised flex flex-col hover:border-accent/50 hover:shadow-soft-lg transition-all">
                <h3 className="font-bold text-lg text-ink-strong">Enterprise</h3>
                <p className="text-xs mt-0.5 mb-4 text-ink-muted">{m.stl_enterprise_tagline()}</p>
                <div className="mb-6">
                  <p className="text-3xl font-bold text-ink-strong">{m.stl_lets_talk()}</p>
                  <p className="text-xs text-ink-muted font-medium mt-1">{m.stl_custom_pricing()}</p>
                </div>
                <ul className="space-y-2.5 text-sm flex-1 text-ink">
                  {[m.stl_ent_1(), m.stl_ent_2(), m.stl_ent_3(), m.stl_ent_4(), m.stl_ent_5()].map(feature => (
                    <li key={feature} className="flex items-center gap-2.5">
                      <Check className="w-3.5 h-3.5 shrink-0 text-accent" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <a
                  href="https://sqemes.com/enterprise"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full mt-6 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2 bg-ink-strong text-surface-raised hover:opacity-90"
                >
                  {m.stl_talk()} <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
            <p className="text-center text-xs text-ink-subtle mt-4">
              {/* SQEM-610 — "Prices exclude VAT, calculated at checkout." stood here and contradicted the cards
                  above (VAT_NOTE) and PRICING.md: the shown price is what a consumer pays (SQEM-283). Removed
                  in SQEM-610. */}
              {isLapsed ? m.cp_charged_resub() : m.cp_card_required()}
            </p>
          </>
          )
        ) : (
          <div className="max-w-md mx-auto text-center bg-surface-raised rounded-2xl shadow-soft border border-line p-8">
            <div className="w-12 h-12 rounded-full bg-warning-soft flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-5 h-5 text-warning" />
            </div>
            <h2 className="font-display text-xl font-semibold text-ink-strong">{isLapsed ? m.cp_member_lapsed_title() : m.cp_member_new_title()}</h2>
            <p className="text-sm text-ink-muted mt-2">
              <span className="font-semibold">{workspace.name}</span>{' '}
              {isLapsed
                ? (paymentFailing ? m.cp_member_lapsed_billing() : m.cp_member_lapsed_plan())
                : (paymentFailing ? m.cp_member_new_billing() : m.cp_member_new_plan())}
            </p>
          </div>
        )}

        {/* SQEM-267 — the way out with your data, offered where the person actually is.

            ⚠️ **Only when the workspace has actually had a subscription** (`isLapsed`). A workspace
            that never subscribed lands on this same screen, and it is empty by construction — nobody
            got in to put anything in it. Offering to download it would be an empty promise attached
            to an empty archive, on the screen where someone is deciding whether to trust the product.
            Corrected on the owner's observation, 2026-08-24.

            `isLapsed` is true for `past_due`/`unpaid` as well, not only `canceled`. That is
            deliberate: a failing card is how a cancellation usually begins, and the data is the
            customer's either way. If the offer ever reads as contradictory next to "your plan and
            data are unchanged", narrow it here — not by removing it.

            A lapsed workspace replaces the entire authenticated app with this screen, which put the
            export on the Templates page out of reach. The data was never locked — RLS checks
            membership, not payment — so nothing here unlocks anything; it restores a route to
            something the person was always entitled to. Article 20 GDPR does not stop at a paywall,
            and it is exercised precisely when a contract ends.

            Placed above the workspace switcher and not hidden behind a disclosure: someone who has
            just cancelled should not have to hunt for it, and a right you have to find is a right
            that is being discouraged. The wording deliberately makes no attempt to sell — that is
            what the rest of this screen is for. */}
        {isLapsed && (
        <div className="max-w-md mx-auto mt-8 text-center">
          <p className="text-sm text-ink-muted">
            {m.cp_yours()}
          </p>
          <button
            onClick={handleExport}
            disabled={exportBusy}
            className="inline-flex items-center justify-center gap-2 mt-3 text-sm font-semibold text-accent hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {exportBusy
              ? <><Loader2 className="w-4 h-4 animate-spin" /> {exportStep ?? m.cp_preparing()}</>
              : <><Download className="w-4 h-4" /> {m.cp_download_all()}</>}
          </button>
        </div>
        )}

        {/* SQEM-488 — the Settings toggle is unreachable behind this gate, so a Sqemes admin gets the
            same switch here. `set_workspace_managed` checks `is_sqemes_admin()` server-side (and since
            SQEM-489 nobody can grant themselves that flag); managed also sets credits_limit = 0, so the
            workspace is unmetered, not just ungated. Once `isManaged` flips, App drops this screen. */}
        {isSqemesAdmin && !workspace.isManaged && (
          <div className="max-w-md mx-auto mt-8 flex items-center justify-between gap-4 p-4 bg-accent-soft border border-accent/20 rounded-xl">
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-accent shrink-0" />
              <div>
                <p className="text-sm font-bold text-ink-strong">{m.cp_admin()}</p>
                <p className="text-xs text-accent mt-0.5">{m.cp_make_managed_1()} <span className="font-semibold">{workspace.name}</span> {m.cp_make_managed_2()}</p>
              </div>
            </div>
            <button
              onClick={async () => { setManagedBusy(true); try { await setWorkspaceManaged(workspace.id, true); } finally { setManagedBusy(false); } }}
              disabled={managedBusy}
              className="shrink-0 inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg bg-accent-strong text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {managedBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {m.cp_make_managed()}
            </button>
          </div>
        )}

        {/* Workspace switcher — for users who belong to other workspaces */}
        {otherWorkspaces.length > 0 && (
          <div className="max-w-md mx-auto mt-8">
            <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider mb-2 text-center">{m.cp_switch()}</p>
            <Select
              value=""
              onChange={(e) => { if (e.target.value) switchWorkspace(e.target.value); }}
            >
              <option value="" disabled>{m.cp_select()}</option>
              {otherWorkspaces.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChoosePlanScreen;
