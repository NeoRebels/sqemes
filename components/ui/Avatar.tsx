import { useState } from 'react';

/**
 * SQEM-205 — an avatar that never depends on the network to render.
 *
 * Profile pictures used to be an external HTTP dependency: `handle_new_user` minted an
 * `api.dicebear.com` URL at signup, and most render sites had no fallback. Behind a corporate proxy
 * or an ad blocker the image simply broke — for everyone in that company at once, which is what the
 * 2026-08-05 usability test ran into. On self-host it is worse still: those instances often run in
 * networks that cannot reach the public internet at all.
 *
 * Initials are drawn locally and always work. A `src` is treated as an enhancement: if it loads,
 * it wins; if it fails or is absent, the initials stay. Nothing here waits on a third party.
 */

/** Deterministic tint from the name, so the same person keeps the same colour everywhere. */
const TINTS = [
  'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
];

function tintFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length];
}

/** "Ufuk Ören" → "UÖ", "sqemes" → "S", "" → "?" */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * SQEM-205 — a random avatar drawn locally and stored as a `data:` URI.
 *
 * "Randomize" used to mint an `api.dicebear.com` URL, i.e. it created a fresh external dependency
 * on every click — which then broke behind proxies and ad blockers, and never loads at all on a
 * self-hosted instance without internet access. This produces a comparable geometric identicon with
 * no network involved. The result is a self-contained SVG, so it also survives being exported.
 */
export function randomAvatarDataUri(): string {
  const hue = Math.floor(Math.random() * 360);
  const bg = `hsl(${hue} 70% 92%)`;
  const fg = `hsl(${hue} 55% 42%)`;
  const CELLS = 5;
  const SIZE = 80;
  const cell = SIZE / CELLS;

  let squares = '';
  for (let y = 0; y < CELLS; y++) {
    // Mirror horizontally so the shape reads as a face/emblem rather than noise.
    for (let x = 0; x < Math.ceil(CELLS / 2); x++) {
      if (Math.random() < 0.5) continue;
      const mirrored = CELLS - 1 - x;
      squares += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`;
      if (mirrored !== x) squares += `<rect x="${mirrored * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`;
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>` +
    `<g fill="${fg}">${squares}</g></svg>`;

  // encodeURIComponent keeps this valid without base64 — smaller, and readable in the DB.
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function Avatar({
  src,
  name,
  className = 'w-8 h-8',
  rounded = 'rounded-full',
}: {
  /** Optional image. Absent, empty or failing → initials. */
  src?: string | null;
  name?: string | null;
  /** Size (and any extra layout) classes. */
  className?: string;
  rounded?: string;
}) {
  const label = (name || '').trim();
  const url = (src || '').trim();

  // Remember *which* URL failed rather than a bare boolean: a new `src` is then automatically
  // eligible again, with no effect resetting state on every change.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = !!url && failedSrc === url;

  if (!url || failed) {
    return (
      <span
        aria-label={label || undefined}
        role={label ? 'img' : undefined}
        className={`${className} ${rounded} ${tintFor(label)} inline-flex items-center justify-center font-bold select-none shrink-0`}
        // SQEM-296 — a fixed 1rem, deliberately not `em`.
        //
        // This was `0.4em`, which reads as "40% of the circle" and is not what `em` means: it
        // resolves against the *inherited* text size, which no avatar sets. Every call site is
        // inside body or `text-sm` copy, so the initials came out at roughly 6px — legible only
        // because two capitals are hard to mistake. The 96px profile avatar in Settings was the
        // same 6px as the 32px one in the sidebar; the unit never saw the box it sat in.
        //
        // A single value is enough because there is one avatar component and five call sites.
        // If a size ever genuinely needs its own, give it a prop — do not reach back for `em`,
        // which will silently drift again the moment someone wraps a call site in `text-xs`.
        style={{ fontSize: '1rem' }}
      >
        {initialsOf(label)}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={label || 'Profile picture'}
      onError={() => setFailedSrc(url)}
      className={`${className} ${rounded} object-cover shrink-0`}
    />
  );
}

export default Avatar;
