// SQEM-258 — the marketplace listing page for someone who is not signed in.
//
// **This file must not import the store.** `App()` only mounts `AppProvider` once there is a
// session; the providers have never run without one, and the single URL a stranger reaches is the
// wrong place to discover how they behave. So the public page fetches from the public endpoint
// itself and hands `ListingView` only the handlers that work without an account.
//
// Exactly one of them does: the download. Everything else — adding, adapting, reporting, voting —
// needs an identity, which is why the offer below exists instead of four disabled buttons.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { fetchPublicListingDetail, fetchPublicListingBundle } from '../lib/api/library';
import { listingToBundle } from '../lib/listingBundle';
import { downloadBlob } from '../lib/bundleFormat';
import { toSlug } from '../lib/skillBundle';
import type { LibraryTemplate } from '../types';
import ListingView, { ListingLoading, ListingUnavailable } from '../components/marketplace/ListingView';
import { AlertCircle, ArrowRight, Check, Sparkles } from 'lucide-react';
import { IS_SELF_HOSTED, MARKETPLACE_API_URL, CLOUD_PROD_MARKETPLACE } from '../lib/env';
import { publicListingOffer } from '../lib/publicRoutes';

/** Where the app lives, so the offer can hand someone back to this listing afterwards. */
const listingHash = (id: string) => `#/library/${id}`;

/** What an account adds to this listing — each one a control the signed-in page really has. */
const OFFER_POINTS = [
  'Add it to your playbooks in one click',
  'Adapt it to your brand with AI',
  'Use it inside ChatGPT, Claude, Cursor and more',
];

export default function PublicListing() {
  const { id } = useParams();
  const [listing, setListing] = useState<LibraryTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchPublicListingDetail(id)
      .then(setListing)
      .catch(() => setListing(null))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDownload = async () => {
    if (!listing) return;
    setDownloading(true);
    setError(null);
    try {
      const bundle = await fetchPublicListingBundle(listing);
      downloadBlob(await listingToBundle(listing, bundle), `${toSlug(listing.title)}.sqemes.zip`);
    } catch (e) {
      // No store here, so no toast: the message goes on the page, where it cannot be missed.
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  // ⚠️ This must leave the listing hash behind. The first version set the hash to the listing —
  // which it already was — and reloaded, so the public route matched again and the button quietly
  // reloaded the page onto itself. Found by the owner in an incognito window; it looked like a dead
  // control. Go to `#/`, where no public route matches and the sign-in screen renders.
  //
  // The return trip is the whole point: after signing up, land back on this listing so the action
  // that was clicked is one click away. Without it the offer leaks at the moment it is accepted —
  // and the trip goes through Stripe, which comes back on a bare URL.
  const startTrial = () => {
    try { localStorage.setItem('sqm_return_to', listingHash(id!)); } catch { /* private mode */ }
    window.location.hash = '#/';
    window.location.reload();
  };

  // SQEM-410 — on Cloud the offer starts the trial here; on a self-hosted instance it still advertises
  // Cloud, so the button opens the same listing on Cloud instead of this instance's sign-up form.
  const offerTarget = publicListingOffer({
    selfHosted: IS_SELF_HOSTED, marketplaceUrl: MARKETPLACE_API_URL,
    listingId: id ?? '', cloudMarketplaceUrl: CLOUD_PROD_MARKETPLACE,
  });
  const ctaClass = 'inline-flex items-center gap-2 px-5 py-3 bg-white hover:bg-brand-50 text-brand-800 rounded-xl font-bold text-sm transition-all shadow-sm';

  if (loading) return <ListingLoading />;
  // No exit: `/library` is behind the sign-in wall, so "Back to Marketplace" would walk a
  // signed-out visitor into it. The footer link to sqemes.com is the way out that works.
  if (!listing) return <ListingUnavailable />;

  return (
    <ListingView
      listing={listing}
      score={listing.score ?? 0}
      // No onVote / onReport / onCopy / onAdapt: each needs an account, and a disabled control is a
      // rejection. The offer below carries them instead.
      onDownload={handleDownload}
      downloading={downloading}
      offer={offerTarget.kind === 'none' ? undefined :
        // SQEM-405 — the owner asked for a tile that reads as an offer rather than a note. It borrows
        // the plan card on the Dashboard (dark brand gradient, white type), so it is a pattern the app
        // already has, not a new one. It stays dark in both themes on purpose: it is the one surface
        // on this page that asks for something.
        <div className="mt-8 relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 dark:ring-1 dark:ring-brand-700/60 p-6 sm:p-7 text-white shadow-lg">
          <div aria-hidden className="pointer-events-none absolute -top-20 -right-16 w-56 h-56 rounded-full bg-brand-500/30 blur-3xl" />
          <div className="relative">
            <span className="inline-flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-brand-200">
              <Sparkles className="w-3.5 h-3.5" /> sqemes Cloud
            </span>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight mt-1.5">Make this playbook yours</h2>
            {/* Each point is something the signed-in page actually does: "Add to playbooks", "Adapt to
                brand", and the extension (ChatGPT, Claude) plus MCP (Cursor). Nothing here may promise
                what the next screen does not deliver. */}
            <ul className="mt-4 space-y-2.5">
              {OFFER_POINTS.map(point => (
                <li key={point} className="flex items-start gap-2.5 text-sm text-brand-50">
                  <span className="mt-0.5 shrink-0 w-4 h-4 rounded-full bg-white/15 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" strokeWidth={3} />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
            {/* The wording is not free: a fresh Cloud workspace fails `needsSubscriptionGate` and lands
                on the plan chooser. There is no free tier in Cloud by design — free means the trial or
                self-hosting, nothing else — the trial is 14 days, and Stripe asks for a card. Saying
                "free account" here would be a promise the next screen breaks. (Self-host has no billing
                at all, so this gate never fires there.) */}
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
              {offerTarget.kind === 'cloud' ? (
                <a href={offerTarget.href} className={ctaClass}>
                  Start free 14-day trial <ArrowRight className="w-4 h-4" />
                </a>
              ) : (
                <button onClick={startTrial} className={ctaClass}>
                  Start free 14-day trial <ArrowRight className="w-4 h-4" />
                </button>
              )}
              <span className="text-xs text-brand-200">A card is required · cancel any time</span>
            </div>
            <p className="mt-5 pt-4 border-t border-white/10 text-xs text-brand-200 leading-relaxed">
              Prefer to keep it free forever? <a href="https://github.com/NeoRebels/sqemes" target="_blank" rel="noopener noreferrer" className="font-semibold text-white underline underline-offset-2 decoration-white/40 hover:decoration-white">Self-host sqemes</a> — this marketplace is readable from your own instance.
            </p>
          </div>
        </div>
      }
    >
      {error && (
        <div className="max-w-3xl mx-auto px-6 pb-8 -mt-4">
          <p className="inline-flex items-center gap-2 text-sm text-red-600 dark:text-red-400"><AlertCircle className="w-4 h-4" /> {error}</p>
        </div>
      )}
    </ListingView>
  );
}
