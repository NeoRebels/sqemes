// Google Sheets logo (inline SVG, CSP-safe): green document, folded corner, white grid.
export default function GoogleSheetsIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Google Sheets">
      <path fill="#0F9D58" d="M30 4H12a2 2 0 0 0-2 2v36a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V12z" />
      <path fill="#87CEAC" d="M30 4l8 8h-8z" />
      <path fill="#fff" d="M16 21h16v13H16z" />
      <g fill="#0F9D58">
        <rect x="17" y="24" width="14" height="1.4" />
        <rect x="17" y="28" width="14" height="1.4" />
        <rect x="23.3" y="22" width="1.4" height="11" />
      </g>
    </svg>
  );
}
