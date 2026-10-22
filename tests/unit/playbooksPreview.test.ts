import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { blanksIn } from '../../components/PlaybookPreview';

/**
 * SQEM-550 (b) — Playbooks as a list with a preview (redesign C). The page imports the store, so it is
 * checked at source level; the blank finder is tested directly.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const page = read('pages/Templates.tsx');
const preview = read('components/PlaybookPreview.tsx');

describe('SQEM-550 (b) — no action of the old card is lost', () => {
  // The card carried: Edit, Duplicate, Download (.sqemes.zip), Publish, Delete, favourite, tag, select.
  it.each([
    ['Edit', /to=\{`\/playbooks\/\$\{prompt\.id\}\/edit`\}/],
    ['Duplicate', /onClick=\{\(\) => onDuplicate\(prompt\)\}/],
    ['Download', /onClick=\{\(\) => onExport\(prompt\)\}/],
    ['Publish', /onClick=\{\(\) => onPublish\(prompt\)\}/],
    ['Delete', /onClick=\{\(\) => onDelete\(prompt\.id\)\}/],
    ['Favourite', /onClick=\{\(\) => onFavorite\(prompt\)\}/],
    ['Tag', /<TagEditor/],
    ['Use now', /onClick=\{\(\) => onUse\(prompt\)\}/],
  ])('the preview has %s', (_name, re) => {
    expect(preview).toMatch(re);
  });

  it('the page wires every one of them to the handler the card used', () => {
    for (const wire of ['onDuplicate={handleDuplicate}', 'onExport={handleExportSkill}', 'onPublish={openPublish}', 'onDelete={handleDeleteRequest}', 'onSetTag={handleSetTag}', 'onFavorite={toggleFavorite}']) {
      expect(page).toContain(wire);
    }
    expect(page).toMatch(/onUse=\{p => navigate\('\/chat', \{ state: \{ launchTemplateId: p\.id \} \}\)\}/);
  });

  it('selection for bulk actions stays in the list', () => {
    expect(page).toMatch(/onToggleSelect=\{toggleSelect\}/);
    expect(page).toMatch(/<BulkActionBar/);
  });

  it('Delete stays set apart from the everyday actions (SQEM-539)', () => {
    expect(preview).toMatch(/<span className="ml-auto pl-2 border-l border-line">\s*<button type="button" onClick=\{\(\) => onDelete/);
  });
});

describe('SQEM-550 (b) — the selection lives in the URL', () => {
  it('?id= selects; kind changes keep it; the fallback is the first playbook', () => {
    expect(page).toMatch(/const selectedParam = searchParams\.get\('id'\);/);
    expect(page).toMatch(/next\.set\('id', id\)/);
    expect(page).toMatch(/if \(kind === 'all'\) next\.delete\('kind'\); else next\.set\('kind', kind\);/);
    expect(page).toMatch(/filteredPrompts\.find\(p => p\.id === selectedParam\) \?\? filteredPrompts\[0\] \?\? null/);
  });

  it('below lg one view at a time: the list, or the preview with a way back', () => {
    expect(page).toMatch(/showPreviewOnMobile \? 'hidden lg:block' : ''/);
    expect(page).toMatch(/showPreviewOnMobile \? '' : 'hidden lg:block'/);
    expect(preview).toMatch(/className="lg:hidden[^"]*"[^>]*>\s*<ArrowLeft/);
  });
});

describe('SQEM-550 (b) — the row follows the SQEM-538 row pattern', () => {
  it('the title is the stretched button; checkbox and star sit above it', () => {
    expect(page).toMatch(/after:absolute after:inset-0/);
    expect(page).toMatch(/<label aria-label=\{`Select \$\{prompt\.title\}`\} className="relative z-10/);
    expect(page).toMatch(/className="hit-24 relative z-10/);
  });
});

describe('SQEM-550 (b) — blanks', () => {
  it('finds {{names}} once each, in order, trimmed', () => {
    expect(blanksIn('Hi {{customer}}, order {{ order_number }} — {{customer}} again')).toEqual(['customer', 'order_number']);
    expect(blanksIn('no blanks here')).toEqual([]);
  });
});

describe('SQEM-550 (b) follow-up — no content box in the preview', () => {
  it('the preview does not repeat the content', () => {
    expect(preview).not.toMatch(/max-h-\[28rem\] overflow-y-auto/);
    expect(preview).not.toMatch(/prompt\.content \|\| ''/);
  });
});

