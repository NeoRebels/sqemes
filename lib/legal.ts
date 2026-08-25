// SQEM-264 — which legal documents exist, which version is current, and what a given user still
// owes agreement to.
//
// **`version: null` means "not published yet"** — such a document gates nothing, links to nothing and
// produces no pending acceptance. Both documents shipped that way on 2026-08-21 so the schema could
// land without a blocking screen, and were activated on 2026-08-25 once the texts existed.
//
// ⚠️ **Both URLs point at pages that already exist**, which is what makes the activation safe: even
// mid-publication the link resolves to a real page rather than a 404. That is not luck — it is why
// the gate links to `/terms` and `/privacy` rather than to new paths.
//
// **Bumping a version here asks every user to agree again, on their next load.** That is the point of
// the field, and it is also a full-population interruption, so it belongs to a change of substance —
// not to a typo fix.
//
// **Why acceptance is checked against the session rather than collected in the sign-up form.**
// The form is not the only door: Google and GitHub sign-in skip it entirely, an invited member never
// sees it, and **every customer who registered before this shipped has never seen it at all.** A
// checkbox on the form would have covered the one path that was easiest to see. The gate runs on the
// session, so it covers all of them — and it is the same mechanism a version bump needs later, which
// is why it is not built twice.
//
// That last point is not a nicety. Amending terms by announcing them and treating silence as
// agreement does not work against consumers (BGH XI ZR 26/20 struck exactly that construction down
// for bank T&Cs), and the product owner decided on 2026-08-21 to serve consumer law rather than
// restrict the product to businesses. **Active agreement, recorded, is therefore the requirement —
// not the polite option.**

export type LegalDocumentId = 'terms' | 'privacy';

export interface LegalDocument {
  id: LegalDocumentId;
  /** What to call it in a sentence a person reads before agreeing. */
  label: string;
  /** Where it lives. Empty while unpublished — nothing should link to a page that is not there. */
  url: string;
  /**
   * The version in force. `null` = not published yet: no link, no gate, no pending acceptance.
   * Bump this when the text changes materially; that is what makes everyone agree again.
   */
  version: string | null;
}

/**
 * ⚠️ **Bump both versions to `1.1` when the rewritten texts go live.** These were promoted on
 * 2026-08-25, on the owner's explicit instruction, while the *previous* wording was still at those
 * URLs. Everyone who agreed under `1.0` agreed to that older text, and the record stays honest only
 * for as long as `1.0` keeps meaning it. New wording under the same number would make the log claim
 * people saw something they never saw.
 *
 * ⚠️ **Never publish a version without a URL that resolves.** A published document with an empty or
 * broken `url` shows every signed-in user a blocking screen whose only link goes nowhere — the one
 * failure mode of this feature that hits the entire population at once.
 * `tests/unit/legal.test.ts` pins that invariant.
 */
export const LEGAL_DOCUMENTS: LegalDocument[] = [
  { id: 'terms',   label: 'Terms and Conditions', url: 'https://sqemes.com/terms',   version: '1.0' },
  { id: 'privacy', label: 'Privacy Policy',       url: 'https://sqemes.com/privacy', version: '1.0' },
];

/** A row from `legal_acceptances` — only the two columns that decide anything. */
export interface AcceptanceRecord {
  document: string;
  version: string;
}

/** The documents that are actually live, in the order they should be presented. */
export function publishedDocuments(docs: LegalDocument[] = LEGAL_DOCUMENTS): LegalDocument[] {
  return docs.filter((d): d is LegalDocument & { version: string } => !!d.version);
}

/**
 * Which published documents this person has not yet agreed to **in their current version**.
 *
 * Agreeing to v1 does not carry over to v2 — that is the whole point of versioning, and reading it
 * the other way would make a bump silently do nothing.
 */
export function pendingAcceptances(
  accepted: AcceptanceRecord[],
  docs: LegalDocument[] = LEGAL_DOCUMENTS,
): LegalDocument[] {
  return publishedDocuments(docs).filter(
    doc => !accepted.some(a => a.document === doc.id && a.version === doc.version),
  );
}

/** Whether anything blocks this person right now. Nothing published → never blocks. */
export function needsAcceptance(
  accepted: AcceptanceRecord[],
  docs: LegalDocument[] = LEGAL_DOCUMENTS,
): boolean {
  return pendingAcceptances(accepted, docs).length > 0;
}

/** The rows to insert when someone agrees. Shaped for a single `insert`, deduplicated by the table. */
export function acceptanceRows(
  userId: string,
  docs: LegalDocument[],
): { user_id: string; document: LegalDocumentId; version: string }[] {
  return publishedDocuments(docs).map(doc => ({
    user_id: userId,
    document: doc.id,
    version: doc.version as string,
  }));
}
