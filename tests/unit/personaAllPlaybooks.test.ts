import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { composePersona, PERSONA_RULES, PERSONA_RULES_UNATTENDED } from '../../supabase/functions/_shared/libraryQueries';
import { LIBRARY_TOOL_DEFS } from '../../supabase/functions/_shared/libraryToolDefs';
import { LIBRARY_SYSTEM_PROMPT } from '../../supabase/functions/_shared/libraryPrompt';

// SQEM-703 — a persona loads every playbook whose condition the task meets, not only one.
const routes = [
  { name: 'a', title: 'A', kind: 'prompt', condition: 'x', description: '' },
  { name: 'b', title: 'B', kind: 'skill', condition: 'y', description: '' },
];
const persona = { title: 'Role', description: 'd', content: 'role text' };

describe('composePersona', () => {
  it('states the rule: every playbook whose condition the task meets, re-checked per task, outranking older text', () => {
    const md = composePersona(persona, routes);
    expect(md).toContain('## Playbooks — load every one whose condition this task meets');
    expect(md).toContain(PERSONA_RULES);
    expect(PERSONA_RULES).toContain('load every playbook whose condition the task meets');
    expect(PERSONA_RULES).toContain('Check the conditions again for every new task.');
    expect(PERSONA_RULES).toMatch(/These rules replace any instruction to load only one playbook\.$/);
    expect(md).not.toMatch(/only the one|load one only|only that one/i);
  });
  it('asks only about two playbooks for the same part of the task', () => {
    expect(PERSONA_RULES).toContain('If two playbooks would cover the same part of the task, name both and ask which to use.');
  });
  it('a routine picks and says why instead of asking, and has no per-task re-check', () => {
    const md = composePersona(persona, routes, [], { unattended: true });
    expect(md).toContain(PERSONA_RULES_UNATTENDED);
    expect(PERSONA_RULES_UNATTENDED).not.toMatch(/\bask\b/);
    expect(PERSONA_RULES_UNATTENDED).toContain('use the more specific one and say in the result why');
    expect(PERSONA_RULES_UNATTENDED).not.toContain('Check the conditions again');
  });
  it('no examples and no "route" in the rule texts', () => {
    for (const t of [PERSONA_RULES, PERSONA_RULES_UNATTENDED]) {
      expect(t).not.toMatch(/\b(e\.g\.|for example|such as)\b/i);
      expect(t).not.toMatch(/\broutes?\b/i);
    }
  });
});

describe('what clients read about personas', () => {
  const desc = (n: string) => (LIBRARY_TOOL_DEFS as { name: string; description: string }[]).find(t => t.name === n)!.description;
  it('no persona tool says "only one" or calls an entry a route in its prose', () => {
    for (const n of ['list_personas', 'get_persona', 'create_persona', 'update_persona', 'delete_persona', 'attach_template', 'detach_template']) {
      expect(desc(n)).not.toMatch(/only that one|load one only|only the one/i);
      expect(desc(n)).not.toMatch(/\broutes?\b/i);
    }
    expect(desc('get_persona')).toContain('Load every playbook whose condition the current task meets, and no other.');
  });
  it('the library instruction loads every playbook whose condition the task meets', () => {
    expect(LIBRARY_SYSTEM_PROMPT).toContain('3. Playbooks: load every playbook whose persona condition the task meets.');
    expect(LIBRARY_SYSTEM_PROMPT).not.toContain('Several playbooks fit');
    expect(LIBRARY_SYSTEM_PROMPT.length).toBeLessThan(3000);
  });
  it('the routine path renders the persona unattended', () => {
    expect(readFileSync('supabase/functions/routine-run/index.ts', 'utf8')).toContain('reader.getPersona({ id: r.persona_id, unattended: true })');
    expect(readFileSync('supabase/functions/_shared/libraryTools.ts', 'utf8')).toMatch(/lib\.getPersona\(\{[\s\S]{0,200}unattended,/);
  });
});
