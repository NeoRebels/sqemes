// SQEM-258 — turn a marketplace listing into an Anthropic Agent Skill folder.
//
// The two formats already exist and neither had to change: a listing's payload is a `.sqemes.zip`
// (SQEM-161) and a skill folder is what `buildSkillZip` writes (SQEM-243). This is only the joint
// between them — which is why it lives in its own module and takes bytes rather than a network call:
// the conversion is testable without a marketplace.
//
// ⚠️ **Skills only.** SQEM-236 settled it: one format per job. A prompt's variables and an
// assistant's brand config cannot be expressed as a SKILL.md, so offering the download for them
// would hand someone a file that silently lost half the template.
import { buildSkillZip } from './skillBundle';
import type { LibraryTemplate } from '../types';

/** A listing can be downloaded as a skill folder only if it *is* a skill. */
export function canDownloadAsSkill(listing: Pick<LibraryTemplate, 'kind'>): boolean {
  return listing.kind === 'skill';
}

/**
 * Build the skill folder.
 *
 * `bundle` is the listing's `.sqemes.zip` bytes, or `null` for a curated listing — **21 of the 22
 * listings on production carry no bundle**, and for those the folder is a lone `SKILL.md`. That is a
 * valid Agent Skill, and the label in the UI must not promise a folder full of files that does not
 * exist.
 */
export async function listingToSkillZip(
  listing: Pick<LibraryTemplate, 'title' | 'description' | 'content' | 'kind'>,
  bundle: Blob | null,
): Promise<Blob> {
  const head = {
    title: listing.title,
    description: listing.description || '',
    content: listing.content || '',
  };

  if (!bundle) return buildSkillZip({ ...head, files: [] });

  // From `bundleFormat`, not `templateBundle`: the latter imports `lib/api/*` → `lib/supabase`,
  // which the public listing page must not pull in (SQEM-258). Lazy because JSZip and the reader are
  // a chunk nobody loading a listing page needs up front.
  const { readBundle } = await import('./bundleFormat');
  const { zip, manifest } = await readBundle(new File([bundle], 'bundle.sqemes.zip'));

  const primary = manifest.templates?.[0];
  const byRef = new Map((manifest.files || []).map(f => [f.ref, f]));
  // The primary template's own files, not every file in the bundle — a bundle can carry an embedded
  // skill's files too, and those are not part of *this* folder.
  const refs = primary?.contextFileRefs?.length ? primary.contextFileRefs : [...byRef.keys()];

  const files: Awaited<ReturnType<typeof collect>> = await collect(refs);

  async function collect(list: string[]) {
    const out: { name: string; blob: Blob; mimeType: string }[] = [];
    for (const ref of list) {
      const meta = byRef.get(ref);
      const entry = meta && zip.file(meta.path);
      if (!meta || !entry) continue; // a bundle that lost a file exports the rest, not nothing
      out.push({ name: meta.name, blob: await entry.async('blob'), mimeType: meta.mimeType });
    }
    return out;
  }

  return buildSkillZip({
    // The listing's own title/description win over the bundle's: they are what the reader saw on the
    // page, and a listing can be renamed after it was published.
    ...head,
    content: primary?.content ?? head.content,
    files,
  });
}
