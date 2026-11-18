import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { offersImprovement, learningCounts } from '../../supabase/functions/_shared/learningLoop';

// SQEM-704 — the learning loop (SQEM-623) counted: an offer to change a loaded playbook or persona, and changes made.
describe('offersImprovement', () => {
  it('reads the offers the eval saw, German and English', () => {
    expect(offersImprovement('… fertig.\n\nSoll ich das Playbook „Release Notes“ um den Abschnitt „Bekannte Probleme“ ergänzen?')).toBe(true);
    expect(offersImprovement('Soll ich die Vorlage entsprechend anpassen oder ein neues Playbook anlegen?')).toBe(true);
    expect(offersImprovement('Should I update the playbook so it always uses "du"?')).toBe(true);
  });
  it('a plain answer is not an offer', () => {
    expect(offersImprovement('Hier sind die Release Notes für Version 2.3. Sag Bescheid, wenn du etwas ändern willst.')).toBe(false);
  });
  it('only the end of the answer counts: a quoted playbook rule in the body is no offer', () => {
    const body = 'Das Playbook sagt: Release Notes ergänzen wir immer um eine Zusammenfassung. ' + 'x'.repeat(700);
    expect(offersImprovement(body)).toBe(false);
  });
});

describe('learningCounts', () => {
  const offer = 'Soll ich das Playbook anpassen?';
  it('an offer counts only when a playbook or persona was loaded', () => {
    expect(learningCounts(offer, true, []).improvementOffered).toBe(1);
    expect(learningCounts(offer, false, []).improvementOffered).toBe(0);
  });
  it('counts changed playbooks and personas, not created ones or files', () => {
    const changes = [
      { action: 'updated', kind: 'skill' }, { action: 'updated', kind: 'persona' },
      { action: 'created', kind: 'prompt' }, { action: 'updated', kind: 'file' },
    ];
    expect(learningCounts('ok', true, changes).libraryUpdates).toBe(2);
  });
});

describe('wiring', () => {
  it('the chat logs both counts on [chat-tools], numbers only', () => {
    const src = readFileSync('supabase/functions/chat-message/index.ts', 'utf8');
    expect(src).toMatch(/\.\.\.learningCounts\(result, loadedTemplateIds\.length > 0 \|\| \(tools\.stats\.byTool\.get_persona \?\? 0\) > 0, libraryChanges\)/);
  });
  it('the eval judges offers with the same pattern', () => {
    expect(readFileSync('scripts/prompt-eval/run.mjs', 'utf8')).toContain('const offered = OFFER_PATTERN.test(text);');
  });
});
