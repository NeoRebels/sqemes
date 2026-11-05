import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { en, de } from './i18nText';

/**
 * SQEM-643 — the persona preview's Info box names the persona's connector services, with their logo,
 * and marks the ones the VIEWER has not connected — for a member, who sees the editor only locked,
 * the one place to learn that before a chat says so.
 */
const preview = readFileSync('components/PersonaPreview.tsx', 'utf8');
const page = readFileSync('pages/Personas.tsx', 'utf8');

describe('SQEM-643 — the Info box', () => {
  it('owner and connectors side by side from sm up, like the playbook preview', () => {
    expect(preview).toMatch(/<dl className="text-sm text-ink grid gap-3 sm:grid-cols-2">/);
    expect(preview).toMatch(/<OwnerLine createdBy=\{persona\.createdBy\} members=\{members\} \/>/);
  });

  it('connectors only when the persona has some, each with its logo', () => {
    expect(preview).toMatch(/\{services\.length > 0 && \(/);
    expect(preview).toMatch(/<ServiceLogo serviceKey=\{s\.key\} \/>/);
  });

  it('"not connected" is per viewer, and only once their connectors are loaded', () => {
    expect(preview).toMatch(/connectors \? resolvePersonaConnectors\(services, connectors, currentUserId\)\.missing\.map\(s => s\.key\) : \[\]/);
    expect(preview).toMatch(/<Link to="\/settings" state=\{\{ initialTab: 'connectors' \}\}/);
    expect(page).toMatch(/useState<Connector\[\] \| null>\(null\)/);
    expect(page).toMatch(/connectors=\{viewerConnectors\}/);
    expect(page).toMatch(/currentUserId=\{currentUser\.id\}/);
  });

  it('the title says it is sqemes Chat only, in both languages', () => {
    expect(preview).toMatch(/title=\{m\.ppv_connectors_title_hint\(\)\}/);
    expect(en.ppv_connectors_title_hint).toMatch(/sqemes Chat only/);
    expect(de.ppv_connectors_title_hint).toMatch(/nur für sqemes Chat/);
    expect(de.ppv_connectors_title_hint).not.toMatch(/[–—]/);
  });
});
