import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * SQEM-550 (d) — the persona editor as a flow (redesign C): each route reads "If {condition}" →
 * "Load {playbook}". Same fields and the same ordering as before; nothing executes the condition
 * (see `PersonaRoute` in types.ts — it is prose for a model, not a rule).
 */
const src = readFileSync(join(resolve(__dirname, '../..'), 'pages/PersonaEditor.tsx'), 'utf8');

describe('SQEM-550 (d) — the persona as a flow', () => {
  const flow = src.slice(src.indexOf('SQEM-550 (d) — redesign C: each route reads as a step of a flow'));

  it('each route: an "If" box with the condition, a connector, a "Load" box with the playbook', () => {
    expect(flow).toMatch(/htmlFor=\{`persona-route-condition-\$\{route\.templateId\}`\}[^>]*>\s*If\s*<\/label>/);
    expect(flow).toMatch(/id=\{`persona-route-condition-\$\{route\.templateId\}`\}\s+value=\{route\.condition\}/);
    expect(flow).toMatch(/<div aria-hidden className="ml-6 h-3 border-l-2 border-accent" \/>/);
    expect(flow).toMatch(/>Load<\/span>/);
    expect(flow.indexOf('>If')).toBeLessThan(flow.indexOf('>Load<'));
  });

  it('⛔ ordering, removal, Write and the fallback note all survived', () => {
    expect(flow).toMatch(/draggable=\{canEdit\}/);
    expect(flow).toMatch(/onMove=\{to => moveRoute\(i, to\)\}/);
    expect(flow).toMatch(/onClick=\{\(\) => removeRoute\(route\.templateId\)\}/);
    expect(flow).toMatch(/onClick=\{\(\) => handleGenerateCondition\(route\)\}/);
    expect(flow).toMatch(/Using the playbook&apos;s own description/);
    expect(flow).toMatch(/restrictedRouteIds\.has\(route\.templateId\)/);
  });

  it('a dashed "Add a condition" row opens the same picker as "Attach playbook"', () => {
    expect(flow).toMatch(/onClick=\{\(\) => \{ setPickSearch\(''\); setPicking\(true\); \}\}[\s\S]{0,300}Add a condition/);
  });

  it('the name heads the page in the display face (moved, not copied)', () => {
    expect(src.match(/id="persona-editor-name"/g)).toHaveLength(1);
    expect(src).toMatch(/<label htmlFor="persona-editor-name" className="sr-only">Name<\/label>/);
    expect(src).toMatch(/<input id="persona-editor-name"[\s\S]{0,300}font-display/);
  });
});
