/**
 * SQEM-504 — SQL against the LOCAL Supabase database only.
 *
 * ⛔ Never a remote database. The tests seed users and rows and switch roles; they run through
 * `docker exec` into the local `supabase_db_*` container that `supabase start` creates, so there is
 * no connection string to point at production by mistake. No container → the suite refuses to run.
 */
import { execFileSync } from 'node:child_process';

function container(): string {
  const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' })
    .split('\n').filter(n => n.startsWith('supabase_db_'));
  if (names.length !== 1) {
    throw new Error(`SQEM-504: expected exactly one local supabase_db_* container, found ${names.length}. Run \`npx supabase start\` first.`);
  }
  return names[0];
}

let cached: string | null = null;

/** Run SQL as `postgres`; returns tab-separated rows (no header). Throws on any error. */
export function sql(query: string): string[][] {
  cached ??= container();
  const out = execFileSync(
    'docker',
    ['exec', '-i', cached, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-At', '-F', '\t'],
    { input: query, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return out.split('\n').filter(l => l.length > 0).map(l => l.split('\t'));
}

/** Single scalar. */
export function one(query: string): string {
  const rows = sql(query);
  return rows[0]?.[0] ?? '';
}

/** Quote a string literal for SQL. */
export const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
