// Microsoft Outlook logo (inline SVG so it's CSP-safe). Left blue tile with the white "O", right
// envelope panel — the recognisable Outlook mark. Default preserveAspectRatio keeps it undistorted.
export default function OutlookIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Outlook">
      <path fill="#0A2767" d="M30 7H16v18h13.5a1.5 1.5 0 0 0 1.5-1.5V8.5A1.5 1.5 0 0 0 29.5 7H30z" />
      <path fill="#28A8EA" d="M31 8.6 17.6 17 16 15.9V7h13.5c.8 0 1.5.6 1.5 1.6z" />
      <path fill="#0078D4" d="M31 10.3v13.2c0 .8-.7 1.5-1.5 1.5H16V15.9l1.6 1.1L31 10.3z" />
      <rect x="1" y="6" width="15.5" height="20" rx="1.6" fill="#0364B8" />
      <path fill="#fff" d="M8.7 11c-2.7 0-4.7 2.2-4.7 5s2 5 4.7 5 4.7-2.2 4.7-5-2-5-4.7-5zm0 2.3c1.4 0 2.4 1.2 2.4 2.7s-1 2.7-2.4 2.7-2.4-1.2-2.4-2.7 1-2.7 2.4-2.7z" />
    </svg>
  );
}
