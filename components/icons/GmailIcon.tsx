// Official Gmail logo (inline SVG so it's CSP-safe — no external asset). viewBox is landscape (52×40);
// default preserveAspectRatio letterboxes it within a square slot without distortion.
export default function GmailIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 52 40" className={className} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Gmail">
      <path d="M3.6 40h8.2V20.2L0 11v25.4C0 38.4 1.6 40 3.6 40z" fill="#4285F4" />
      <path d="M40.2 40h8.2c2 0 3.6-1.6 3.6-3.6V11l-11.8 9.2V40z" fill="#34A853" />
      <path d="M40.2 3.6v16.6L52 11V5.5c0-5.1-5.8-8-9.8-4.9L40.2 3.6z" fill="#FBBC04" />
      <path d="M11.8 20.2V3.6L26 14.3 40.2 3.6v16.6L26 30.9 11.8 20.2z" fill="#EA4335" />
      <path d="M0 5.5V11l11.8 9.2V3.6L9.8.6C5.8-2.5 0 .4 0 5.5z" fill="#C5221F" />
    </svg>
  );
}
