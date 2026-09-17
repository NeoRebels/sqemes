// Nifty brand mark (inline SVG, CSP-safe): the teal swoosh.
//
// Traced from their own asset (`niftypm.com/images/brand-logos/nifty-mark.svg`, supplied by the
// owner). ⚠️ The original layers three gradients and two masks over the SAME path to give it depth;
// at 24 px none of that is visible, so this is the one shape in the brand teal. A faithful
// simplification, not a different mark — the outline is the original's, verbatim.
//
// Explicit colour rather than `currentColor`: the teal *is* the mark, the way Shopify's green is.
// (`PlaudIcon` goes the other way for the opposite reason — a black mark would vanish in dark mode.)
export default function NiftyIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 132 132" className={className} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Nifty">
      <path
        fill="#01BAAB"
        d="M127.288 41.395c11.875 29.749.68 63.73-26.554 80.593-27.233 16.864-62.643 11.742-83.981-12.147l-2.022 2.022a10.363 10.363 0 0 1-13.73.779c.308-.243.601-.503.88-.779l28.54-28.5.628-.627a9.898 9.898 0 0 1 13.436 0l.546.556 12.937 12.935c.074.068.153.13.227.198a10.434 10.434 0 0 0 14.346-.303l54.747-54.727ZM31.605 9.683c24.766-15.13 56.509-12.314 78.223 6.942l.9-.9a10.363 10.363 0 0 1 13.82-.708c-.356.277-.694.578-1.01.9L71.974 67.479a9.898 9.898 0 0 1-13.548 0L45.415 54.467c-.121-.131-.212-.283-.333-.404-4.07-4.014-10.61-4.014-14.68 0-.132.121-.213.273-.334.404L2.083 82.453c-7.224-28.11 4.757-57.639 29.522-72.77Z"
      />
    </svg>
  );
}
