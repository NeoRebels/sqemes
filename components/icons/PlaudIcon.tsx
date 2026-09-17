// Plaud brand mark (inline SVG, CSP-safe): the arch with a centred dot.
//
// Traced from their own favicon (`plaud.ai`, 180×180) — a thick Λ with a rounded apex, splayed legs
// cut off at the baseline, and a filled circle in the opening.
//
// ⚠️ **This file used to carry an invented microphone glyph and a licence argument for it.** The
// argument cited SQEM-207 / SQEM-386, which are about the **Chrome Web Store badge** — a mark Google
// publishes explicit and narrow usage rules for. A connector tile naming the service it connects is
// not that case, and every other tile here already draws the real mark (Notion, GitHub, Shopify, the
// four Google ones). The distinction is what matters: the badge rule stands, the tile rule does not.
//
// ⚠️ `currentColor`, deliberately. Plaud's mark is black; hard-coding it would make the tile invisible
// in dark mode. Marks that carry a colour of their own keep it (Shopify green, Notion black-on-white)
// — for a black mark, following the text colour is the faithful choice, not the lazy one.
export default function PlaudIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Plaud">
      <path
        fill="currentColor"
        d="M12 2.2c-1.2 0-2.3.72-2.76 1.84L1.72 20.53c-.2.45.13.97.63.97h3.98c.42 0 .8-.26.94-.66L12 8.4l4.73 12.44c.14.4.52.66.94.66h3.98c.5 0 .83-.52.63-.97L14.76 4.04A2.98 2.98 0 0 0 12 2.2Z"
      />
      <circle cx="12" cy="14.6" r="2.35" fill="currentColor" />
    </svg>
  );
}
