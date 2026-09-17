// Noota brand mark (inline SVG, CSP-safe): the interlocking form in Noota blue.
//
// Traced from their own favicon (`noota.io`, a 32×32 SVG) — a single path, so this is the original
// outline verbatim rather than an approximation.
//
// Explicit colour rather than `currentColor`: the blue is the mark, the way Shopify's green and
// Nifty's teal are. (`PlaudIcon` goes the other way, because a black mark would vanish in dark mode.)
export default function NootaIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Noota">
      <path
        fill="#1F4ED8"
        d="M28.4118 17.2155V29.1232C28.4118 30.7103 27.1222 32 25.5289 32C23.6264 32 22.0833 30.4601 22.0833 28.5617V17.7548C22.0833 14.3498 19.2923 11.4619 15.8801 11.5286C12.5738 11.5925 9.91643 14.2859 9.91643 17.5991V22.4189C9.91643 23.1221 9.72424 23.8198 9.30364 24.3868C8.69084 25.2012 7.77164 25.6654 6.77445 25.6737C4.99733 25.6848 3.58789 24.1561 3.58789 22.38V17.2239C3.58789 15.6368 4.85527 14.297 6.44855 14.2998C9.64903 14.3053 12.2534 11.712 12.2534 8.52387V3.85978C12.2534 1.90575 13.7046 0.193543 15.6545 0.015651C17.8773 -0.184477 19.7519 1.56108 19.7519 3.73748V8.41825C19.7519 11.612 22.3089 14.3526 25.5094 14.2942C27.1222 14.2637 28.4118 15.6145 28.4118 17.2155Z"
      />
    </svg>
  );
}
