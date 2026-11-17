import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const compose = read('selfhost/docker-compose.sqemes.yml');
const envExample = read('selfhost/.env.example');

// SQEM-695 — on the Docker bundle an edge function sees only what the compose file passes. These were
// documented as settable but never arrived, so mail went out as noreply@sqemes.com and no limit could be tuned.
const PASSED = ['RESEND_FROM_EMAIL', 'MCP_READ_RPM', 'MCP_WRITE_RPM', 'CHAT_RPM_PER_USER', 'CHAT_RPM_PER_WORKSPACE', 'USAGE_RPM_PER_USER', 'RATE_LIMIT_RPM'];

describe('self-host bundle: env reaching the edge functions (SQEM-695)', () => {
  it.each(PASSED)('%s is passed to the functions and listed in .env.example', (v) => {
    expect(compose).toContain(`${v}: \${${v}:-}`);
    expect(envExample).toMatch(new RegExp(`^${v}=`, 'm'));
  });

  it("every reader treats '' as unset, because the bundle passes an unset value as ''", () => {
    const readers: Record<string, string> = {
      'supabase/functions/mcp-server/index.ts': "parseInt(Deno.env.get('MCP_READ_RPM')  || '600', 10)",
      'supabase/functions/_shared/rateLimit.ts': "parseInt(Deno.env.get('RATE_LIMIT_RPM') || '60', 10)",
      'supabase/functions/record-usage/index.ts': "Number(Deno.env.get('USAGE_RPM_PER_USER') || '60')",
      'supabase/functions/notify-new-sign-in/index.ts': "Deno.env.get('RESEND_FROM_EMAIL') || 'sqemes <noreply@sqemes.com>'",
      'supabase/functions/send-invite-email/index.ts': "Deno.env.get('RESEND_FROM_EMAIL') || 'sqemes <noreply@sqemes.com>'",
    };
    for (const [file, line] of Object.entries(readers)) expect(read(file)).toContain(line);
    expect(read('supabase/functions/_shared/chatBudget.ts')).toContain("const n = raw ? parseInt(raw, 10) : NaN;");
    for (const v of PASSED) {
      const uses = [...read('supabase/functions/record-usage/index.ts').matchAll(new RegExp(`Deno\\.env\\.get\\('${v}'\\) \\?\\?`, 'g'))];
      expect(uses).toHaveLength(0);
    }
  });
});
