// SQEM-163 — Marketplace listing detail page, signed in. On-brand (the dropped-Phase-2 design bar):
// sleek, generous whitespace, Sqemes branding, one clear primary CTA.
//
// SQEM-258 — the presentation moved to `components/marketplace/ListingView`, which this page feeds
// with handlers. The public twin is `pages/PublicListing.tsx`; it renders the same view with fewer
// handlers and no store. The comment that used to sit here — *"a public/unauthenticated version is a
// later step"* — is that step, and the split is what keeps the store off the public route.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useUI, useWorkspace, usePrompts } from '../store';
import {
  fetchLibraryTemplateDetail, copyListingToWorkspace, reportListing, voteListing, fetchMyVotes,
  fetchPublicListingBundle,
} from '../lib/api/library';
import { adaptToBrand } from '../lib/adaptTemplate';
import { firstTextModelId } from '../lib/authoringAI';
import { IS_SELF_HOSTED, MARKETPLACE_ENABLED } from '../lib/env';
import { canDownloadAsSkill, listingToSkillZip } from '../lib/listingSkillZip';
import { downloadBlob } from '../lib/bundleFormat';
import { toSlug } from '../lib/skillBundle';
import type { LibraryTemplate, Step, Prompt } from '../types';
import Modal from '../components/ui/Modal';
import ListingView, { ListingLoading, ListingUnavailable } from '../components/marketplace/ListingView';
import { Flag, Loader2 } from 'lucide-react';

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
  const [downloading, setDownloading] = useState(false);

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
    if (MARKETPLACE_ENABLED) fetchMyVotes().then(m => setMyVote(m[id] ?? 0)).catch(() => {}); // SQEM-189 — self-host votes too
  }, [id]);

  const vote = async (value: 1 | -1) => {
    if (!listing) return;
    const prev = myVote;
    const next = prev === value ? 0 : value;
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

  // SQEM-258 — the listing's payload is a `.sqemes.zip`; an Agent Skill is a folder. The conversion
  // lives in `lib/listingSkillZip.ts`, and the bundle comes over the public endpoint so this path is
  // identical to the one the public page uses — one behaviour to reason about, not two.
  const handleDownload = async () => {
    if (!listing) return;
    setDownloading(true);
    try {
      const bundle = await fetchPublicListingBundle(listing);
      downloadBlob(await listingToSkillZip(listing, bundle), `${toSlug(listing.title)}.zip`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Download failed', 'error');
    } finally {
      setDownloading(false);
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

  if (loading) return <ListingLoading />;
  if (!listing) return <ListingUnavailable onExit={() => navigate('/library')} />;

  return (
    <ListingView
      listing={listing}
      onExit={() => navigate('/library')}
      score={score}
      myVote={myVote}
      onVote={MARKETPLACE_ENABLED ? vote : undefined}
      // SQEM-178 — reporting stays Cloud-only (needs an account).
      onReport={IS_SELF_HOSTED ? undefined : () => setReportOpen(true)}
      onCopy={handleCopy}
      copying={copying}
      // SQEM-170 — Adapt to brand is a Cloud-only feature.
      onAdapt={IS_SELF_HOSTED ? undefined : handleAdapt}
      adapting={adapting}
      adaptLabel={hasBrand ? 'Adapt to brand' : 'Set up brand'}
      adaptDisabled={hasBrand && !canAdapt}
      adaptTitle={!hasBrand ? 'Set up your brand profile to adapt' : !canUseAI ? 'Connect an AI provider key to adapt' : 'Adapt this template to your brand'}
      onDownload={canDownloadAsSkill(listing) ? handleDownload : undefined}
      downloading={downloading}
    >
      {/* Report modal */}
      <Modal open={reportOpen} onClose={() => !reporting && setReportOpen(false)} size="sm" className="p-6">
        <div className="flex items-center gap-2.5 mb-2"><Flag className="w-6 h-6 text-red-500" /><h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Report this template</h3></div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Tell us what&apos;s wrong. Our team reviews reports and can unpublish a listing.</p>
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
    </ListingView>
  );
}
