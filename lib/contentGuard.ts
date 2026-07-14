import type { Workspace } from '../types';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const IBAN_RE  = /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}[A-Z0-9]{0,16}\b/;
// Requires 7+ digits; allows leading +/00, spaces, dashes, parens
const PHONE_RE = /(?:(?:\+|00)\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)(?:\d[\s-]?){5,10}\d/;

export function checkContentViolation(text: string, workspace: Workspace): string | null {
  for (const term of workspace.blacklistedTerms) {
    if (text.toLowerCase().includes(term.toLowerCase())) {
      return `Your message contains a restricted term: "${term}"`;
    }
  }

  if (workspace.blockEmails && EMAIL_RE.test(text)) {
    return 'Email addresses are not allowed in submissions';
  }

  if (workspace.blockIban && IBAN_RE.test(text)) {
    return 'IBAN numbers are not allowed in submissions';
  }

  if (workspace.blockPhone && PHONE_RE.test(text)) {
    return 'Telephone numbers are not allowed in submissions';
  }

  return null;
}
