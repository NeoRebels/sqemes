// Google Docs logo (inline SVG, CSP-safe): blue document, folded corner, white text lines.
export default function GoogleDocsIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Google Docs">
      <path fill="#4285F4" d="M30 4H12a2 2 0 0 0-2 2v36a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V12z" />
      <path fill="#A1C2FA" d="M30 4l8 8h-8z" />
      <g fill="#fff">
        <rect x="16" y="21" width="16" height="2" rx="1" />
        <rect x="16" y="26" width="16" height="2" rx="1" />
        <rect x="16" y="31" width="11" height="2" rx="1" />
      </g>
    </svg>
  );
}
