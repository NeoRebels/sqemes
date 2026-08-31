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
 * **`terms` is at `1.2` since 2026-08-30; `privacy` stays at `1.1`.** They version independently, and
 * this is the first time that mattered: § 16 of the Terms still described Sqemes as open source under
 * AGPL-3.0, three days after the licence moved to the Sustainable Use License (SQEM-281/290). That is
 * a change to what a customer is promised, so it re-gates. The privacy policy did not change, so
 * asking those same people to re-accept it would train them to click past the screen — which is the
 * one outcome that makes this mechanism worthless.
 *
 * **`1.1` since 2026-08-27 — the rewritten texts are live, verified before bumping.**
 *
 * `1.0` shipped on 2026-08-25 while the *previous* wording was still at those URLs, so everyone who
 * agreed under `1.0` agreed to that older text. The record stays honest only for as long as each
 * number keeps meaning exactly one wording — which is why this was bumped the moment the new text
 * went live, and not before.
 *
 * ⚠️ **Bumping is not free: it shows the gate to every signed-in user again.** So check that the new
 * wording is actually at the URL first — `curl` the page and look for a phrase only the new version
 * contains. Done on 2026-08-27: the published privacy policy now covers the website and the product
 * on one page and no longer calls Sqemes open source. A bump ahead of publication would ask people
 * to agree to a version they cannot read.
 *
 * ⚠️ **One page, two scopes — and only one of them versions.** The published privacy policy is split
 * into *Part 1 (the website)* and *Part 2 (the product)*. **Only changes to Part 2 and the shared
 * sections belong in a version bump.** A cookie-banner tweak on the marketing site must not drag
 * every customer back through an acceptance screen; that would train people to click past it, which
 * is the one outcome that makes the whole mechanism worthless.
 *
 * ⚠️ **Never publish a version without a URL that resolves.** A published document with an empty or
 * broken `url` shows every signed-in user a blocking screen whose only link goes nowhere — the one
 * failure mode of this feature that hits the entire population at once.
 * `tests/unit/legal.test.ts` pins that invariant.
 */
export const LEGAL_DOCUMENTS: LegalDocument[] = [
  { id: 'terms',   label: 'Terms and Conditions', url: 'https://sqemes.com/terms',   version: '1.2' },
  { id: 'privacy', label: 'Privacy Policy',       url: 'https://sqemes.com/privacy', version: '1.1' },
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
 * Does the acceptance gate apply at all? Exported and pure so the rule can be pinned by a test —
 * it is what just went wrong (SQEM-284).
 *
 * Two reasons it may not, and they differ in kind:
 *
 *   * **Self-host** — not our contract to enforce. The operator of that instance is the controller,
 *     and our documents say in their own first paragraph that they do not cover self-hosted
 *     installations. A *permanent* exemption.
 *   * **Nothing published** — a `null` version means the wording is not live, so there is nothing
 *     anyone could read before agreeing. A *temporary* one, and it stopped applying the moment
 *     SQEM-264 set the first version.
 *
 * ⚠️ The second condition quietly stopped firing when that first version shipped, and the self-host
 * case had been riding on it without anyone having said so. **A guard that only holds while some
 * other value happens to be null is not a guard.** That is how self-hosters ended up being asked to
 * accept Cloud terms in v1.10.11 through v1.11.0.
 */
export function gateApplies(
  { selfHosted, docs }: { selfHosted: boolean; docs: LegalDocument[] },
): boolean {
  if (selfHosted) return false;
  return publishedDocuments(docs).length > 0;
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
