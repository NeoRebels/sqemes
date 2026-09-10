import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// ⛔ From the PURE module, never from `lib/templateContext`: that one reaches `lib/supabase`,
// which throws at import time without env vars — green locally, red in CI.
import { composeSystemInstruction } from '../../lib/systemInstruction';

/**
 * SQEM-371 — applied context belongs to the session.
 *
 * Two silent defects were found while building this, and the assertions below are aimed at them
 * rather than at the feature that was asked for:
 *
 *   1. `chat_sessions.assistant_id` was **write-only** — set on create, never read. A reload
 *      dropped the assistant, and the header chip went with it, so nothing said so.
 *   2. Switching sessions cleared nothing, so an assistant applied in session A kept governing
 *      session B — with the header confirming it as intended. Not "something is missing" but
 *      "something wrong is presented as right", which is the more expensive of the two.
 *
 * A skill was about to become system context too. Without the fixes above it would have inherited
 * both, and a skill that wanders into the next session is **worse** than the pasted text it
 * replaces — that at least stays visible in the transcript where it belongs.
 */
const root = (p: string) => resolve(__dirname, '../../', p);
const code = (src: string) => src
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('composeSystemInstruction', () => {
  it('puts the assistant first and the skills after', () => {
    // ⭐ Order is load-bearing, not cosmetic: a skill refines a role. Leading with a knowledge block
    // lets it argue with the persona that is supposed to own the conversation.
    const out = composeSystemInstruction('ROLE', ['SKILL_A', 'SKILL_B'])!;
    expect(out.indexOf('ROLE')).toBeLessThan(out.indexOf('SKILL_A'));
    expect(out.indexOf('SKILL_A')).toBeLessThan(out.indexOf('SKILL_B'));
  });

  it('keeps skills in the order they were applied', () => {
    // The only order a person can predict, and therefore the only defensible one.
    expect(composeSystemInstruction(null, ['1', '2', '3'])).toBe('1\n\n2\n\n3');
  });

  it('works with skills and no assistant', () => {
    expect(composeSystemInstruction(null, ['SKILL'])).toBe('SKILL');
  });

  it('is undefined when nothing is applied', () => {
    // Not an empty string: the request omits the field entirely rather than sending a blank system
    // prompt, which some providers treat differently from its absence.
    expect(composeSystemInstruction(null, [])).toBeUndefined();
    expect(composeSystemInstruction('', [])).toBeUndefined();
    expect(composeSystemInstruction('   ', ['  '])).toBeUndefined();
  });
});

describe('SQEM-371 — the session is the owner of applied context', () => {
  const CHAT = code(readFileSync(root('pages/Chat.tsx'), 'utf8'));

  it('loading a session reads back what is applied to it', () => {
    // ⛔ The half that looked like it already worked. `assistant_id` was written on create and never
    // fetched, so this call did not exist before.
    expect(CHAT).toMatch(/fetchAppliedContext\(routeSessionId\)/);
  });

  it('a failed restore clears rather than keeps the previous context', () => {
    // The leak's direction: keeping is the dangerous default here. Wrong context is worse than none,
    // because the header would present it as belonging to the session you just opened.
    // ⚠️ Anchored on the `catch` that follows the restore, not on a character count. An earlier
    // version sliced a fixed number of characters after the first `} catch {` and failed while the
    // code was correct — a brittle assertion is a false alarm waiting to be silenced.
    const after = CHAT.slice(CHAT.indexOf('fetchAppliedContext'));
    const catchBlock = after.slice(after.indexOf('} catch {'));
    const failedRestore = catchBlock.slice(0, catchBlock.indexOf('}\n      } catch'));
    expect(failedRestore).toMatch(/setActiveSkills\(\[\]\)/);
    expect(failedRestore).toMatch(/setActiveSystemInstruction\(''\)/);
    expect(failedRestore).toMatch(/setActiveAssistantTemplate\(null\)/);
  });

  it('applying and removing both reach the session, not just the client', () => {
    // Clearing only client state would put a removed skill back on the next reload — the same
    // write-only hole, re-created in the opposite direction.
    const writes = [...CHAT.matchAll(/updateAppliedContext\(/g)];
    expect(writes.length).toBeGreaterThanOrEqual(4); // assistant apply/remove, skill apply/remove
  });

  it('a skill applied before the first message survives session creation', () => {
    // There is no session row to write to yet, so it has to ride along on the insert.
    expect(CHAT).toMatch(/createChatSession\([\s\S]{0,400}activeSkills\.map/);
  });

  it('the request sends the composed instruction, never the assistant alone', () => {
    expect(CHAT).toMatch(/systemInstruction: composeSystemInstruction\(/);
  });
});

describe('SQEM-371 — a skill is applied, a prompt is inserted', () => {
  const MODAL = code(readFileSync(root('components/TemplateLaunchModal.tsx'), 'utf8'));

  it('assistant and skill take the applied path', () => {
    expect(MODAL).toMatch(/kind === 'assistant' \|\| template\.kind === 'skill'/);
  });

  it('a prompt still goes to the composer', () => {
    // ⛔ Deliberate and not an oversight: a prompt is a task the person should be able to edit
    // before sending. Making it system context would take exactly that away.
    expect(MODAL).toMatch(/onInsert\(/);
  });

  it('the resolution lives in one place, because loading a session needs it too', () => {
    expect(MODAL).toMatch(/from '\.\.\/lib\/templateContext'/);
    expect(CHAT_USES_SHARED_RESOLVER()).toBe(true);
  });

  function CHAT_USES_SHARED_RESOLVER(): boolean {
    return /resolveAppliedContext/.test(code(readFileSync(root('pages/Chat.tsx'), 'utf8')));
  }
});

describe('SQEM-371 — the migration', () => {
  const SQL = readFileSync(
    root('supabase/migrations/20260910170000_sqem371_applied_skills.sql'), 'utf8',
  );

  it('adds the column additively and idempotently', () => {
    expect(SQL).toMatch(/add column if not exists applied_skill_ids uuid\[\]/);
    expect(SQL).toMatch(/not null default '\{\}'/);
  });

  it('checks its own work while applying', () => {
    // Including that existing rows are not null — every session created before today would
    // otherwise read back as null and the loader would have to guess.
    expect(SQL).toMatch(/raise exception/);
    expect(SQL).toMatch(/applied_skill_ids is null/);
  });
});
