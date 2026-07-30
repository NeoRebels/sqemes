// OneDrive logo (inline SVG, CSP-safe): the blue cloud mark.
export default function OneDriveIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 32" className={className} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="OneDrive">
      <path fill="#0364B8" d="M29 13.5 20.3 8 15 10.2l9.4 5.6 4.6-2.3z" />
      <path fill="#0F78D4" d="M19.5 8.2A9.3 9.3 0 0 0 11 13.7l.3-.02a7.5 7.5 0 0 1 6.7 1.1l6.9-.6a9.3 9.3 0 0 0-5.4-6z" />
      <path fill="#1490DF" d="M11.3 13.7A7.5 7.5 0 0 0 4.6 20a6.6 6.6 0 0 0 .3 1.6l14.2-1.9 5.8-4.6a7.5 7.5 0 0 0-6.7-1.1c-.4 0-.7 0-1 .02z" />
      <path fill="#28A8EA" d="M11.3 13.7A6.6 6.6 0 0 0 4.9 21.6 6.6 6.6 0 0 0 11.4 27h27.2A6 6 0 0 0 44 15.3a6 6 0 0 0-3.4-.9c.06-.4.1-.8.1-1.2a8.8 8.8 0 0 0-16-5.1 7.5 7.5 0 0 0-13.4 5.6z" opacity="0.9" />
    </svg>
  );
}
