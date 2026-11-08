import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { connectorOptions, matchesConnector, NO_CONNECTOR } from '../../lib/listFilters';
import { en, de } from './i18nText';

/** SQEM-664 — the Personas connector filter, and access/editing as icons on both lists. */

const read = (p: string) => readFileSync(p, 'utf8');

describe('connectorOptions / matchesConnector', () => {
  const p = (...keys: string[]) => ({ connectors: keys.map(k => ({ key: k, name: k.toUpperCase() })) });
  it('every named service once, sorted by name, then "No connector" when some persona has none', () => {
    expect(connectorOptions([p('weclapp'), p('notion', 'weclapp'), p()], 'No connector')).toEqual([
      { value: 'notion', label: 'NOTION' }, { value: 'weclapp', label: 'WECLAPP' }, { value: NO_CONNECTOR, label: 'No connector' },
    ]);
  });
  it('⛔ nobody names a service → no options, so the page shows no filter', () => {
    expect(connectorOptions([p(), p()], 'No connector')).toEqual([]);
  });
  it('no "No connector" when every persona names one', () => {
    expect(connectorOptions([p('a'), p('b')], 'x').map(o => o.value)).toEqual(['a', 'b']);
  });
  it('filters by service, by none, and passes everything without a filter', () => {
    expect(matchesConnector([{ key: 'a' }], 'a')).toBe(true);
    expect(matchesConnector([{ key: 'a' }], 'b')).toBe(false);
    expect(matchesConnector([], NO_CONNECTOR)).toBe(true);
    expect(matchesConnector([{ key: 'a' }], NO_CONNECTOR)).toBe(false);
    expect(matchesConnector(null, null)).toBe(true);
  });
});

describe('the icons', () => {
  const ICONS = read('components/ui/RightsIcons.tsx');
  it('Lock for restricted, UserLock for "only me", UserPen for editing — each with a name and a tooltip', () => {
    expect(ICONS).toMatch(/export const ACCESS_ICON: Record<AccessBadgeMode, LucideIcon> = \{ private: UserLock, restricted: Lock \};/);
    expect(ICONS).toMatch(/export const EDIT_ICON: LucideIcon = UserPen;/);
    expect(ICONS).toMatch(/role="img" aria-label=\{ACCESS_BADGE_TITLE\[access\]\} title=\{ACCESS_BADGE_TITLE\[access\]\}/);
    expect(ICONS).toMatch(/role="img" aria-label=\{m\.edit_badge_restricted_title\(\)\} title=\{m\.edit_badge_restricted_title\(\)\}/);
    // ⛔ No hand-made glyph: the first build put a "1" pill on the lock (Impeccable: one icon family).
    expect(ICONS).not.toMatch(/>1<\/span>/);
  });
  it('⛔ one glyph per state everywhere: preview badge, editor options, read-only banner, route chip', () => {
    expect(read('components/ui/AccessBadge.tsx')).toMatch(/const Icon = ACCESS_ICON\[mode\]/);
    const control = read('components/TemplateAccessControl.tsx');
    expect(control).toMatch(/<ACCESS_ICON\.private className/);
    expect(control).toMatch(/\{isEdit \? <EDIT_ICON className="w-4 h-4 shrink-0" \/> : <ACCESS_ICON\.restricted className="w-4 h-4 shrink-0" \/>\}/);
    expect(control).not.toMatch(/UserRound|<Lock /);
    for (const editor of ['pages/TemplateEditor.tsx', 'pages/PersonaEditor.tsx']) {
      expect(read(editor), editor).toMatch(/<EDIT_ICON className="w-4 h-4 shrink-0 mt-0\.5 text-amber-600 dark:text-amber-400" \/>/);
      expect(read(editor), editor).not.toMatch(/<Lock /);
    }
    expect(read('pages/PersonaEditor.tsx')).toMatch(/const Icon = ACCESS_ICON\[mode\];/);
  });
  it('the preview names only who; the pen says it is about editing', () => {
    expect(en.edit_badge_restricted).toBe('Selected people');
    expect(de.edit_badge_restricted).toBe('Ausgewählte Personen');
  });
  it('⛔ neutral, never meaning by colour: no accent or state colour in the row icons', () => {
    const row = ICONS.slice(ICONS.indexOf('export default function RightsIcons'), ICONS.indexOf('export function EditBadge'));
    expect(row).toMatch(/text-ink-subtle/);
    expect(row).not.toMatch(/text-accent|text-red|text-amber|text-success|text-warning/);
  });
  it('both lists show the icons instead of the word, and the previews spell editing out', () => {
    for (const page of ['pages/Templates.tsx', 'pages/Personas.tsx']) {
      const src = read(page);
      expect(src).toMatch(/<RightsIcons access=\{accessMode\} editRestricted=\{editRestricted\} \/>/);
      expect(src).not.toMatch(/<AccessBadge mode=\{accessMode\} \/>/);
      expect(src).toMatch(/if \(!workspace\?\.id \|\| IS_SELF_HOSTED\) return;\s+void fetchEditRestrictedIds\(/);
      expect(src).toMatch(/onDone=\{loadEditRestricted\}/);
    }
    for (const preview of ['components/PlaybookPreview.tsx', 'components/PersonaPreview.tsx']) {
      expect(read(preview)).toMatch(/<EditBadge restricted=\{editRestricted\} \/>/);
    }
  });
  it('one query per list for the editing rules', () => {
    expect(read('lib/api/editors.ts')).toMatch(/export async function fetchEditRestrictedIds\(kind: EditorKind, workspaceId: string\): Promise<Set<string>> \{\s+const \{ data, error \} = await client\.from\(TABLE\[kind\]\)\.select\(KEY\[kind\]\)\.eq\('workspace_id', workspaceId\);/);
  });
});
