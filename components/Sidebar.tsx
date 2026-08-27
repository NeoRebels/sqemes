import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  LayoutDashboard,
  FileText,
  Store,
  Chrome,
  MessageSquare,
  Paperclip,
  Settings,
  PlusCircle,
  Check,
  ChevronDown,
  Building,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  ArrowUpRight,
  X,
  Sun,
  Moon,
  BookOpen,
  Loader2,
} from 'lucide-react';
import { useUI, useWorkspace } from '../store';
import PersonCard from './ui/PersonCard';
import { PLANS, VAT_NOTE } from '../constants';
import type { PlanTier } from '../types';
import { startCheckout, type BillingCycle } from '../lib/billing';
import { can } from '../lib/permissions';
import { CHROME_STORE_URL } from '../lib/links';
import { IS_SELF_HOSTED, MARKETPLACE_ENABLED } from '../lib/env';
import { CURRENT_VERSION } from '../lib/version';
import { useExtensionInstalled } from '../hooks/useExtensionInstalled';
import { useUpdateStatus } from '../hooks/useUpdateStatus';
import PlanBadge from './PlanBadge';

interface SidebarProps {
  mobileOpen?: boolean;
  setMobileOpen?: (open: boolean) => void;
}

const Sidebar = ({ mobileOpen = false, setMobileOpen }: SidebarProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { workspace, currentUser, availableWorkspaces, switchWorkspace, createWorkspace } = useWorkspace();
  const { showToast, theme, toggleTheme } = useUI();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [tooltip, setTooltip] = useState<{ label: string, top: number } | null>(null);
  const extensionInstalled = useExtensionInstalled(); // SQEM-079 — hide the Install link once detected
  // SQEM-123 — self-host footer version indicator (shares the update check with the About panel)
  const updateStatus = useUpdateStatus();
  const updateAvailable = !!(updateStatus?.updateAvailable && updateStatus.latest);
  const openAbout = () => {
    navigate('/settings', { state: { initialTab: 'general', scrollTo: 'about' } });
    if (setMobileOpen) setMobileOpen(false);
  };

  // Workspace Management State
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [workspaceNameError, setWorkspaceNameError] = useState('');
  // SQEM-209 — two steps: pick the plan, then name it. Self-host skips straight to naming.
  const [wsStep, setWsStep] = useState<'plan' | 'name'>(IS_SELF_HOSTED ? 'name' : 'plan');
  const [selectedPlan, setSelectedPlan] = useState<PlanTier | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('yearly');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  const openWorkspaceModal = () => {
    setWsStep(IS_SELF_HOSTED ? 'name' : 'plan');
    setSelectedPlan(null);
    setNewWorkspaceName('');
    setWorkspaceNameError('');
    setIsWorkspaceModalOpen(true);
    setIsWorkspaceMenuOpen(false);
  };
  const workspaceMenuRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(event.target as Node)) {
      setIsWorkspaceMenuOpen(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handleClickOutside]);

  useEffect(() => {
    if (!isCollapsed) {
      setTooltip(null);
    }
  }, [isCollapsed]);

  const isActive = (path: string) => location.pathname === path;

  const closeMobileMenu = () => {
    if (setMobileOpen) setMobileOpen(false);
  };

  /**
   * SQEM-209 — plan first, name second, and the workspace row is created **last**.
   *
   * It used to be the other way round: the modal asked for a name, `create_workspace` wrote the row,
   * the store switched into it — and `needsSubscriptionGate` immediately threw up the paywall. So
   * the user had made something and was asked to pay for it in the same breath, and every abandoned
   * attempt left a row behind. That is exactly what the 30-day cleanup (SQEM-102) exists to sweep up.
   *
   * The row still has to exist before Stripe (`create-checkout-session` puts `workspace_id` in the
   * session metadata, and the webhook matches the subscription back by it), so it cannot be created
   * after payment. Creating it here, one step before the redirect, is as late as the design allows:
   * the orphan window shrinks from "until someone gives up" to the seconds spent loading Stripe.
   */
  const handleCreateWorkspace = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) {
      setWorkspaceNameError('Workspace name is required');
      return;
    }
    setCreatingWorkspace(true);
    try {
      const created = await createWorkspace(newWorkspaceName.trim());
      if (!created) return; // createWorkspace already surfaced the reason
      setIsWorkspaceModalOpen(false);
      setIsWorkspaceMenuOpen(false);
      // Self-host has no plans and no gate — there is nothing to check out.
      if (!IS_SELF_HOSTED && selectedPlan) {
        await startCheckout(created.id, selectedPlan, billingCycle);
      }
      setNewWorkspaceName('');
      setWorkspaceNameError('');
    } catch (err: any) {
      // The workspace exists at this point; only the redirect failed. Say so, rather than implying
      // nothing happened — the user will find it in the switcher, gated until a plan is chosen.
      showToast(err.message || 'Workspace created, but checkout could not be opened.', 'error');
    } finally {
      setCreatingWorkspace(false);
    }
  }, [newWorkspaceName, createWorkspace, showToast, selectedPlan, billingCycle]);

  const showTooltip = (e: React.MouseEvent, label: string) => {
    if (isCollapsed) {
      const rect = e.currentTarget.getBoundingClientRect();
      setTooltip({ label, top: rect.top + rect.height / 2 });
    }
  };

  const hideTooltip = () => {
    setTooltip(null);
  };


  const navLinks: { to: string; icon: any; label: string; beta?: boolean; arrow?: boolean }[] = [
    { to: "/", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/templates", icon: FileText, label: "Templates" },
    { to: "/library", icon: Store, label: "Marketplace" },
    { to: "/files", icon: Paperclip, label: "Files" },
    { to: "/chat", icon: MessageSquare, label: "Chat", arrow: true },
  ];

  const visibleNavLinks = navLinks.filter(link => {
    // SQEM-178 — hide Marketplace if disabled on this instance (self-host with an empty marketplace URL).
    if (link.to === '/library' && !MARKETPLACE_ENABLED) return false;
    if (!can(currentUser, workspace, 'settings:general')) {
      return !['/library', '/files'].includes(link.to);
    }
    return true;
  });

  const renderNavItem = (to: string, Icon: any, label: string, beta?: boolean, arrow?: boolean) => {
    const active = isActive(to);
    return (
      <Link
        key={to}
        to={to}
        onClick={closeMobileMenu}
        onMouseEnter={(e) => showTooltip(e, label)}
        onMouseLeave={hideTooltip}
        // SQEM-206 — the arrow already hinted that this one leaves the shell; say it out loud for
        // anyone who cannot see the arrow. Chat is a full-screen mode: entering it takes the main
        // navigation away, so the entrance should admit that before the click, not after.
        title={arrow ? `${label} — opens full screen` : undefined}
        aria-label={arrow ? `${label} — opens full screen` : undefined}
        className={`relative flex items-center gap-3 ${isCollapsed ? 'justify-center px-2' : 'px-3'} py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group ${
          active
            ? 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-400'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100'
        }`}
      >
        <Icon className={`w-5 h-5 transition-colors shrink-0 ${active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'}`} />
        {!isCollapsed && (
          <>
            <span className="truncate">{label}</span>
            {beta && (
              <span className="ml-auto text-3xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 shrink-0">
                Beta
              </span>
            )}
            {arrow && (
              <ArrowRight className={`w-4 h-4 ml-auto shrink-0 transition-colors ${active ? 'text-brand-500 dark:text-brand-400' : 'text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400'}`} />
            )}
          </>
        )}
      </Link>
    );
  };

  return (
    <>
      <div
        className={`fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 transition-opacity md:hidden ${mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={closeMobileMenu}
      />
      {/* Mobile close — floats just outside the drawer on the dimmed overlay, with its own bg */}
      {mobileOpen && (
        <button
          onClick={closeMobileMenu}
          aria-label="Close menu"
          className="fixed top-3 left-64 ml-2 z-[60] p-2 rounded-full bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 shadow-lg hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors md:hidden"
        >
          <X className="w-5 h-5" />
        </button>
      )}
      <div className={`
        fixed inset-y-0 left-0 z-50 bg-white dark:bg-slate-800 border-r border-slate-100 dark:border-slate-700 shadow-soft transition-transform duration-300 transform flex flex-col
        md:translate-x-0 md:static md:h-full
        ${mobileOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64'}
        ${isCollapsed && !mobileOpen ? 'md:w-20' : 'md:w-64'}
      `}>
        {/* Desktop Collapse Toggle */}
        <button 
           onClick={() => {
             setIsCollapsed(!isCollapsed);
             setIsWorkspaceMenuOpen(false);
           }}
           className="hidden md:flex absolute -right-3 top-9 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 rounded-full p-1 shadow-md z-50 hover:scale-110 transition-all"
        >
           {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>

        <div className={`p-6 relative z-[60] ${isCollapsed ? 'px-4 flex flex-col items-center' : ''}`}>
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} mb-1 transition-all`}>
            <img src="/logo-favicon-V2.png" alt="sqemes" className="w-10 h-10 rounded-xl shrink-0 shadow-sm" />
            {!isCollapsed && (
              <div className="animate-fade-in">
                <div className="flex items-center gap-2">
                  <h1 className="font-bold text-slate-900 dark:text-slate-100 leading-tight tracking-tight text-xl">sqemes</h1>
                  {/* SQEM-119/182 — plan tier is Cloud-only; PlanBadge is stubbed to null on self-host. */}
                  <PlanBadge workspace={workspace} />
                </div>
                
                <div className="relative" ref={workspaceMenuRef}>
                  <button 
                    onClick={() => setIsWorkspaceMenuOpen(!isWorkspaceMenuOpen)}
                    className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 font-medium hover:text-brand-600 dark:hover:text-brand-400 transition-colors mt-0.5 group outline-none"
                  >
                    {/* SQEM-207 — 120px held 19 characters, so any real name was cut mid-word and
                        nobody noticed because short test names fit. Wider, and the full name is on
                        hover for the cases that still don't. */}
                    <span className="truncate max-w-[168px]" title={workspace.name}>{workspace.name}</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${isWorkspaceMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Workspace Dropdown */}
                  {isWorkspaceMenuOpen && (
                    <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700 py-1 z-[100] animate-scale-up origin-top-left">
                      <div className="px-3 py-2 border-b border-slate-50 dark:border-slate-700">
                        <p className="text-2xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Switch Workspace</p>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {availableWorkspaces.map(ws => (
                          <button
                            key={ws.id}
                            onClick={() => {
                              switchWorkspace(ws.id);
                              setIsWorkspaceMenuOpen(false);
                            }}
                            className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-6 h-6 rounded bg-slate-100 dark:bg-slate-600 flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                                <Building className="w-3 h-3" />
                              </div>
                              <span className={`text-sm font-medium truncate ${ws.id === workspace.id ? 'text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}>
                                {ws.name}
                              </span>
                            </div>
                            {ws.id === workspace.id && <Check className="w-4 h-4 text-brand-600 dark:text-brand-400" />}
                          </button>
                        ))}
                      </div>
                      {/* SQEM-121 — self-host is a single-instance deployment: no adding workspaces */}
                      {!IS_SELF_HOSTED && (
                      <div className="p-1 border-t border-slate-50 dark:border-slate-700 mt-1">
                        <button
                          onClick={() => {
                            openWorkspaceModal();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-brand-600 dark:hover:text-brand-400 rounded-lg transition-colors"
                        >
                          <PlusCircle className="w-4 h-4" />
                          Create Workspace
                        </button>
                      </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2 px-4 space-y-1 overflow-x-hidden scrollbar-thin">
          <div className="mb-6 space-y-1">
            {visibleNavLinks.map(link => renderNavItem(link.to, link.icon, link.label, link.beta, link.arrow))}
          </div>
        </div>

        <div className={`p-4 pb-6 border-t border-slate-100 dark:border-slate-700 space-y-2 ${isCollapsed ? 'flex flex-col items-center' : ''}`}>
          {!extensionInstalled && (
            <a
              href={CHROME_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onMouseEnter={(e) => showTooltip(e, 'Install Extension')}
              onMouseLeave={hideTooltip}
              className={`flex items-center gap-3 ${isCollapsed ? 'justify-center px-2' : 'px-3'} py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100`}
            >
              <Chrome className="w-5 h-5 shrink-0 text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
              {!isCollapsed && (
                <>
                  <span className="truncate whitespace-nowrap">Install Extension</span>
                  <ArrowUpRight className="w-4 h-4 ml-auto shrink-0 transition-colors text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400" />
                </>
              )}
            </a>
          )}

          <a
            href="https://help.sqemes.com/"
            target="_blank"
            rel="noopener noreferrer"
            onMouseEnter={(e) => showTooltip(e, 'Documentation')}
            onMouseLeave={hideTooltip}
            className={`flex items-center gap-3 ${isCollapsed ? 'justify-center px-2' : 'px-3'} py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100`}
          >
            <BookOpen className="w-5 h-5 shrink-0 text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
            {!isCollapsed && (
              <>
                <span className="truncate">Documentation</span>
                <ArrowUpRight className="w-4 h-4 ml-auto shrink-0 transition-colors text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400" />
              </>
            )}
          </a>

          {renderNavItem('/settings', Settings, 'Settings')}

          {/* SQEM-241 — this markup moved into `ui/PersonCard`, which the template editor's Owner
              block also uses. One element to maintain instead of two that look alike today. */}
          <PersonCard
            name={currentUser.name}
            subtitle="My Profile"
            avatar={currentUser.avatar}
            role={currentUser.role}
            collapsed={isCollapsed}
            className="mt-2"
            onClick={() => {
              navigate('/settings', { state: { initialTab: 'profile' } });
              closeMobileMenu();
            }}
            onMouseEnter={(e) => showTooltip(e, currentUser.name)}
            onMouseLeave={hideTooltip}
          />

          {isCollapsed ? (
            <button
              onClick={toggleTheme}
              onMouseEnter={(e) => showTooltip(e, theme === 'dark' ? 'Light Mode' : 'Dark Mode')}
              onMouseLeave={hideTooltip}
              className="w-full flex justify-center px-2 py-2.5 rounded-xl text-sm font-medium transition-all text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5 shrink-0" /> : <Moon className="w-5 h-5 shrink-0" />}
            </button>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2">
              <Sun className="w-4 h-4 shrink-0 text-amber-400" />
              <button
                onClick={toggleTheme}
                aria-label="Toggle dark mode"
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 focus:outline-none ${theme === 'dark' ? 'bg-brand-600' : 'bg-slate-300'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${theme === 'dark' ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
              </button>
              <Moon className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 ml-1 whitespace-nowrap">
                {theme === 'dark' ? 'Dark mode' : 'Light mode'}
              </span>
            </div>
          )}

          {/* SQEM-123 — self-host version / update indicator; hidden on Cloud */}
          {IS_SELF_HOSTED && (isCollapsed ? (
            <button
              onClick={openAbout}
              onMouseEnter={(e) => showTooltip(e, updateAvailable ? `Update available (v${CURRENT_VERSION})` : `Version v${CURRENT_VERSION}`)}
              onMouseLeave={hideTooltip}
              className="w-full flex items-center justify-center gap-1 px-2 py-1 text-2xs font-mono text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              {updateAvailable && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />}
              <span>v{CURRENT_VERSION}</span>
            </button>
          ) : (
            <button
              onClick={openAbout}
              title={updateAvailable ? 'A newer version is available — click for details' : 'About & version'}
              className="w-full flex items-center gap-1.5 px-3 py-1 text-2xs text-left text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors whitespace-nowrap"
            >
              <span className="font-mono">v{CURRENT_VERSION}</span>
              {updateAvailable && (
                <span className="text-amber-600 dark:text-amber-400 font-semibold">· Update available</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {isCollapsed && tooltip && !mobileOpen && (
        <div 
          className="fixed left-20 ml-4 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg shadow-xl z-[100] animate-fade-in whitespace-nowrap pointer-events-none"
          style={{ top: tooltip.top, transform: 'translateY(-50%)' }}
        >
          {tooltip.label}
          {/* Little arrow */}
          <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-slate-900 rotate-45"></div>
        </div>
      )}

      {/* Create Workspace Modal — self-host disables adding workspaces (SQEM-121) */}
      {!IS_SELF_HOSTED && isWorkspaceModalOpen && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm border border-slate-100 dark:border-slate-700 animate-scale-up">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">Create Workspace</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              {wsStep === 'plan' ? 'Step 1 of 2 · Choose a plan' : IS_SELF_HOSTED ? 'Name your workspace' : 'Step 2 of 2 · Name it'}
            </p>

            {/* SQEM-209 — Step 1. The old modal claimed "You will start on the Solo plan", which the
                product then contradicted: the plan column did say Solo, but the gate reads the
                subscription, so a fresh workspace was paywalled on sight. Choosing the plan up front
                replaces a promise that wasn't kept with a decision the user actually makes. */}
            {wsStep === 'plan' && (
              <div className="space-y-3">
                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-700 rounded-xl">
                  {(['monthly', 'yearly'] as const).map(cycle => (
                    <button
                      key={cycle}
                      type="button"
                      onClick={() => setBillingCycle(cycle)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                        billingCycle === cycle
                          ? 'bg-white dark:bg-slate-600 shadow-sm text-slate-900 dark:text-slate-100'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                    >
                      {cycle}
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  {(Object.keys(PLANS) as PlanTier[]).map(tier => {
                    const plan = PLANS[tier];
                    const monthly = billingCycle === 'yearly' ? plan.priceYearly : parseInt(plan.price.replace(/[^0-9]/g, ''), 10);
                    return (
                      <button
                        key={tier}
                        type="button"
                        onClick={() => { setSelectedPlan(tier); setWsStep('name'); }}
                        className="w-full flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-600 hover:border-brand-400 hover:bg-brand-50/40 dark:hover:bg-brand-900/10 transition-colors text-left"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">{tier}</span>
                          <span className="block text-2xs text-slate-500 dark:text-slate-400 truncate">{plan.tagline}</span>
                        </span>
                        <span className="text-sm font-bold text-slate-900 dark:text-slate-100 shrink-0">€{monthly}<span className="text-2xs font-medium text-slate-400">/mo</span></span>
                      </button>
                    );
                  })}
                </div>

                {/* SQEM-283 — once under the list, not on every row: this is a compact picker, and
                    six copies of the same sentence would read as noise and get skipped. */}
                <p className="text-2xs text-slate-400 dark:text-slate-500 mt-2">{VAT_NOTE}</p>

                <button
                  type="button"
                  onClick={() => setIsWorkspaceModalOpen(false)}
                  className="w-full py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}

            {wsStep === 'name' && (
            <form onSubmit={handleCreateWorkspace} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Workspace Name</label>
                <input
                  autoFocus
                  className={`w-full p-2.5 bg-white dark:bg-slate-700 border rounded-xl text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-500 ${workspaceNameError ? 'border-red-400' : 'border-slate-200 dark:border-slate-600'}`}
                  placeholder="e.g. My New Team"
                  value={newWorkspaceName}
                  onChange={e => { setNewWorkspaceName(e.target.value); if (workspaceNameError) setWorkspaceNameError(''); }}
                />
                {workspaceNameError && <p className="text-xs text-red-500 dark:text-red-400 mt-1">{workspaceNameError}</p>}
              </div>
              {!IS_SELF_HOSTED && selectedPlan && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-bold text-slate-700 dark:text-slate-200">{selectedPlan}</span>, billed {billingCycle}.
                  Next step is payment — the workspace is created when you continue.
                </p>
              )}
              <div className="flex gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => (IS_SELF_HOSTED ? setIsWorkspaceModalOpen(false) : setWsStep('plan'))}
                  disabled={creatingWorkspace}
                  className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors disabled:opacity-60"
                >
                  {IS_SELF_HOSTED ? 'Cancel' : 'Back'}
                </button>
                <button
                  type="submit"
                  disabled={creatingWorkspace}
                  className="flex-1 py-2.5 text-white bg-brand-600 rounded-xl hover:bg-brand-700 text-xs font-bold shadow-lg hover:shadow-brand-200 dark:shadow-none dark:hover:shadow-none transition-all disabled:opacity-60 inline-flex items-center justify-center gap-2"
                >
                  {creatingWorkspace && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {IS_SELF_HOSTED ? 'Create' : 'Continue to payment'}
                </button>
              </div>
            </form>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default memo(Sidebar);
