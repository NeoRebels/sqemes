// SQEM-111 — constant-time string comparison for secrets/signatures, so a match doesn't
// leak position via early-exit timing (mirrors Stripe's own signature-compare behaviour).
// The length check leaks length only; acceptable for fixed-length hex signatures / shared secrets.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
