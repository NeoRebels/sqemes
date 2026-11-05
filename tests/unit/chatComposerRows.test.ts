import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en } from './i18nText';

/**
 * SQEM-401 — on a phone the chat composer is two rows; on a desktop it is the one row it was.
 *
 * Row 1 (first below `md`): the textarea, Enhance with AI, Send. Row 2, centred: attach, the
 * playbook picker, connectors. From `md` up the wrapper is a single row with the tools first. The
 * page imports the store and Supabase and cannot be rendered here; this reads the class lists.
 *
 * ⚠️ The menus of attach and connectors used to anchor `left-0` to their button. Under a centred
 * toolbar that overflows a 375 px screen to the right, so on a phone they anchor to the centre.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const CHAT = code(read('pages/Chat.tsx'));

/** The composer wrapper: the drop zone that carries the drag ring. */
function composer(): string {
  const at = CHAT.indexOf('${dragActive ?');
  expect(at, 'drop-zone wrapper').toBeGreaterThan(-1);
  const open = CHAT.lastIndexOf('<div', at);
  // Up to (and including) the Send button and the two closing divs that follow it.
  const send = CHAT.indexOf('<button onClick={handleSend}', at);
  const end = CHAT.indexOf('</div>', CHAT.indexOf('</button>', send));
  return CHAT.slice(open, end + '</div>'.length);
}

describe('SQEM-401 — two rows on a phone, one row on a desktop', () => {
  const src = composer();

  it('the wrapper stacks below md and is a row from md up', () => {
    expect(src).toMatch(/className=\{`flex flex-col gap-2 md:flex-row md:items-center md:gap-3 \$\{dragActive/);
  });

  it('the tools group is second (centred) on a phone and first (left) on a desktop', () => {
    const tools = src.match(/<div className="([^"]*order-2 md:order-1[^"]*)">/);
    expect(tools, 'tools group').not.toBeNull();
    expect(tools![1]).toMatch(/justify-center/);
    expect(tools![1]).toMatch(/md:justify-start/);
    const toolsStart = src.indexOf(tools![0]);
    const toolsEnd = src.indexOf('order-1 md:order-2');
    const toolsBody = src.slice(toolsStart, toolsEnd);
    expect(toolsBody).toMatch(/<Paperclip /);
    expect(toolsBody).toMatch(/title=\{txt\.chat_use_playbook\(\)\}/); // SQEM-544 — was "Use template"
    expect(en.chat_use_playbook).toBe('Use playbook  (/)'); // SQEM-604 — the words live in messages/
    expect(toolsBody).not.toMatch(/<Plug /); // SQEM-651 — the connector icon is gone
    expect(toolsBody).not.toMatch(/<textarea/);
  });

  it('the input group is first on a phone, second on a desktop, and takes the width', () => {
    const input = src.match(/<div className="([^"]*order-1 md:order-2[^"]*)">/);
    expect(input, 'input group').not.toBeNull();
    expect(input![1]).toMatch(/flex-1/);
    const body = src.slice(src.indexOf(input![0]));
    expect(body).toMatch(/<textarea/);
    expect(body).toMatch(/title=\{txt\.chat_enhance\(\)\}/);
    expect(en.chat_enhance).toBe('Enhance with AI');
    expect(body).toMatch(/<Send /);
    expect(body).not.toMatch(/<Paperclip /);
  });

  it('⚠️ the attach menu anchors to the button\'s centre on a phone and to its left edge from md up', () => {
    // SQEM-436 took the connectors menu away (status only), SQEM-635 brought it back as switches, and
    // SQEM-651 removed it for good: one menu again. Anchored left on a phone, a menu opens off the screen.
    const menus = src.match(/absolute bottom-full left-1\/2 -translate-x-1\/2 md:left-0 md:translate-x-0 mb-2 w-(64|72)/g) ?? [];
    expect(menus.length, 'attach menu').toBe(1);
    expect(src).not.toMatch(/absolute bottom-full left-0 mb-2/);
  });

  it('⛔ no element carries an `animate-*` class and a `translate-*` class at once (SQEM-636)', () => {
    // `animate-scale-up` holds `transform` with `forwards` and so cancels `-translate-x-1/2`: the
    // attach menu ran 37 px off a 390 px screen (measured). Position outside, animate inside.
    const classLists = CHAT.match(/className=("[^"]*"|`[^`]*`|\{[^}]*\})/g) ?? [];
    const both = classLists.filter(c => /\banimate-/.test(c) && /-?translate-[xy]/.test(c));
    expect(both).toEqual([]);
  });
});
