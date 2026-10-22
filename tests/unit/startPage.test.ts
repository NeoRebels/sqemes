import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HANDOFF_MAX_AGE_MS, clearChatHandoff, handOffToChat, peekChatHandoff } from '../../lib/chatHandoff';

/**
 * SQEM-550 (a) — the Start page (redesign C): a composer that hands its text to Chat, which sends it
 * once. Pages import the store (and lib/supabase), so they are checked at
 * source level; the handoff is tested directly.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

describe('SQEM-550 (a) — the handoff to Chat', () => {
  afterEach(() => clearChatHandoff());

  it('carries the trimmed text and the persona', () => {
    handOffToChat('  Reply to order 4471  ', 'p1', 1000);
    expect(peekChatHandoff(1000)).toEqual({ draft: 'Reply to order 4471', personaId: 'p1', at: 1000 });
  });

  it('peeking does not consume; clearing does', () => {
    handOffToChat('x', undefined, 0);
    expect(peekChatHandoff(1)).not.toBeNull();
    expect(peekChatHandoff(2)).not.toBeNull();
    clearChatHandoff();
    expect(peekChatHandoff(3)).toBeNull();
  });

  it('an empty draft is not handed over', () => {
    handOffToChat('   ', 'p1', 0);
    expect(peekChatHandoff(0)).toBeNull();
  });

  it('⛔ a draft nobody picked up in time expires instead of being sent later', () => {
    handOffToChat('late', undefined, 0);
    expect(peekChatHandoff(HANDOFF_MAX_AGE_MS + 1)).toBeNull();
    expect(peekChatHandoff(0)).toBeNull(); // dropped, not just hidden
  });
});

describe('SQEM-550 (a) — Chat sends the handed-over text exactly once', () => {
  const chat = read('pages/Chat.tsx');

  it('the input starts with the draft, and the slot is cleared once taken', () => {
    expect(chat).toMatch(/const \[handoff\]\s+= useState\(\(\) => peekChatHandoff\(\)\);/);
    expect(chat).toMatch(/useState\(\(\) => handoff\?\.draft \?\? ''\)/);
    expect(chat).toMatch(/if \(!handoff\) return;\s+clearChatHandoff\(\);/);
  });

  it('sends once, only when a model is there and the persona is applied, and not after an edit', () => {
    expect(chat).toMatch(/if \(!handoff \|\| handoffSentRef\.current \|\| !handoffPersonaReady \|\| !selectedModel \|\| isLoading\) return;/);
    expect(chat).toMatch(/if \(input\.trim\(\) !== handoff\.draft\) return;/);
    expect(chat).toMatch(/handoffSentRef\.current = true;\s+void handleSend\(\);/);
  });

  it('⛔ the draft is not router state (Back and reload would send it again)', () => {
    expect(chat).not.toMatch(/state as \{ draft/);
    expect(read('components/StartComposer.tsx')).not.toMatch(/state: \{ draft/);
  });

  it('Start’s Playbook button opens Chat’s own picker', () => {
    expect(read('components/StartComposer.tsx')).toMatch(/navigate\('\/chat', \{ state: \{ openTemplatePicker: true \} \}\)/);
    expect(chat).toMatch(/if \(openTemplatePicker\) setTemplateModalOpen\(true\);/);
  });
});

describe('SQEM-550 (a) — the page', () => {
  const dash = read('pages/Dashboard.tsx');

  it('opens with the question in the display face and the composer', () => {
    expect(dash).toMatch(/<h1 className="font-display[^"]*">\s*\{firstName \? `What are we working on, \$\{firstName\}\?` : 'What are we working on\?'\}/);
    expect(dash).toMatch(/<StartComposer workspaceId=\{workspace\.id\} \/>/);
  });

  it('favourites are tiles with "Use"; the old action buttons are gone', () => {
    expect(dash).toMatch(/id="start-favourites"/);
    expect(dash).toMatch(/Use <ArrowRight/);
    expect(dash).not.toMatch(/renderActions/);
  });

  it('SQEM-552 — Connections and the plan moved to the Overview', () => {
    expect(dash).not.toMatch(/>Connections</);
    expect(dash).not.toMatch(/Current Plan/);
    const overview = read('pages/Overview.tsx');
    expect(overview).toMatch(/Current Plan/);
    expect(overview).toMatch(/aria-label="Channels"/);
  });

  it('it is called Start in the sidebar and in the page title', () => {
    expect(read('components/Sidebar.tsx')).toMatch(/\{ to: "\/", icon: Home, label: "Start" \}/);
    expect(read('App.tsx')).toMatch(/if \(pathname === '\/'\) return 'Start';/);
  });
});

describe('SQEM-550 (a) follow-up — the persona list is wide enough to read', () => {
  it('Start passes `wide`; the picker then gives its panel at least 18rem, capped at the screen', () => {
    expect(read('components/StartComposer.tsx')).toMatch(/<PickerDropdown\s+wide\s/);
    const picker = read('components/ui/PickerDropdown.tsx');
    expect(picker).toMatch(/wide \? 'min-w-full w-72 max-w-\[85vw\]' : 'w-full'/);
  });
});

