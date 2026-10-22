import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * SQEM-554 (b) — the Personas archive as list + preview (the Playbooks page's split, SQEM-550 b).
 * ⛔ The point of this file: every action the old persona CARD carried still exists, in the row or
 * the preview. Losing one in a redesign is the failure this split is most likely to cause.
 */
const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const page = read('pages/Personas.tsx');
const preview = read('components/PersonaPreview.tsx');

describe('SQEM-554 (b) — layout', () => {
  it('list on the left, preview on the right; selection in ?id=; one at a time below lg', () => {
    expect(page).toMatch(/<ul aria-label="Personas" className=\{`rounded-card border border-line bg-surface-raised p-2 space-y-0\.5 \$\{showPreviewOnMobile \? 'hidden lg:block' : ''\}`\}>/);
    expect(page).toMatch(/lg:grid lg:grid-cols-\[22rem_minmax\(0,1fr\)\]/);
    expect(page).toMatch(/next\.set\('id', id\)/);
    expect(page).toMatch(/const selectedPersona = visible\.find\(p => p\.id === selectedParam\) \?\? visible\[0\] \?\? null;/);
    expect(preview).toMatch(/onClick=\{onBack\} className="lg:hidden[^"]*"[\s\S]{0,80}All personas/);
    expect(page).not.toMatch(/TemplateCard|RouteChips/);
  });
});

describe('SQEM-554 (b) — ⛔ every former card action survived', () => {
  const actions: [string, RegExp, string][] = [
    ['select (bulk)', /<label aria-label=\{`Select \$\{persona\.title\}`\}[\s\S]{0,200}onChange=\{\(\) => onToggleSelect\(persona\.id\)\}/, page],
    ['favourite on the row', /onClick=\{\(\) => onFavorite\(persona\)\}/, page],
    ['favourite in the preview', /onClick=\{\(\) => onFavorite\(persona\)\}/, preview],
    ['tag add/remove', /onAdd=\{tag => onSetTag\(persona, tag\)\}\s*onRemove=\{\(\) => onSetTag\(persona, null\)\}/, preview],
    ['open in Chat ("Use now")', /to=\{`\/personas\/\$\{persona\.id\}`\}[^>]*>\s*<Play className="w-4 h-4" \/> Use now/, preview],
    ['edit', /to=\{`\/personas\/\$\{persona\.id\}\/edit`\}[^>]*>\s*<Edit className="w-4 h-4" \/> Edit/, preview],
    ['duplicate', /onClick=\{\(\) => onDuplicate\(persona\)\}/, preview],
    ['download with its playbooks', /onClick=\{\(\) => onExport\(persona\)\}[^>]*title="Download persona with its playbooks \(\.sqemes\.zip\)"/, preview],
    ['delete, set apart', /<span className="ml-auto pl-2 border-l border-line">\s*<button type="button" onClick=\{\(\) => onDelete\(persona\)\}/, preview],
    ['access badge', /<AccessBadge mode=\{accessMode\} \/>/, preview],
  ];
  for (const [name, re, src] of actions) {
    it(name, () => expect(src).toMatch(re));
  }
  it('the page wires each preview action to the handler the card used', () => {
    expect(page).toMatch(/onDuplicate=\{p => void handleDuplicate\(p\)\}/);
    expect(page).toMatch(/onExport=\{p => void handleExport\(\[p\]\)\}/);
    expect(page).toMatch(/onDelete=\{p => setPendingDelete\(\[p\]\)\}/);
  });
  it('edit-only actions stay behind canEdit', () => {
    expect(preview).toMatch(/\{canEdit && \(\s*<Link to=\{`\/personas\/\$\{persona\.id\}\/edit`\}/);
    expect(preview).toMatch(/\{canEdit && \(\s*<div className="mt-4 pt-4 border-t border-line/);
  });
});

describe('SQEM-554 (b) — what the preview adds', () => {
  it('ALL routes in their order, each with its "If" condition; links only to playbooks the viewer can open', () => {
    expect(preview).toMatch(/\[\.\.\.persona\.routes\]\.sort\(\(a, b\) => a\.sortOrder - b\.sortOrder\)/);
    expect(preview).toMatch(/visiblePlaybookIds\.has\(r\.templateId\)\s*\? <Link to=\{`\/playbooks\?id=\$\{encodeURIComponent\(r\.templateId\)\}`\}/);
    expect(preview).toMatch(/>If<\/span>\{r\.condition\}/);
    expect(preview).toMatch(/No playbooks yet — this persona loads nothing\./);
  });
  it('no role text in the preview', () => {
    expect(preview).not.toMatch(/persona\.content/);
  });
});
