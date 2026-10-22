import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MCP_CLIENTS } from '../../lib/mcpClients';

/**
 * SQEM-554 (c) — the MCP card in Settings → API & MCP: first in the tab, three numbered steps, the
 * client tabs with logos, and the system prompt kept in view (SQEM-468: it decides whether MCP works).
 */
const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const settings = read('pages/Settings.tsx');
const card = settings.slice(settings.indexOf('const McpServerCard = '), settings.indexOf('const McpServerCard = ') + 9000);

describe('SQEM-554 (c) — the MCP card', () => {
  it('is the first card of the API & MCP tab, above the key cards', () => {
    const tab = settings.slice(settings.indexOf("{activeTab === 'api' && can(currentUser, workspace, 'api-keys:own') && ("));
    const mcp = tab.indexOf('<McpServerCard locked={!hasMcpAccess}');
    expect(mcp).toBeGreaterThan(-1);
    expect(mcp).toBeLessThan(tab.indexOf('AI provider keys'));
    expect(mcp).toBeLessThan(tab.indexOf('Public API Keys'));
    expect(settings.match(/<McpServerCard /g)).toHaveLength(1); // moved, not copied
  });

  it('three numbered steps, in order: endpoint, client, system prompt', () => {
    const steps = [...card.matchAll(/<McpStep n=\{(\d)\} title="([^"]+)">/g)].map(m => `${m[1]} ${m[2]}`);
    expect(steps).toEqual(['1 Copy the endpoint', '2 Connect your AI tool', '3 Paste the system prompt too']);
    expect(card).toMatch(/<McpStep n=\{2\} title="Connect your AI tool">\s*<McpClientGuide url=\{mcpUrl\} \/>/);
  });

  it('⛔ the system prompt is shortened, never hidden: Copy is outside the clamp and always rendered', () => {
    expect(card).toMatch(/<pre id="mcp-system-prompt" className=\{`[^`]*\$\{promptOpen \? 'max-h-80 overflow-y-auto' : 'max-h-20 overflow-hidden [^']*'\}`\}>\{LIBRARY_SYSTEM_PROMPT\}<\/pre>/);
    const afterPre = card.slice(card.indexOf('{LIBRARY_SYSTEM_PROMPT}</pre>'));
    expect(afterPre).toMatch(/^[\s\S]{0,200}<button[\s\S]{0,200}copyToClipboard\(LIBRARY_SYSTEM_PROMPT\)/);
    expect(card).toMatch(/aria-expanded=\{promptOpen\}\s*aria-controls="mcp-system-prompt"/);
    expect(card).not.toMatch(/\{promptOpen && [^}]*copyToClipboard/);
    expect(card).toMatch(/Paste the system prompt too/);
  });

  it('display-face title; no old slate/brand classes left in the card', () => {
    expect(card).toMatch(/<h2 className="font-display text-xl font-semibold text-ink-strong flex items-center gap-2">/);
    const body = card.slice(0, card.indexOf('\n};\n'));
    expect(body).not.toMatch(/slate-|brand-|emerald-/);
  });
});

describe('SQEM-554 (c) — client logos', () => {
  const icon = read('components/ProviderIcon.tsx');
  it('every client with a logo: registered in ProviderIcon, the file exists, `mono` matches the drawing', () => {
    for (const c of MCP_CLIENTS.filter(c => c.logo)) {
      const key = c.logo!.icon;
      const m = icon.match(new RegExp(`import ${key}Src from '\\.\\./assets/([^']+)'`));
      expect(m, key).not.toBeNull();
      expect(icon).toMatch(new RegExp(`\\b${key}: ${key}Src`));
      const svg = read(`assets/${m![1]}`);
      // A currentColor logo renders black in an <img>: it must be marked mono (inverted in dark mode).
      expect(!!c.logo!.mono, `${c.id} mono`).toBe(/fill="currentColor"/.test(svg) && !/fill="(#|url\()/.test(svg));
    }
  });
  it('VS Code and Other carry no logo (none from a checked source) and get a neutral icon', () => {
    expect(MCP_CLIENTS.find(c => c.id === 'vscode')!.logo).toBeUndefined();
    expect(MCP_CLIENTS.find(c => c.id === 'other')!.logo).toBeUndefined();
    expect(read('components/McpClientGuide.tsx')).toMatch(/c\.id === 'vscode' \? <Code2 aria-hidden/);
  });
  it('the guide puts the logo on each tab, inverted in dark mode when single-colour', () => {
    const guide = read('components/McpClientGuide.tsx');
    expect(guide).toMatch(/tabs=\{MCP_CLIENTS\.map\(c => \(\{ value: c\.id, label: c\.label, icon: clientIcon\(c\) \}\)\)\}/);
    expect(guide).toMatch(/c\.logo\.mono \? ' dark:invert' : ''/);
  });
  it('the licence note names the three new files', () => {
    const note = read('assets/ICONS-LICENSE.md');
    for (const f of ['claudecode.svg', 'codex.svg', 'cursor.svg']) {
      expect(note).toContain(`\`${f}\``);
      expect(existsSync(join(root, 'assets', f))).toBe(true);
    }
  });
});
