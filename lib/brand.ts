// SQEM-308 — one answer to "is the brand filled in?", because there were three.
//
// ⛔ Before this, every place that needed the answer invented its own, and they disagreed:
//
//   pages/MarketplaceTemplate.tsx   `brandName` only        → "Adapt to brand" was offered with two
//                                                             of three required fields empty
//   components/WizardCreateStep.tsx `brandName` + `whatItDoes` → onboarding was stricter, but still
//                                                             ignored `audience`
//   (the Template Wizard would have been a third)
//
// None of them was wrong on its own; together they meant the product answered the same question
// differently depending on which screen you were standing on. **A predicate that lives in three
// places is three predicates.**
import type { BrandProfile } from '../types';

/**
 * The fields the brand form marks as required — the three non-optional ones on `BrandProfile`.
 * `useCase` and `website` are optional by design, and `tone` always has a value.
 */
const REQUIRED = ['brandName', 'whatItDoes', 'audience'] as const;

/**
 * Is there enough of a brand to generate against?
 *
 * ⚠️ **Takes the fields, not the workspace.** Onboarding asks about a form the person is still
 * typing into; the other callers ask about a profile already saved. Same question, two different
 * carriers — a signature that only accepted a saved profile would have forced onboarding to keep
 * its own copy, which is how this drifted apart the first time.
 *
 * ⛔ **This is stricter than what "Adapt to brand" used to require**, deliberately. Generating from
 * a name alone produces something that reads like the brand and knows nothing about it — worse than
 * refusing, because the person cannot see what was missing.
 */
export function brandIsComplete(brand: Partial<BrandProfile> | null | undefined): boolean {
  if (!brand) return false;
  return REQUIRED.every(field => (brand[field] ?? '').trim().length > 0);
}

/** Which required fields are still empty — so a message can name them instead of saying "incomplete". */
export function missingBrandFields(brand: Partial<BrandProfile> | null | undefined): string[] {
  const labels: Record<(typeof REQUIRED)[number], string> = {
    brandName: 'brand name',
    whatItDoes: 'what it does',
    audience: 'audience',
  };
  return REQUIRED.filter(f => !(brand?.[f] ?? '').trim()).map(f => labels[f]);
}
