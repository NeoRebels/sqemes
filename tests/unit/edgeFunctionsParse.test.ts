import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import ts from 'typescript';

/**
 * SQEM-526 — every edge function must at least PARSE. `tsc` does not cover `supabase/functions`
 * (Deno imports), and the source tests read files as text, so a stray apostrophe inside a
 * single-quoted tool description ("team's") passed every check and only failed at bundling —
 * "failed to create the graph" in the staging deploy, which stopped mcp-server and every function
 * after it from deploying. This catches that class before the deploy does.
 */
const FN = resolve(__dirname, '../../supabase/functions');
const files = [
  ...readdirSync(FN).filter(d => existsSync(join(FN, d, 'index.ts'))).map(d => join(FN, d, 'index.ts')),
  ...readdirSync(join(FN, '_shared')).filter(f => f.endsWith('.ts')).map(f => join(FN, '_shared', f)),
];

describe('edge functions parse', () => {
  it('finds the functions', () => expect(files.length).toBeGreaterThan(20));
  for (const f of files) {
    it(f.slice(FN.length + 1), () => {
      const out = ts.transpileModule(readFileSync(f, 'utf8'), { reportDiagnostics: true, fileName: f, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
      const errors = (out.diagnostics ?? []).map(d => ts.flattenDiagnosticMessageText(d.messageText, ' ') + (d.start != null ? ` @${d.start}` : ''));
      expect(errors).toEqual([]);
    });
  }
});
