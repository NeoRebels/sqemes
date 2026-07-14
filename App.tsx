import React, { Suspense } from 'react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import ChoosePlanScreen from './components/ChoosePlanScreen';
import { needsSubscriptionGate } from './lib/subscription';
import { IS_SELF_HOSTED } from './lib/env';

const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Templates = React.lazy(() => import('./pages/Templates'));
const TemplateEditor = React.lazy(() => import('./pages/TemplateEditor'));
const PromptRunnerRedirect = () => {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  React.useEffect(() => {
    nav('/chat', { replace: true, state: { launchTemplateId: id } });
  }, [id, nav]);
  return null;
};
const Library = React.lazy(() => import('./pages/Library'));
const Chat = React.lazy(() => import('./pages/Chat'));
const Settings = React.lazy(() => import('./pages/Settings'));
const Files = React.lazy(() => import('./pages/Files'));
const InviteAccept = React.lazy(() => import('./pages/InviteAccept'));
const ResetPassword = React.lazy(() => import('./pages/ResetPassword'));
const Auth = React.lazy(() => import('./pages/Auth'));
const NotFound = React.lazy(() => import('./pages/NotFound'));
import { AppProvider, useUI, useToast, useWorkspace } from './store';
import { useAuth } from './hooks/useAuth';
import { CheckCircle, AlertTriangle, Info, X, Menu, Plus, LogOut } from 'lucide-react';
import { isStagingSupabaseEnvironment } from './lib/environment';

// SQEM-091 — Password-recovery links are routed to the reset page by the PASSWORD_RECOVERY
// handler in hooks/useAuth.ts (fires once supabase-js establishes the recovery session from
// the URL). The /reset-password route below bypasses the loading/workspace guards so the
// form renders immediately from that session.

const StagingEnvironmentBanner = () => {
  if (!isStagingSupabaseEnvironment) return null;

  return (
    <div
      role="status"
      aria-label="Staging environment"
      className="fixed top-0 left-0 right-0 w-full h-8 bg-red-600 text-white text-center text-xs sm:text-sm font-bold uppercase flex items-center justify-center shadow-sm z-[200] pointer-events-none"
    >
      Staging environment
    </div>
  );
};

const EnvironmentShell = ({ children }: React.PropsWithChildren<{}>) => {
  if (!isStagingSupabaseEnvironment) return <>{children}</>;

  return (
    <div className="staging-environment-shell h-full min-h-0 flex flex-col bg-slate-50 dark:bg-slate-900">
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
      className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 animate-fade-in z-[100] text-white cursor-default ${
        { error: 'bg-red-500', success: 'bg-slate-900', info: 'bg-blue-500' }[toast.type]
      }`}
    >
      {toast.type === 'success' && <CheckCircle className="w-5 h-5 text-emerald-400" />}
      {toast.type === 'error' && <AlertTriangle className="w-5 h-5 text-white" />}
      {toast.type === 'info' && <Info className="w-5 h-5 text-white" />}
      <span className="font-medium text-sm">{toast.message}</span>
      <button onClick={hideToast} aria-label="Dismiss notification"><X className="w-4 h-4 opacity-70 hover:opacity-100" /></button>
    </div>
  );
};

const Layout = ({ children }: React.PropsWithChildren<{}>) => {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  return (
    <div className="flex h-screen w-full bg-slate-50 dark:bg-slate-900 overflow-hidden">
      <Sidebar mobileOpen={mobileMenuOpen} setMobileOpen={setMobileMenuOpen} />

      <div className="flex-1 flex flex-col h-full relative overflow-hidden">
         {/* Mobile Header */}
         <div className="md:hidden bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 flex items-center justify-between shrink-0 z-20">
            <div className="font-bold text-lg text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <img src="/logo-favicon-V2.png" alt="sqemes" className="w-8 h-8 rounded-lg" />
              sqemes
            </div>
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              <Menu className="w-6 h-6" />
            </button>
         </div>

         <main className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth bg-slate-50 dark:bg-slate-900">
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <img src="/logo-favicon-V2.png" alt="sqemes" className="w-10 h-10 rounded-xl shadow-soft" />
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">sqemes</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{IS_SELF_HOSTED ? 'No workspace yet' : 'Create Your First Workspace'}</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-2">{IS_SELF_HOSTED ? 'Ask an administrator of this instance to invite you to a workspace.' : 'A workspace is where your team collaborates on prompts.'}</p>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-soft border border-slate-100 dark:border-slate-700 p-8">
          {/* SQEM-121 — self-host is single-instance: orphaned users can't create a workspace, only be invited */}
          {!IS_SELF_HOSTED && <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Workspace Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Team"
                required
                className="w-full px-4 py-3 border border-slate-200 dark:border-slate-600 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
              />
            </div>
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-brand-200 dark:shadow-none flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              {creating ? 'Creating...' : 'Create Workspace'}
            </button>
          </form>}
          <button
            onClick={() => signOut()}
            className="w-full mt-4 py-3 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
};

const AppRoutes = () => {
  const { noWorkspace, isLoading } = useUI();
  const { workspace } = useWorkspace();
  const { pathname } = useLocation();

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
  if (workspace.id && needsSubscriptionGate(workspace)) return <ChoosePlanScreen />;

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        {/* Full Screen Routes */}
        <Route path="/prompts/new" element={<TemplateEditor />} />
        <Route path="/prompts/:id/edit" element={<TemplateEditor />} />
        <Route path="/prompts/:id" element={<PromptRunnerRedirect />} />
        <Route path="/library/new" element={<TemplateEditor />} />
        <Route path="/library/:id/edit" element={<TemplateEditor />} />

        {/* Dashboard Layout Routes */}
        <Route path="/" element={<Layout><Dashboard /></Layout>} />
        <Route path="/templates" element={<Layout><Templates /></Layout>} />
        <Route path="/prompts" element={<Navigate to="/templates" replace />} />
        <Route path="/assistants" element={<Navigate to="/templates?kind=assistant" replace />} />
        <Route path="/files" element={<Layout><Files /></Layout>} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/chat/:sessionId" element={<Chat />} />
        <Route path="/chat-history" element={<Navigate to="/chat" replace />} />
        <Route path="/library" element={<Layout><Library /></Layout>} />
        <Route path="/settings" element={<Layout><Settings /></Layout>} />
        <Route path="/workspace" element={<Navigate to="/settings" state={{ initialTab: 'team' }} replace />} />
        <Route path="/invite/:token" element={<InviteAccept />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route path="*" element={<Layout><NotFound /></Layout>} />
      </Routes>
    </Suspense>
  );
};

// Sets the browser tab title to "<Page> - sqemes" from the current route.
const pageTitleForPath = (pathname: string): string => {
  if (pathname === '/') return 'Dashboard';
  if (pathname.startsWith('/chat')) return 'Chat';
  if (pathname.startsWith('/prompts/')) return 'Template editor';
  if (pathname.startsWith('/templates') || pathname === '/prompts' || pathname.startsWith('/assistants')) return 'Templates';
  if (pathname.startsWith('/library/')) return 'Marketplace editor';
  if (pathname === '/library') return 'Marketplace';
  if (pathname.startsWith('/files')) return 'Files';
  if (pathname.startsWith('/settings') || pathname === '/workspace') return 'Settings';
  if (pathname.startsWith('/invite')) return 'Accept invite';
  if (pathname === '/reset-password') return 'Reset password';
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
          <SpeedInsights />
        </HashRouter>
      </AppProvider>
    </ErrorBoundary>
  );
};

const LoadingScreen = () => (
  <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
    <div className="text-center">
      <img src="/logo-favicon-V2.png" alt="sqemes" className="w-10 h-10 rounded-xl shadow-soft mx-auto mb-4 animate-pulse" />
      <p className="text-slate-400 dark:text-slate-500 text-sm font-medium">Loading...</p>
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
    }
  }, [session]);

  // SQEM-091 — the password-recovery route must render before a session exists: it redeems
  // the recovery token_hash via verifyOtp itself. Let it through the auth/loading gates.
  const isResetRoute = typeof window !== 'undefined' && window.location.hash.startsWith('#/reset-password');

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
  if (window.location.hash.startsWith('#error=')) {
    window.location.replace(window.location.origin + window.location.pathname + '#/');
    return (
      <EnvironmentShell>
        <LoadingScreen />
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
    return (
      <EnvironmentShell>
        <Suspense fallback={<LoadingScreen />}>
          <Auth inviteEmail={inviteEmail} />
        </Suspense>
      </EnvironmentShell>
    );
  }

  return (
    <EnvironmentShell>
      <AuthenticatedApp />
    </EnvironmentShell>
  );
}

export default App;
