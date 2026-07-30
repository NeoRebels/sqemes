// Outlook / Microsoft 365 Calendar (inline SVG, CSP-safe): white card, Outlook-blue header + date grid.
export default function OutlookCalendarIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Outlook Calendar">
      <rect x="8" y="11" width="32" height="29" rx="2.5" fill="#fff" stroke="#E1E3E6" strokeWidth="1.2" />
      <path fill="#0F6CBD" d="M8 15.5A2.5 2.5 0 0 1 10.5 13h27a2.5 2.5 0 0 1 2.5 2.5V20H8z" />
      <g fill="#0F6CBD">
        <rect x="13" y="24" width="5" height="4" rx="1" />
        <rect x="21.5" y="24" width="5" height="4" rx="1" />
        <rect x="30" y="24" width="5" height="4" rx="1" />
        <rect x="13" y="31" width="5" height="4" rx="1" />
        <rect x="21.5" y="31" width="5" height="4" rx="1" />
        <rect x="30" y="31" width="5" height="4" rx="1" opacity="0.5" />
      </g>
    </svg>
  );
}
