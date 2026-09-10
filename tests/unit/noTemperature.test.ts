import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-367 — nothing sends a `temperature`, and this is what keeps it that way.
 *
 * ⛔ The decision was made once and applied to half the product. SQEM-125 removed temperature from
 * chat, with the reason in the code — GPT-5 and the o-series **reject** a non-default value — and
 * the authoring paths kept sending one for another month. Fifteen hard-coded values across nine
 * files, none of them settable by a user: the app has never had a temperature control anywhere.
 *
 * ⭐ Removing the field from `AuthoringAIParams` is the real guard, because a caller cannot pass
 * what the interface does not declare. This test covers the two ways around that: a `fetch` built by
 * hand (Chat's enhance and the editor test panel both do this) and a future re-added field.
 *
 * ⚠️ Comments are stripped first — several files explain at length *why* temperature is gone, and
 * that prose would otherwise satisfy or break the assertions instead of the code doing so. Two
 * details that both cost a false failure before they were right:
 *   - **Line comments before block comments.** A `//` line containing `/*` (there is one in
 *     `TemplateEditor.tsx`) otherwise opens a fake block and swallows hundreds of lines.
 *   - **Trailing comments count too** — `const body = { … };  // no temperature` is a comment on a
 *     code line, and the `^//` form misses it. The `[^:]` guard is what keeps `https://` intact.
 */
const root = (p: string) => resolve(__dirname, '../../', p);

function code(src: string): string {
  return src
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every source file that could plausibly build a model request. */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(root(dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
  };
  for (const d of ['pages', 'components', 'lib', 'store', 'hooks', 'supabase/functions']) walk(d);
  out.push('types.ts');
  return out;
}

describe('SQEM-367 — no temperature reaches a provider', () => {
  it('no source file sets a temperature value', () => {
    // Matches `temperature: 0.7`, `temperature = 1`, `temperature,` in an object literal — the
    // three shapes the fifteen call sites actually used.
    const offenders = sources().filter((f) =>
      /\btemperature\s*[:=]\s*[0-9.]/.test(code(readFileSync(root(f), 'utf8'))),
    );
    expect(offenders, `temperature set in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the authoring interface does not offer one', () => {
    // The guard that makes the rest unnecessary: a caller cannot pass what is not declared.
    const src = code(readFileSync(root('lib/authoringAI.ts'), 'utf8'));
    expect(src).not.toMatch(/temperature/);
  });

  it('neither edge function forwards one to a provider', () => {
    // Both build their request bodies by hand, so this is where a value would actually leave.
    for (const f of ['supabase/functions/execute-step/index.ts', 'supabase/functions/chat-message/index.ts']) {
      expect(code(readFileSync(root(f), 'utf8')), `${f} still mentions temperature in code`)
        .not.toMatch(/temperature/);
    }
  });

  it('the OpenAI exception went with the field it protected', () => {
    // `supportsTemperature` existed only because GPT-5 and the o-series reject a non-default value.
    // An exception guarding a knob nobody can turn is a thing to delete, not to maintain — and if it
    // reappears, the field it guards has reappeared too.
    const src = code(readFileSync(root('supabase/functions/execute-step/index.ts'), 'utf8'));
    expect(src).not.toMatch(/supportsTemperature/);
  });
});

describe('SQEM-367 — the stored rows are cleaned too', () => {
  const MIGRATION = 'supabase/migrations/20260910140000_sqem367_drop_step_temperature.sql';

  it('an additive migration strips it from both tables that hold `steps`', () => {
    // ⛔ Written as a new migration rather than by editing the March seed file: that one has been on
    // production since March, and `AGENTS.md` in the source repository permits editing a migration
    // only when it has NOT reached production. Editing it would also have cleaned nothing that
    // already exists — only what a fresh install seeds.
    const sql = readFileSync(root(MIGRATION), 'utf8');
    expect(sql).toMatch(/update public\.prompts/);
    expect(sql).toMatch(/update public\.library_templates/);
    expect(sql).toMatch(/- 'temperature'/);
  });

  it('it verifies its own work while applying', () => {
    // The SQEM-335/351/352 pattern: a migration that runs but does not do what it claims should be
    // a failed deploy, not a quiet one.
    const sql = readFileSync(root(MIGRATION), 'utf8');
    expect(sql).toMatch(/raise exception/);
  });

  it('the March seed migration is left untouched', () => {
    // Its ~90 values stay in the file on purpose — the history describes what ran. The cleanup above
    // is what makes them absent from every database, including a fresh one.
    const seed = readFileSync(root('supabase/migrations/20260313000003_seed_library_templates.sql'), 'utf8');
    expect(seed).toMatch(/"temperature"/);
  });
});
