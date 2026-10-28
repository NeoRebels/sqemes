import { useState, useMemo, useEffect } from 'react';
import { m } from '../lib/i18n';
import { useUI, useWorkspace, usePrompts } from '../store';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, Loader2, FilePlus } from 'lucide-react';
import { can } from '../lib/permissions';
import KindBadge from '../components/ui/KindBadge';
import SetupWizard from '../components/SetupWizard';
import RecentChatsWidget from '../components/RecentChatsWidget';
import StartComposer from '../components/StartComposer';
import AiToolLinks from '../components/AiToolLinks';

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
        showToast(m.start_subscription_activated(), 'success');
        window.history.replaceState({}, '', window.location.pathname + '#/');
      }
    }
  }, []);

  const isAdmin = can(currentUser, workspace, 'team:manage');
  const canCreate = can(currentUser, workspace, 'prompts:edit');

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

  // SQEM-552 — the plan card, the Connections rows and their data moved to the Manage Overview
  // (pages/Overview.tsx, SQEM-550). Start keeps the trial and setup banners.

  // SQEM-086 — "Favourites": the user's starred templates (all kinds, incl. skills).
  // Click re-launches the template into a new chat.
  const quickTemplates = useMemo(
    () => prompts.filter(p => p.isFavorite).slice(0, 6),
    [prompts],
  );

  // SQEM-550 (a) — "New chat" became the composer itself; "New playbook" stays as a link beside the
  // favourites for those who may create (it used to be one of two big buttons above Connections).
  const firstName = (currentUser.name || '').trim().split(/\s+/)[0];

  return (
    <div className="p-4 md:p-8 pb-16 max-w-7xl mx-auto">
      {showWizard && <SetupWizard onClose={handleWizardClose} />}

      {/* SQEM-550 (a) — redesign C: the page opens with the question and the box to answer it in. */}
      <div className="mt-4 md:mt-10 mb-8 md:mb-10 flex flex-col items-center text-center gap-6">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink-strong tracking-tight">
            {firstName ? m.start_question_named({ name: firstName }) : m.start_question()}
          </h1>
          <p className="text-ink-muted mt-2 text-sm">{m.start_in_workspace()} <span className="font-semibold text-ink">{workspace.name}</span></p>
        </div>
        <StartComposer workspaceId={workspace.id} />
        {/* SQEM-557 — or take the playbooks to the tool you already use. */}
        <AiToolLinks />
      </div>

      {/* SQEM-555 — the trial and setup banners moved to the Manage Overview: they
          speak to whoever decides about the plan and the setup. The wizard still opens here on the
          first visit of an empty workspace. */}
      {/* SQEM-550 (a) — favourites as tiles with "Use" (redesign C), above the rest. */}
      <section aria-labelledby="start-favourites" className="max-w-3xl mx-auto mb-10">
        {/* SQEM-604 — the row wraps as a whole, its items never: at 375 px the German labels broke
            into three two-line stacks ("Deine / Favoriten", "Neues / Playbook", …). */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-3">
          <h2 id="start-favourites" className="font-semibold text-ink-strong whitespace-nowrap">{m.start_favourites()}</h2>
          <div className="flex items-center gap-4 whitespace-nowrap">
            {canCreate && (
              <Link to="/playbooks/new" className="text-sm font-medium text-ink-muted hover:text-ink-strong flex items-center gap-1">
                <FilePlus className="w-3.5 h-3.5" /> {m.start_new_playbook()}
              </Link>
            )}
            <Link to="/playbooks" className="text-sm font-medium text-accent flex items-center gap-1">
              {m.start_all_playbooks()} <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
        {isLoading && quickTemplates.length === 0 ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-ink-subtle" /></div>
        ) : quickTemplates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center rounded-card border border-dashed border-line-strong">
            <p className="text-sm text-ink-subtle">{m.start_no_favourites()}</p>
            <Link to="/playbooks" className="text-sm font-medium text-accent flex items-center gap-1">
              {m.start_star_hint()} <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {quickTemplates.map(t => (
              <button
                key={t.id}
                onClick={() => navigate('/chat', { state: { launchTemplateId: t.id } })}
                className="group flex flex-col items-start gap-2 p-4 rounded-card bg-surface-sunken hover:bg-surface-raised border border-transparent hover:border-line text-left transition-all"
              >
                <KindBadge kind={t.kind} />
                <span className="font-display text-lg font-semibold text-ink-strong leading-snug line-clamp-2">{t.title}</span>
                {t.description && <span className="text-sm text-ink-muted line-clamp-2">{t.description}</span>}
                <span className="mt-auto pt-1 text-sm font-semibold text-accent flex items-center gap-1">
                  {m.start_use()} <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* SQEM-552 — recent chats under the favourites; Connections and the plan live on the Overview now. */}
      <div className="max-w-3xl mx-auto">
        <RecentChatsWidget />
      </div>
    </div>
  );
};

export default Dashboard;
