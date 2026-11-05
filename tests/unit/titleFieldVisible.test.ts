import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { en, de } from './i18nText';

// SQEM-633 — a customer took the persona name placeholder ("Vertrieb") for a name already given and
// could not find the field. Both editors' titles now look like a field while empty or focused, and a
// save without one leads into it.
const UNDERLINE = 'border-b-2 border-dashed border-transparent placeholder-shown:border-line-strong focus:border-line-strong aria-[invalid=true]:border-danger';

describe('SQEM-633 — the title field is recognisable as one', () => {
  it('the persona placeholder names the field instead of looking like a name', () => {
    expect(de.pe_name_placeholder).toBe('Name der Persona');
    expect(en.pe_name_placeholder).toBe('Persona name');
  });

  it.each([
    ['pages/PersonaEditor.tsx', 'persona-editor-name', 'nameRef', 'nameMissing', "setMobileTab('role')"],
    ['pages/TemplateEditor.tsx', 'template-editor-title', 'titleRef', 'titleMissing', "setMobileTab('editor')"],
  ])('%s: underline, and a save without a title focuses the field', (file, id, ref, flag, tab) => {
    const src = readFileSync(file, 'utf8');
    const input = src.slice(src.indexOf(`<input id="${id}"`), src.indexOf('/>', src.indexOf(`<input id="${id}"`)));
    expect(input).toContain(UNDERLINE);
    expect(input).toContain(`ref={${ref}}`);
    expect(input).toContain(`aria-invalid={${flag} || undefined}`);
    const save = src.slice(src.indexOf('const handleSave = async'), src.indexOf('const handleSave = async') + 400);
    expect(save).toContain(`set${flag[0].toUpperCase()}${flag.slice(1)}(true)`);
    expect(save).toContain(tab); // the field sits on that phone tab; focus would miss it elsewhere
    expect(save).toContain(`${ref}.current?.focus()`);
  });
});
