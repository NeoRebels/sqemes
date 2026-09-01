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
import { AlertCircle } from 'lucide-react';

/** Where the app lives, so the offer can hand someone back to this listing afterwards. */
const listingHash = (id: string) => `#/library/${id}`;

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
      offer={
        <div className="mt-6 rounded-2xl border border-brand-100 dark:border-brand-900/40 bg-brand-50/60 dark:bg-brand-900/10 p-5">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
            Add this to your workspace, adapt it to your brand, and rate it
          </p>
          {/* The wording is not free: a fresh Cloud workspace fails `needsSubscriptionGate` and lands
              on the plan chooser. There is no free tier in Cloud by design — free means the trial or
              self-hosting, nothing else — the trial is 14 days, and Stripe asks for a card. Saying
              "free account" here would be a promise the next screen breaks. (Self-host has no billing
              at all, so this gate never fires there.) */}
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
            Start a <span className="font-semibold text-slate-600 dark:text-slate-300">free 14-day trial</span> — a card is required, and you can cancel any time.
            Prefer to keep it free forever? <a href="https://github.com/NeoRebels/sqemes" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-brand-600">Self-host Sqemes</a> — this marketplace is readable from your own instance.
          </p>
          <button onClick={startTrial} className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm transition-all">
            Start free trial
          </button>
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
