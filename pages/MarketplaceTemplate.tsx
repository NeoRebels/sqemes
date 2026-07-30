// SQEM-163 — Marketplace listing detail page. On-brand (the dropped-Phase-2 design bar): sleek, generous
// whitespace, Sqemes branding, one clear primary CTA. Shows the full listing + a transparency-complete
// view of what a copy brings (skills + files), Copy-to-my-Workspace, and a Report action. In-app
// (authenticated) for Phase 3a; a public/unauthenticated version is a later step.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useUI, useWorkspace, usePrompts } from '../store';
import { fetchLibraryTemplateDetail, copyListingToWorkspace, reportListing, voteListing, fetchMyVotes } from '../lib/api/library';
import { adaptToBrand } from '../lib/adaptTemplate';
import { firstTextModelId } from '../lib/authoringAI';
import { IS_SELF_HOSTED } from '../lib/env';
import type { LibraryTemplate, Step, Prompt } from '../types';
import KindBadge from '../components/ui/KindBadge';
import Modal from '../components/ui/Modal';
import sqemesIcon from '../assets/sqemes-icon.svg';
import { ArrowLeft, FilePlus, Flag, Loader2, FileText, Wand2, Users, ArrowUpRight, Sparkles, Flame, Snowflake } from 'lucide-react';

const REPORT_REASONS = ['Spam or low quality', 'Malicious or unsafe content', 'Copyright / not yours to share', 'Other'];

export default function MarketplaceTemplate() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useUI();
  const { currentUser, workspace } = useWorkspace();
  const { addPrompt } = usePrompts();

  const [listing, setListing] = useState<LibraryTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);
  const [adapting, setAdapting] = useState(false);

  // SQEM-165 — "Adapt to brand" (moved here from the card) needs a brand profile + an AI model.
  const modelId = firstTextModelId(workspace.apiKeys);
  const canUseAI = !!modelId || !!workspace.fundedAvailable;
  const hasBrand = !!workspace.brandProfile?.brandName?.trim();
  const canAdapt = canUseAI && hasBrand;
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0]);
  const [reportDetails, setReportDetails] = useState('');
  const [reporting, setReporting] = useState(false);
  // SQEM-169 — votes
  const [score, setScore] = useState(0);
  const [myVote, setMyVote] = useState(0);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchLibraryTemplateDetail(id).then(l => { setListing(l); setScore(l.score ?? 0); }).catch(() => setListing(null)).finally(() => setLoading(false));
    if (!IS_SELF_HOSTED) fetchMyVotes().then(m => setMyVote(m[id] ?? 0)).catch(() => {}); // voting is Cloud-only (SQEM-178)
  }, [id]);

  const vote = async (value: 1 | -1) => {
    if (!listing) return;
    const prev = myVote;
    const next = prev === value ? 0 : value; // toggle off if clicking the active direction
    setMyVote(next);
    setScore(s => s - prev + next);          // optimistic
    try { await voteListing(listing.id, value); }
    catch (e) { setMyVote(prev); setScore(s => s - next + prev); showToast(e instanceof Error ? e.message : 'Vote failed', 'error'); }
  };

  const body = listing?.content || (listing?.steps as Step[] | undefined)?.[0]?.content || listing?.systemInstruction || '';

  const handleCopy = async () => {
    if (!listing) return;
    setCopying(true);
    try {
      await copyListingToWorkspace(listing, workspace.id, currentUser.id);
      showToast('Added to your templates ✨', 'success');
      navigate('/templates');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Copy failed', 'error');
    } finally {
      setCopying(false);
    }
  };

  const handleAdapt = async () => {
    if (!listing) return;
    if (!hasBrand) { navigate('/settings', { state: { initialTab: 'brand' } }); return; }
    if (!canAdapt || !workspace.brandProfile) return;
    setAdapting(true);
    try {
      const isAssistant = listing.kind === 'assistant';
      const source = isAssistant ? (listing.systemInstruction ?? '') : body;
      const adapted = await adaptToBrand(source, listing.kind, workspace.brandProfile, { workspaceId: workspace.id, modelId });
      const now = new Date().toISOString();
      const created = await addPrompt({
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        kind: listing.kind,
        title: listing.title,
        description: listing.description,
        tag: listing.tags?.[0] ?? null,
        variables: listing.variables,
        content: isAssistant ? '' : adapted,
        systemInstruction: isAssistant ? adapted : listing.systemInstruction,
        contextFileIds: [],
        skillIds: [],
        createdAt: now,
        updatedAt: now,
        createdBy: currentUser.id,
        usageCount: 0,
        published: true,
        sourceTemplateId: listing.id,
      } as Prompt);
      if (created) {
        showToast('Adapted to your brand ✨', 'success');
        navigate(`/prompts/${created.id}/edit`);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Adaptation failed', 'error');
    } finally {
      setAdapting(false);
    }
  };

  const submitReport = async () => {
    if (!listing) return;
    setReporting(true);
    try {
      await reportListing(listing.id, reportReason, reportDetails.trim() || undefined);
      showToast('Reported — thank you. Our team will review it.', 'success');
      setReportOpen(false); setReportDetails('');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not report', 'error');
    } finally {
      setReporting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900"><Loader2 className="w-6 h-6 animate-spin text-brand-500" /></div>;
  }
  if (!listing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 dark:bg-slate-900 text-center px-6">
        <p className="text-slate-500 dark:text-slate-400">This template isn't available.</p>
        <button onClick={() => navigate('/library')} className="text-brand-600 font-bold text-sm">← Back to Marketplace</button>
      </div>
    );
  }

  const fileNames = listing.preview?.fileNames ?? [];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Top bar */}
      <div className="max-w-3xl mx-auto px-6 pt-6 flex items-center justify-between">
        <button onClick={() => navigate('/library')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Marketplace
        </button>
        <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
          <img src={sqemesIcon} alt="Sqemes" className="w-5 h-5" />
          <span className="text-sm font-bold tracking-tight text-slate-600 dark:text-slate-300">Sqemes</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Hero */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <KindBadge kind={listing.kind} />
          <span className="text-2xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">{listing.category}</span>
          {listing.status === 'pending' && <span className="text-2xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-amber-50 text-amber-600">Pending review</span>}
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">{listing.title}</h1>
        {listing.description && <p className="text-lg text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">{listing.description}</p>}
        <div className="flex items-center gap-4 mt-4 text-sm text-slate-400 dark:text-slate-500">
          <span className="inline-flex items-center gap-1.5"><Users className="w-4 h-4" /> {listing.usageCount} use{listing.usageCount === 1 ? '' : 's'}</span>
          {listing.preview?.skillCount ? <span className="inline-flex items-center gap-1.5"><Wand2 className="w-4 h-4" /> {listing.preview.skillCount} skill{listing.preview.skillCount === 1 ? '' : 's'}</span> : null}
          {fileNames.length ? <span className="inline-flex items-center gap-1.5"><FileText className="w-4 h-4" /> {fileNames.length} file{fileNames.length === 1 ? '' : 's'}</span> : null}
        </div>

        {/* Primary CTA */}
        <div className="flex flex-wrap items-center gap-3 mt-8">
          <button onClick={handleCopy} disabled={copying || adapting} className="inline-flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-brand-200 dark:shadow-none disabled:opacity-50">
            {copying ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus className="w-4 h-4" />} Add to templates
          </button>
          {/* SQEM-170 — Adapt to brand is a Cloud-only feature */}
          {!IS_SELF_HOSTED && (
            <button
              onClick={handleAdapt}
              disabled={copying || adapting || (hasBrand && !canAdapt)}
              title={!hasBrand ? 'Set up your brand profile to adapt' : !canUseAI ? 'Connect an AI provider key to adapt' : 'Adapt this template to your brand'}
              className="inline-flex items-center gap-2 px-5 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {adapting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {hasBrand ? 'Adapt to brand' : 'Set up brand'}
            </button>
          )}
          {/* SQEM-169 — temperature votes: 🔥 hot (red) vs ❄️ cold (ice-blue); score in degrees.
              SQEM-178 — voting + reporting are Cloud-only (need an account); hidden on self-host. */}
          {!IS_SELF_HOSTED && (
            <>
              <div className="inline-flex items-center rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <button onClick={() => vote(1)} title="Hot" className={`inline-flex items-center px-3 py-3 transition-colors ${myVote === 1 ? 'text-red-500 bg-red-50 dark:bg-red-900/20' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                  <Flame className="w-4 h-4" />
                </button>
                <span className={`px-2 text-sm font-bold tabular-nums ${score > 0 ? 'text-red-500' : score < 0 ? 'text-sky-500' : 'text-slate-400'}`}>{score > 0 ? `+${score}` : score}°</span>
                <button onClick={() => vote(-1)} title="Cold" className={`inline-flex items-center px-3 py-3 transition-colors ${myVote === -1 ? 'text-sky-500 bg-sky-50 dark:bg-sky-900/20' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                  <Snowflake className="w-4 h-4" />
                </button>
              </div>
              <button onClick={() => setReportOpen(true)} className="inline-flex items-center gap-1.5 px-4 py-3 text-slate-500 dark:text-slate-400 hover:text-red-500 text-sm font-semibold transition-colors">
                <Flag className="w-4 h-4" /> Report
              </button>
            </>
          )}
        </div>

        {/* What you get — transparency */}
        {(listing.preview?.skillCount || fileNames.length) ? (
          <div className="mt-8 rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-soft p-5">
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">What comes with this copy</h2>
            {fileNames.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {fileNames.map((n, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-lg px-2 py-1 text-slate-600 dark:text-slate-300"><FileText className="w-3 h-3" /> {n}</span>
                ))}
              </div>
            )}
            {!!listing.preview?.skillCount && <p className="text-xs text-slate-400 mt-2">Includes {listing.preview.skillCount} embedded skill{listing.preview.skillCount === 1 ? '' : 's'}, resolved into your copy.</p>}
          </div>
        ) : null}

        {/* Body preview */}
        {body && (
          <div className="mt-6">
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Preview</h2>
            <pre className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-soft p-5 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words max-h-96 overflow-y-auto font-sans leading-relaxed">{body}</pre>
          </div>
        )}

        {/* Variables */}
        {listing.variables?.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Variables</h2>
            <div className="flex flex-wrap gap-1.5">
              {listing.variables.map(v => <span key={v.id} className="text-xs font-mono bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 rounded-lg px-2 py-1">{`{{${v.name}}}`}</span>)}
            </div>
          </div>
        )}

        {/* Footer — soft growth loop */}
        <div className="mt-14 pt-6 border-t border-slate-100 dark:border-slate-800 flex items-center justify-center">
          <a href="https://sqemes.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-slate-400 dark:text-slate-500 hover:text-brand-600 transition-colors">
            <img src={sqemesIcon} alt="" className="w-4 h-4 opacity-70" /> Made with Sqemes <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Report modal */}
      <Modal open={reportOpen} onClose={() => !reporting && setReportOpen(false)} size="sm" className="p-6">
        <div className="flex items-center gap-2.5 mb-2"><Flag className="w-6 h-6 text-red-500" /><h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Report this template</h3></div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Tell us what's wrong. Our team reviews reports and can unpublish a listing.</p>
        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Reason</label>
        <select value={reportReason} onChange={e => setReportReason(e.target.value)} className="w-full p-3 mb-4 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20">
          {REPORT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <textarea value={reportDetails} onChange={e => setReportDetails(e.target.value)} rows={3} placeholder="Optional details…" className="w-full p-3 mb-5 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none placeholder:text-slate-400" />
        <div className="flex gap-2">
          <button onClick={() => setReportOpen(false)} disabled={reporting} className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors disabled:opacity-50">Cancel</button>
          <button onClick={submitReport} disabled={reporting} className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {reporting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reporting…</> : 'Submit report'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
