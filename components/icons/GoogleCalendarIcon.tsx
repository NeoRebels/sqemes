// Google Calendar logo (inline SVG, CSP-safe): white card, blue header, "31".
export default function GoogleCalendarIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Google Calendar">
      <rect x="9" y="11" width="30" height="29" rx="2.5" fill="#fff" stroke="#E1E3E6" strokeWidth="1.2" />
      <path fill="#4285F4" d="M9 15.5A2.5 2.5 0 0 1 11.5 13h25a2.5 2.5 0 0 1 2.5 2.5V19H9z" />
      <text x="24" y="34.5" fontFamily="Arial, Helvetica, sans-serif" fontSize="13.5" fontWeight="700" fill="#4285F4" textAnchor="middle">31</text>
    </svg>
  );
}
