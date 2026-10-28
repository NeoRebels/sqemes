import React, { Suspense } from 'react';
import { useApplyLocale } from './hooks/useApplyLocale';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
// SQEM-542 — lazy: shown only to a workspace without a subscription, and it pulls in the account
// export (JSZip). Eager, it cost every page load ~28 KB gzip.
const ChoosePlanScreen = React.lazy(() => import('./components/ChoosePlanScreen'));
import LegalGate from './components/LegalGate';
import { needsSubscriptionGate } from './lib/subscription';
import { publicListingIdFromHash } from './lib/publicRoutes';
import { IS_SELF_HOSTED } from './lib/env';

const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Templates = React.lazy(() => import('./pages/Templates'));
const TemplateEditor = React.lazy(() => import('./pages/TemplateEditor'));
const Personas = React.lazy(() => import('./pages/Personas'));           // SQEM-324
const PersonaEditor = React.lazy(() => import('./pages/PersonaEditor')); // SQEM-324
const DesignSystem = React.lazy(() => import('./pages/DesignSystem')); // SQEM-545 — gated inside the page
const Overview = React.lazy(() => import('./pages/Overview')); // SQEM-552 — Manage home; members are sent to Start inside the page
const PromptRunnerRedirect = () => {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  React.useEffect(() => {
    nav('/chat', { replace: true, state: { launchTemplateId: id } });
  }, [id, nav]);
  return null;
};
// SQEM-389 — a persona card lands in Chat with the persona applied, the way a template card does.
// Editing stays on the card's pencil (`/personas/:id/edit`).
const PersonaChatRedirect = () => {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  React.useEffect(() => {
    nav('/chat', { replace: true, state: { launchPersonaId: id } });
  }, [id, nav]);
  return null;
};
// SQEM-394 — the old playbook paths. `/prompts/:id` was the PromptRunner shim and `/prompts/:id/edit`
// the editor; both keep working by landing on their `/playbooks/…` twin. Two components rather than
// one with a flag: the list redirect has to carry the QUERY (a bookmarked `?kind=skill` tab), the
// item redirect has to carry the ID, and a component that does both is one that gets one wrong.
const LegacyPlaybookRedirect = ({ suffix = '' }: { suffix?: string }) => {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/playbooks/${id}${suffix}`} replace />;
};
const LegacyListRedirect = () => {
  const { search } = useLocation();
  return <Navigate to={`/playbooks${search}`} replace />;
};
const Library = React.lazy(() => import('./pages/Library'));
const MarketplaceTemplate = React.lazy(() => import('./pages/MarketplaceTemplate'));
const PublicListing = React.lazy(() => import('./pages/PublicListing')); // SQEM-258
import GleapBoot from './components/GleapBoot';
const Chat = React.lazy(() => import('./pages/Chat'));
const Settings = React.lazy(() => import('./pages/Settings'));
const Files = React.lazy(() => import('./pages/Files'));
const History = React.lazy(() => import('./pages/History')); // SQEM-563
const InviteAccept = React.lazy(() => import('./pages/InviteAccept'));
const ResetPassword = React.lazy(() => import('./pages/ResetPassword'));
const Auth = React.lazy(() => import('./pages/Auth'));
const NotFound = React.lazy(() => import('./pages/NotFound'));
import { AppProvider, useUI, useToast, useWorkspace } from './store';
import { useAuth } from './hooks/useAuth';
import { usePullToRefresh } from './hooks/usePullToRefresh';
import PullToRefreshIndicator from './components/PullToRefreshIndicator';
import { CheckCircle, AlertTriangle, Info, X, Menu, Plus, LogOut } from 'lucide-react';
import { isStagingSupabaseEnvironment } from './lib/environment';
import { m } from './lib/i18n';

// SQEM-091 — Password-recovery links are routed to the reset page by the PASSWORD_RECOVERY
// handler in hooks/useAuth.ts (fires once supabase-js establishes the recovery session from
// the URL). The /reset-password route below bypasses the loading/workspace guards so the
// form renders immediately from that session.

const StagingEnvironmentBanner = () => {
  if (!isStagingSupabaseEnvironment) return null;

  return (
    <div
      role="status"
      aria-label={m.app_staging()}
      className="fixed top-0 left-0 right-0 w-full h-8 bg-red-600 text-white text-center text-xs sm:text-sm font-bold uppercase flex items-center justify-center shadow-sm z-[200] pointer-events-none"
    >
      {m.app_staging()}
    </div>
  );
};

const EnvironmentShell = ({ children }: React.PropsWithChildren<{}>) => {
  if (!isStagingSupabaseEnvironment) return <>{children}</>;

  return (
    <div className="staging-environment-shell h-full min-h-0 flex flex-col bg-surface">
      <StagingEnvironmentBanner />
      <div className="flex-1 min-h-0">
        {children}
      </div>
    </div>
  );
};

const ToastContainer = () => {
  const { toast, hideToast, pauseToast, resumeToast } = useToast();

  if (!toast) return null;

  const isAlert = toast.type === 'error';

  return (
    <div
      role={isAlert ? 'alert' : 'status'}
      aria-live={isAlert ? 'assertive' : 'polite'}
      aria-atomic="true"
      onMouseEnter={pauseToast}
      onMouseLeave={resumeToast}
      // SQEM-554 (a) — a light card like everything else in C (choice A of two): the type is carried by
      // the icon's colour and, for an error, the edge — not by a filled slab in a colour of its own.
      // There was no `info` token; blue-500 was the last Tailwind blue in this file.
      className={`fixed bottom-6 right-6 max-w-[calc(100vw-3rem)] px-4 py-3 rounded-card border bg-surface-raised text-ink-strong shadow-raised flex items-center gap-3 animate-fade-in z-[100] cursor-default ${
        toast.type === 'error' ? 'border-danger/40' : 'border-line'
      }`}
    >
      {toast.type === 'success' && <CheckCircle aria-hidden className="w-5 h-5 text-success shrink-0" />}
      {toast.type === 'error' && <AlertTriangle aria-hidden className="w-5 h-5 text-danger shrink-0" />}
      {toast.type === 'info' && <Info aria-hidden className="w-5 h-5 text-accent shrink-0" />}
      <span className="font-medium text-sm">{toast.message}</span>
      <button onClick={hideToast} aria-label={m.app_dismiss_toast()} className="text-ink-subtle hover:text-ink-strong"><X className="w-4 h-4" /></button>
    </div>
  );
};

const Layout = ({ children }: React.PropsWithChildren<{}>) => {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  // SQEM-385 — pull down at the top of the page to reload the installed app (no-op in a browser tab).
  const mainRef = React.useRef<HTMLElement>(null);
  const pull = usePullToRefresh(mainRef);

  return (
    <div className="flex h-dvh w-full bg-surface overflow-hidden">
      {/* SQEM-544 — skip link, first in the tab order, visible only on focus. A button, not
          `href="#main"`: under HashRouter a fragment link is a route change. */}
      <button
        type="button"
        onClick={() => mainRef.current?.focus()}
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[300] focus:px-4 focus:py-2 focus:rounded-xl focus:bg-brand-600 focus:text-white focus:text-sm focus:font-semibold"
      >
        {m.app_skip()}
      </button>
      <Sidebar mobileOpen={mobileMenuOpen} setMobileOpen={setMobileMenuOpen} />

      <div className="flex-1 flex flex-col h-full relative overflow-hidden">
         {/* Mobile Header */}
         <div className="md:hidden bg-surface-raised border-b border-line-strong p-4 flex items-center justify-between shrink-0 z-20">
            <div className="font-bold text-lg text-ink-strong flex items-center gap-2">
              <img src="/logo-favicon-V2.png" alt="sqemes" className="w-8 h-8 rounded-lg" />
              sqemes
            </div>
            <button
              onClick={() => setMobileMenuOpen(true)}
              aria-label={m.app_open_menu()}
              className="p-2 text-ink-muted hover:bg-surface-sunken rounded-lg transition-colors"
            >
              <Menu className="w-6 h-6" />
            </button>
         </div>

         <main ref={mainRef} id="main-content" tabIndex={-1} className="focus:outline-none flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain scroll-smooth bg-surface">
            <PullToRefreshIndicator {...pull} />
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
         </main>

      </div>
    </div>
  );
};

const NoWorkspaceScreen = () => {
  const { createWorkspace } = useWorkspace();
  const { isLoading } = useUI();
  const { signOut } = useAuth();
  const [name, setName] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    await createWorkspace(name.trim());
    setCreating(false);
  };

  if (isLoading) return <LoadingScreen />;

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <img src="/logo-favicon-V2.png" alt="sqemes" className="w-10 h-10 rounded-xl shadow-soft" />
            <span className="text-2xl font-bold text-ink-strong">sqemes</span>
          </div>
          <h2 className="font-display text-xl font-semibold text-ink-strong">{IS_SELF_HOSTED ? m.nw_selfhost_title() : m.nw_cloud_title()}</h2>
          <p className="text-ink-muted text-sm mt-2">{IS_SELF_HOSTED ? m.nw_selfhost_body() : m.nw_cloud_body() /* SQEM-610 — was "on prompts", the word before SQEM-394 */}</p>
        </div>

        <div className="bg-surface-raised rounded-2xl shadow-soft border border-line p-8">
          {/* SQEM-121 — self-host is single-instance: orphaned users can't create a workspace, only be invited */}
          {!IS_SELF_HOSTED && <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label htmlFor="app-workspace-name" className="block text-xs font-bold text-ink-subtle uppercase tracking-wider mb-2">{m.nw_name()}</label>
              <input id="app-workspace-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={m.nw_name_placeholder()}
                required
                className="w-full px-4 py-3 border border-line-strong rounded-xl text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all bg-surface-field text-ink-strong placeholder:text-ink-subtle"
              />
            </div>
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="w-full py-3 bg-accent-strong hover:opacity-90 text-white rounded-xl text-sm font-bold transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              {creating ? m.nw_creating() : m.nw_create()}
            </button>
          </form>}
          <button
            onClick={() => signOut()}
            className="w-full mt-4 py-3 text-ink-muted hover:text-ink-strong text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            {m.stp_sign_out()}
          </button>
        </div>
      </div>
    </div>
  );
};

const AppRoutes = () => {
  const { noWorkspace, isLoading, showToast } = useUI();
  const { workspace, currentUser, isSqemesAdmin } = useWorkspace();
  const { pathname } = useLocation();
  // SQEM-600 — the language in effect, applied once the person and the workspace are loaded.
  useApplyLocale(!isLoading && !!workspace.id && !!currentUser.id, currentUser.language, workspace.language, isSqemesAdmin);

  // SQEM-491 — a GoTrue `#message=` (first email-change confirmation) was stashed by `App()`.
  React.useEffect(() => {
    try {
      const msg = sessionStorage.getItem('sqm_auth_message');
      if (!msg) return;
      sessionStorage.removeItem('sqm_auth_message');
      showToast(msg, 'info');
    } catch { /* storage unavailable — nothing to show */ }
  }, [showToast]);

  // SQEM-459 — this looks like a duplicate of the branch in `App()` and is not; do not delete it.
  // `isResetRoute` there is read from `window.location.hash` at render time, not from state. Paste a
  // reset link into the address bar of an already-open, signed-in tab and only the hash changes:
  // `HashRouter` re-renders, `App()` does not, and this is the branch that serves the route. Same
  // twin shape as the public listing — the branch above covers the cold start and the signed-out
  // case, this one covers the running app. Removing it would send that visit to `<Route path="*">`.
  if (pathname === '/reset-password') {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/reset-password" element={<ResetPassword />} />
        </Routes>
      </Suspense>
    );
  }

  if (isLoading) return <LoadingScreen />;
  if (noWorkspace) return <NoWorkspaceScreen />;
  // SQEM-057/083 — gate non-managed workspaces with no active/trialing subscription
  // (never-subscribed or lapsed) until they (re)subscribe or fix payment.
  if (workspace.id && needsSubscriptionGate(workspace)) return <Suspense fallback={<LoadingScreen />}><ChoosePlanScreen /></Suspense>;

  return (
    <Suspense fallback={<LoadingScreen />}>
      {/* SQEM-261 — inside the authenticated tree on purpose: everything above this line can be
          reached without an account, and the public listing page renders its own routes entirely. */}
      <GleapBoot />
      <Routes>
        {/* Full Screen Routes */}
        {/* SQEM-394 — playbooks live under /playbooks; every /prompts/* and /templates path below
            redirects here, so old links, bookmarks and the extension keep working. */}
        <Route path="/playbooks/new" element={<TemplateEditor />} />
        <Route path="/playbooks/:id/edit" element={<TemplateEditor />} />
        {/* ⛔ NOT the editor route — that is `/playbooks/:id/edit` above. This one is a shim that
            catches links to the PromptRunner removed in SQEM-042 and sends them to Chat.
            SQEM-313: two call sites navigated here meaning the editor, and neither failed
            visibly — the playbook opened, just in the wrong place. If you are writing a link
            to a playbook, you almost certainly want `/edit`. */}
        <Route path="/playbooks/:id" element={<PromptRunnerRedirect />} />
        <Route path="/prompts/new" element={<Navigate to="/playbooks/new" replace />} />
        <Route path="/prompts/:id/edit" element={<LegacyPlaybookRedirect suffix="/edit" />} />
        <Route path="/prompts/:id" element={<LegacyPlaybookRedirect />} />
        {/* SQEM-324 — the persona editor is full-screen like the template editor: same job,
            same amount of screen it wants. */}
        <Route path="/personas/new" element={<PersonaEditor />} />
        <Route path="/personas/:id/edit" element={<PersonaEditor />} />
        <Route path="/personas/:id" element={<PersonaChatRedirect />} />
        <Route path="/library/new" element={<TemplateEditor />} />
        <Route path="/library/:id/edit" element={<TemplateEditor />} />
        <Route path="/library/:id" element={<MarketplaceTemplate />} />

        {/* Dashboard Layout Routes */}
        <Route path="/" element={<LayoutPage><Dashboard /></LayoutPage>} />
        <Route path="/playbooks" element={<LayoutPage><Templates /></LayoutPage>} />
        <Route path="/personas" element={<LayoutPage><Personas /></LayoutPage>} />
        {/* SQEM-394 — the list's old paths. `/templates` keeps its query (?kind=…), which is what a
            bookmarked filter tab carries. */}
        <Route path="/templates" element={<LegacyListRedirect />} />
        <Route path="/prompts" element={<Navigate to="/playbooks" replace />} />
        {/* SQEM-390 — assistants are skills now; the old deep link lands on the skills tab. */}
        <Route path="/assistants" element={<Navigate to="/playbooks?kind=skill" replace />} />
        <Route path="/files" element={<LayoutPage><Files /></LayoutPage>} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/chat/:sessionId" element={<Chat />} />
        <Route path="/chat-history" element={<Navigate to="/history" replace />} />
        <Route path="/history" element={<LayoutPage><History /></LayoutPage>} />
        <Route path="/library" element={<LayoutPage><Library /></LayoutPage>} />
        <Route path="/settings" element={<LayoutPage><Settings /></LayoutPage>} />
        <Route path="/design" element={<LayoutPage><DesignSystem /></LayoutPage>} />
        <Route path="/overview" element={<LayoutPage><Overview /></LayoutPage>} />
        <Route path="/workspace" element={<Navigate to="/settings" state={{ initialTab: 'team' }} replace />} />
        <Route path="/invite/:token" element={<InviteAccept />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route path="*" element={<LayoutPage><NotFound /></LayoutPage>} />
      </Routes>
    </Suspense>
  );
};

// Sets the browser tab title to "<Page> - sqemes" from the current route.
const pageTitleForPath = (pathname: string): string => {
  if (pathname === '/') return m.nav_start(); // SQEM-550 (a)
  if (pathname.startsWith('/chat')) return m.nav_chat();
  if (pathname.startsWith('/history')) return m.nav_history(); // SQEM-611 — was missing, tab said just "sqemes"
  if (pathname.startsWith('/design')) return m.title_design();
  if (pathname === '/overview') return m.nav_overview(); // SQEM-552
  if (pathname.startsWith('/playbooks/') || pathname.startsWith('/prompts/')) return m.title_playbook_editor();
  if (pathname.startsWith('/personas/')) return m.title_persona_editor();
  if (pathname.startsWith('/personas')) return m.nav_personas(); // SQEM-388 — was missing, tab said just "sqemes"
  if (pathname.startsWith('/playbooks') || pathname.startsWith('/templates') || pathname === '/prompts' || pathname.startsWith('/assistants')) return m.nav_playbooks();
  // SQEM-611 — /library/<id> is the listing (MarketplaceTemplate), not the editor; it was titled "Marketplace editor".
  if (pathname === '/library/new' || /^\/library\/[^/]+\/edit$/.test(pathname)) return m.title_marketplace_editor();
  if (pathname.startsWith('/library/')) return m.title_marketplace_listing();
  if (pathname === '/library') return m.nav_marketplace();
  if (pathname.startsWith('/files')) return m.nav_files();
  if (pathname.startsWith('/settings') || pathname === '/workspace') return m.nav_settings();
  if (pathname.startsWith('/invite')) return m.title_accept_invite();
  if (pathname === '/reset-password') return m.title_reset_password();
  return '';
};

const PageTitle = () => {
  const { pathname } = useLocation();
  React.useEffect(() => {
    const page = pageTitleForPath(pathname);
    document.title = page ? `${page} - sqemes` : 'sqemes';
  }, [pathname]);
  return null;
};

const AuthenticatedApp = () => {
  return (
    <ErrorBoundary>
      <AppProvider>
        <HashRouter>
          <PageTitle />
          <ToastContainer />
          <AppRoutes />
          {/* SQEM-402 — Cloud only. On self-host the component injects `/_vercel/speed-insights/script.js`,
              nginx answers with the SPA fallback page, and every page load logs a SyntaxError for a
              Vercel script an instance without Vercel never needed. */}
          {!IS_SELF_HOSTED && <SpeedInsights />}
        </HashRouter>
      </AppProvider>
    </ErrorBoundary>
  );
};

/**
 * SQEM-207 — keep the shell up while a page chunk loads.
 *
 * One `<Suspense>` wrapped every route, so switching section blanked the *whole* app for a moment,
 * navigation included — on a route the user had already committed to. `Layout` is not lazy, so
 * rendering it outside the inner boundary keeps the sidebar mounted and only the content area waits.
 */
const PageLoading = () => (
  <div className="flex items-center justify-center py-24" role="status" aria-label={m.app_loading()}>
    {/* SQEM-554 (a) — no pulse for those who asked the system for less motion. */}
    <img src="/logo-favicon-V2.png" alt="" className="w-8 h-8 rounded-lg opacity-60 motion-safe:animate-pulse" />
  </div>
);

const LayoutPage = ({ children }: { children: React.ReactNode }) => (
  <Layout>
    <Suspense fallback={<PageLoading />}>{children}</Suspense>
  </Layout>
);

const LoadingScreen = () => (
  <div className="min-h-screen bg-surface flex items-center justify-center">
    <div className="text-center">
      <img src="/logo-favicon-V2.png" alt="sqemes" className="w-10 h-10 rounded-xl shadow-soft mx-auto mb-4 motion-safe:animate-pulse" />
      <p className="text-ink-subtle text-sm font-medium" role="status">{m.app_loading()}</p>
    </div>
  </div>
);

function App() {
  const { session, loading } = useAuth();

  // After login, complete any pending MCP OAuth flow that redirected the user here.
  React.useEffect(() => {
    if (!session) return;
    const returnUrl = localStorage.getItem('sqm_mcp_oauth_return');
    if (returnUrl) {
      localStorage.removeItem('sqm_mcp_oauth_return');
      window.location.href = returnUrl;
      return;
    }
    // SQEM-258 — someone who came from a public listing lands back on it. The hash usually survives
    // on its own; it does not when the trip went through Stripe checkout, which returns to a bare
    // URL. Without this the offer would leak at the moment it was accepted.
    const back = localStorage.getItem('sqm_return_to');
    if (back) {
      localStorage.removeItem('sqm_return_to');
      if (window.location.hash !== back) window.location.hash = back;
    }
  }, [session]);

  // SQEM-091 — the password-recovery route must render before a session exists: it redeems
  // the recovery token_hash via verifyOtp itself. Let it through the auth/loading gates.
  const isResetRoute = typeof window !== 'undefined' && window.location.hash.startsWith('#/reset-password');

  // SQEM-258 — a marketplace listing is readable without an account. The rule lives in
  // `lib/publicRoutes.ts` because it decides what bypasses the auth gate, and that belongs
  // somewhere a test can pin it.
  const publicListingId = typeof window !== 'undefined' ? publicListingIdFromHash(window.location.hash) : null;

  // Reset the tab title on the signed-out screens (the per-page <PageTitle> only runs
  // inside the authenticated app, so without this the title would stay stale after logout).
  React.useEffect(() => {
    if (!session && !isResetRoute) document.title = 'sqemes';
  }, [session, isResetRoute]);

  if (loading && !isResetRoute) {
    return (
      <EnvironmentShell>
        <LoadingScreen />
      </EnvironmentShell>
    );
  }

  // Supabase auth errors (e.g. expired email confirmation link) arrive as
  // #error=access_denied&error_code=otp_expired&...
  // HashRouter would treat this as an unknown path → 404. Strip the hash and
  // let the app render normally (logged-in users go home, logged-out see Auth).
  // SQEM-491 — the same for `#message=`: with secure email change, the FIRST of the two confirmation
  // links lands here with "Confirmation link accepted. Please proceed to confirm link sent to the
  // other email". Keep the sentence for a toast (AppRoutes shows it) instead of a 404.
  if (window.location.hash.startsWith('#message=')) {
    try {
      const msg = new URLSearchParams(window.location.hash.slice(1)).get('message');
      if (msg) sessionStorage.setItem('sqm_auth_message', msg);
    } catch { /* storage unavailable — the redirect alone still avoids the 404 */ }
    window.location.replace(window.location.origin + window.location.pathname + '#/');
    return (
      <EnvironmentShell>
        <LoadingScreen />
      </EnvironmentShell>
    );
  }
  if (window.location.hash.startsWith('#error=')) {
    window.location.replace(window.location.origin + window.location.pathname + '#/');
    return (
      <EnvironmentShell>
        <LoadingScreen />
      </EnvironmentShell>
    );
  }

  // SQEM-258 — public listing: render it instead of the sign-in screen. Deliberately *without*
  // AppProvider — the store has never run without a session, and a provider that fires a Supabase
  // query here would greet a stranger with an error. `pages/PublicListing.tsx` imports no store.
  if (!session && publicListingId) {
    return (
      <EnvironmentShell>
        <Suspense fallback={<LoadingScreen />}>
          <HashRouter>
            <Routes>
              <Route path="/library/:id" element={<PublicListing />} />
            </Routes>
          </HashRouter>
        </Suspense>
      </EnvironmentShell>
    );
  }

  // If not logged in but visiting an invite link, save the token for after auth
  // (the reset route is exempt — it establishes its own recovery session via verifyOtp).
  if (!session && !isResetRoute) {
    const hash = window.location.hash;
    const inviteMatch = hash.match(/#\/invite\/([^?]+)(?:\?email=([^&]+))?/);
    if (inviteMatch) {
      localStorage.setItem('pendingInviteToken', inviteMatch[1]);
      localStorage.setItem('pendingInviteTokenAt', String(Date.now())); // eslint-disable-line react-hooks/purity
      if (inviteMatch[2]) {
        localStorage.setItem('pendingInviteEmail', decodeURIComponent(inviteMatch[2]));
      }
    }
    const inviteEmail = localStorage.getItem('pendingInviteEmail') || undefined;
    // SQEM-258 — a pending return means someone pressed "Start free trial" on a public listing.
    // Open the register form, not the sign-in one: they already said what they want.
    const fromPublicPage = !!localStorage.getItem('sqm_return_to');
    return (
      <EnvironmentShell>
        <Suspense fallback={<LoadingScreen />}>
          <Auth inviteEmail={inviteEmail} initialMode={fromPublicPage ? 'register' : undefined} />
        </Suspense>
      </EnvironmentShell>
    );
  }

  // SQEM-459 — the reset route is rendered here, before anything reads `session`.
  //
  // `pages/ResetPassword.tsx` establishes its own session: the recovery token arrives as
  // `token_hash` in the fragment and is redeemed by `verifyOtp` (SQEM-091 — so an email scanner's
  // GET cannot burn the link before the person clicks it). This route is therefore reached with no
  // session by design, and the guards above exempt it for exactly that reason.
  //
  // ⛔ Until SQEM-264 the fall-through was `<AuthenticatedApp />`, which reads no session, so the
  // exemption was harmless. Wrapping it in `<LegalGate userId={session.user.id}>` turned the one
  // path that legitimately has no session into the one that threw — and since the first render
  // always has `session === null`, EVERY reset link opened a white screen from 2026-08-21 until
  // this line. The root has no error boundary above `AuthenticatedApp`, so nothing caught it.
  //
  // ⚠️ Deliberately not `!session && isResetRoute`. The moment `verifyOtp` establishes the recovery
  // session, that condition would hand the route to the tree below mid-flow: the form remounts, and
  // someone who has not accepted the current terms meets the legal gate instead of the password
  // field. `ResetPassword` signs out and returns to sign-in when it is done (SQEM-140), so the gate
  // still runs — on the next, clean session, which is where it belongs.
  if (isResetRoute) {
    return (
      <EnvironmentShell>
        <Suspense fallback={<LoadingScreen />}>
          <HashRouter>
            <Routes>
              <Route path="/reset-password" element={<ResetPassword />} />
            </Routes>
          </HashRouter>
        </Suspense>
      </EnvironmentShell>
    );
  }

  // SQEM-264 — agreement to the legal documents is checked here, outside `AuthenticatedApp`, so it
  // sits **before `AppProvider`**: someone who has not agreed yet should not have their workspace
  // loaded on their behalf. While nothing is published the gate renders its children untouched and
  // issues no query — see `lib/legal.ts`.
  return (
    <EnvironmentShell>
      <LegalGate userId={session.user.id}>
        <AuthenticatedApp />
      </LegalGate>
    </EnvironmentShell>
  );
}

export default App;
