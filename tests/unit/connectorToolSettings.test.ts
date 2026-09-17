import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-438 — choosing which tools a connector brings.
 *
 * `allowed_tools` has been honoured since SQEM-149 and settable never. Since SQEM-436 removed the
 * per-chat picker it is the only remaining lever on scope, tokens, and the model reaching for the
 * wrong service — so "no editor" stopped being a comfort problem.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const FN = read('supabase/functions/manage-connectors/index.ts');
const CARD = read('components/ConnectorsCard.tsx');
const API = read('lib/api/connectors.ts');
const RLS = read('supabase/migrations/20260727120000_sqem149_workspace_connectors.sql');

describe('SQEM-438 — connector tool settings', () => {
  it('⛔ it is an edge-function action, because the browser cannot write this row', () => {
    // `workspace_connectors` has SELECT and DELETE policies and deliberately no INSERT/UPDATE one.
    // A dialog reaching for `.update()` would fail with `permission denied`, and the fix would not
    // be a new policy — it would be this action.
    expect(RLS).toMatch(/INSERT\/UPDATE intentionally have NO policy/);
    expect(FN).toMatch(/body\.action === 'set-tools'/);
    expect(API).toMatch(/invoke\(\{ action: 'set-tools', connectorId, tools \}\)/);
    expect(CARD).not.toMatch(/from\('workspace_connectors'\)[\s\S]{0,40}\.update\(/);
  });

  it('⛔ the permission mirrors the DELETE policy, word for word', () => {
    // Own personal connector, or a workspace-shared one as admin/editor. A second, slightly
    // different rule about the same row is how two answers to one question come about.
    expect(RLS).toMatch(/user_id = \(select auth\.uid\(\)\)\s*\n\s*or \(user_id is null and public\.get_user_role\(workspace_id\) in \('admin', 'editor'\)\)/);
    expect(FN).toMatch(/const mayEdit = row\.user_id\s*\n?\s*\? row\.user_id === user\.id\s*\n?\s*: \['admin', 'editor'\]\.includes\(mem\.role\)/);
  });

  it('⛔ "all tools" and "every tool ticked" stay distinguishable', () => {
    // They look identical in a list of boxes and mean opposite things: no restriction follows the
    // provider as they add tools, an explicit list freezes today's set. An empty array would read as
    // "all" in the UI and as "none" in the data, so it collapses to null.
    expect(FN).toMatch(/const allowed = Array\.isArray\(tools\) && tools\.length \? tools\.map\(String\) : null;/);
    expect(CARD).toMatch(/checked=\{toolsPick === null\}/);
    expect(CARD).toMatch(/New tools are included automatically/);
    expect(CARD).toMatch(/a tool added later stays off until you come back/);
  });

  it('⚠️ a failed probe does not read as "this connector has no tools"', () => {
    // The saved selection is still in force and still editable; only the live list is missing.
    expect(CARD).toMatch(/Could not load the live tool list/);
    expect(CARD).toMatch(/Your saved selection is unchanged and can still be edited/);
    // …and the checkbox list falls back to the saved names rather than rendering empty.
    expect(CARD).toMatch(/toolsList \?\? \(toolsPick\.map\(name => \(\{ name, description: undefined \}\)\)\)/);
  });

  it('the action validates its input before touching the row', () => {
    expect(FN).toMatch(/if \(!connectorId\) return json\(\{ error: 'connectorId required' \}, 400\)/);
    expect(FN).toMatch(/tools !== null && !Array\.isArray\(tools\)/);
    expect(FN).toMatch(/if \(!row\) return json\(\{ error: 'Connector not found' \}, 404\)/);
  });
});
