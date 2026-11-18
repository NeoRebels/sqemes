/**
 * SQEM-704 — the learning loop (SQEM-623) made countable. Pure (no imports): the chat logs two numbers per
 * answer, the ops monitor sums them, and the prompt eval judges its correction cases with the same pattern.
 *
 * An OFFER is a sentence that names a playbook, persona or template next to a change verb, or "Soll ich es …
 * anpassen" right after the playbook was named. It is an approximation of what the model writes, measured
 * against the eval's answers (SQEM-623, SQEM-683), German and English.
 */
export const OFFER_PATTERN = /(playbook|vorlage|persona|template)[^.?!\n]{0,160}(anpass|aktualis|ergänz|erweiter|aufnehm|übernehm|hinzufüg|speicher|update|adjust|extend|add )|(anpass|aktualis|ergänz|erweiter|aufnehm|übernehm|hinzufüg|speicher|update|adjust|extend)[^.?!\n]{0,160}(playbook|vorlage|persona|template)|soll ich (es|sie|das)[^.?!\n]{0,80}(anpass|aktualis|ergänz|umstell|überarbeit)|soll ich [^?\n]{0,60}(aktualis|anpass)|(shall|should) i [^?\n]{0,80}(update|adjust|extend)/i;

/** Does this answer offer to change a playbook or persona? Only the last 600 characters are read: the offer ends the answer. */
export function offersImprovement(answer: string): boolean {
  return OFFER_PATTERN.test(answer.slice(-600));
}

export interface LearningCounts { improvementOffered: 0 | 1; libraryUpdates: number }

/**
 * What one chat answer adds to the loop's counts. An offer only counts when the answer loaded a playbook or a
 * persona (the hint rides on those). `libraryUpdates` counts every playbook or persona the answer changed: the
 * chat does not know what earlier answers loaded, so a change asked for without an offer counts too.
 */
export function learningCounts(answer: string, loaded: boolean, changes: ReadonlyArray<{ action: string; kind: string }>): LearningCounts {
  return {
    improvementOffered: loaded && offersImprovement(answer) ? 1 : 0,
    libraryUpdates: changes.filter(c => c.action === 'updated' && (c.kind === 'prompt' || c.kind === 'skill' || c.kind === 'persona')).length,
  };
}
