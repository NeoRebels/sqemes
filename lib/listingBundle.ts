// SQEM-302 — hand a marketplace listing over as a Sqemes bundle.
//
// **A listing's payload already *is* a `.sqemes.zip`** (SQEM-161), so for a user-contributed listing
// this is a pass-through: no conversion, no re-zipping, no chance of losing something on the way.
// That is the whole reason the download changed format — the old path converted that bundle into an
// Agent Skill folder, which could only ever carry a subset of it.
//
// ⛔ **21 of the 22 listings on production are curated and carry no bundle at all** — they are text
// rows. For those a bundle is assembled here, at the moment of the click. The alternative was to
// offer the download only where a stored bundle exists, which would have removed the button from
// almost every listing on the page: worse than what it replaced, and visibly so.
//
// ⚠️ **Imports nothing but `bundleFormat` and JSZip, deliberately.** The public listing page must not
// pull in `lib/api/*` → `lib/supabase` (SQEM-258). Taking bytes rather than making a network call
// also keeps this testable without a marketplace.
import type { LibraryTemplate } from '../types';

/**
 * The listing's body. Curated rows predate the `content` column and keep their text in the first
 * step; UGC rows use `content`.
 *
 * ⚠️ Checking only `content` would export every curated listing as an empty template — the download
 * would succeed, produce a file, and the file would be hollow. A failure that looks like success is
 * the expensive kind.
 */
function bodyOf(listing: Pick<LibraryTemplate, 'content' | 'steps'>): string {
  if (listing.content) return listing.content;
  const first = listing.steps?.[0]?.content;
  return typeof first === 'string' ? first : '';
}

/**
 * Build the `.sqemes.zip` for a listing.
 *
 * `bundle` is the listing's stored bundle bytes, or `null` for a curated listing. When present it is
 * returned untouched: it was written by the exporter and re-packing it could only lose fidelity.
 */
export async function listingToBundle(
  listing: Pick<LibraryTemplate, 'title' | 'description' | 'content' | 'kind' | 'steps' | 'variables' | 'systemInstruction' | 'brandConfig'>,
  bundle: Blob | null,
): Promise<Blob> {
  if (bundle) return bundle;

  const [{ default: JSZip }, { BUNDLE_SCHEMA }] = await Promise.all([
    import('jszip'),
    import('./bundleFormat'),
  ]);
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({
    schema: BUNDLE_SCHEMA,
    exportedAt: new Date().toISOString(),
    generator: 'sqemes',
    templates: [{
      ref: 't1',
      kind: listing.kind,
      title: listing.title,
      description: listing.description || '',
      tag: null,
      variables: listing.variables || [],
      content: bodyOf(listing),
      systemInstruction: listing.systemInstruction,
      brandConfig: listing.brandConfig,
      contextFileRefs: [],
    }],
    files: [],
  }, null, 2));
  return zip.generateAsync({ type: 'blob' });
}
