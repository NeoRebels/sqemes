import { describe, it, expect, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import KindBadge from '../../components/ui/KindBadge';
import SegmentedTabs from '../../components/ui/SegmentedTabs';
import { KIND_HELP } from '../../constants';
import type { PromptKind } from '../../types';

/**
 * SQEM-384 — the kind explains itself where the kind is shown.
 *
 * `KIND_HELP` existed since SQEM-204 and was rendered in the empty state and the editor only. A UX
 * tester (2026-09-08) looked at a card that said SKILL and had nothing that told him what that was.
 * These tests pin that the text now travels with the pill and with the filter tabs — rendered, not
 * grepped, because a `title` that is computed but never reaches the DOM would pass a grep.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KINDS: PromptKind[] = ['prompt', 'skill']; // SQEM-390 — two kinds
const ROOT = resolve(__dirname, '../../');

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(element: React.ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('SQEM-384 — KindBadge carries KIND_HELP as its title', () => {
  for (const kind of KINDS) {
    it(`${kind}: the pill's title is the KIND_HELP one-liner`, () => {
      const el = mount(React.createElement(KindBadge, { kind }));
      const pill = el.querySelector('span[title]');
      expect(pill, 'the pill must carry a title attribute').not.toBeNull();
      expect(pill!.getAttribute('title')).toBe(KIND_HELP[kind]);
      // …and the visible label is still there — the title adds, it does not replace.
      expect(pill!.textContent?.trim().toLowerCase()).toContain(kind);
    });
  }

  it('the explanations are distinct and each carries an example', () => {
    // A copy regression guard: KIND_HELP is now user-facing on every card.
    const texts = KINDS.map(k => KIND_HELP[k]);
    expect(new Set(texts).size).toBe(KINDS.length);
    for (const t of texts) expect(t).toMatch(/Example:/);
  });
});

describe('SQEM-384 — SegmentedTabs passes a tab title through to its button', () => {
  it('renders `title` on the button when given, and nothing when not', () => {
    const el = mount(
      React.createElement(SegmentedTabs<'a' | 'b'>, {
        value: 'a',
        onChange: () => {},
        tabs: [
          { value: 'a', label: 'A', title: 'what A is' },
          { value: 'b', label: 'B' },
        ],
      }),
    );
    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].getAttribute('title')).toBe('what A is');
    expect(buttons[1].hasAttribute('title')).toBe(false);
  });

  it('⛔ the Templates page wires KIND_HELP onto the kind tabs', () => {
    // The page is too entangled (router, store, supabase) to render here; the wiring is one line per
    // tab and this reads it. If the tabs move to another primitive, move this assertion with them.
    const src = readFileSync(resolve(ROOT, 'pages/Templates.tsx'), 'utf8');
    for (const kind of KINDS) {
      expect(src, `kind tab '${kind}' must carry KIND_HELP.${kind}`).toMatch(
        new RegExp(`value: '${kind}'[^}]*title: KIND_HELP\\.${kind}`),
      );
    }
  });
});

describe('SQEM-384 — the Personas page says where a persona works, and only where', () => {
  it('⛔ Chat and MCP — not the extension, which inserts templates and knows no personas', () => {
    const src = readFileSync(resolve(ROOT, 'pages/Personas.tsx'), 'utf8');
    const subtitle = src.match(/subtitle="([^"]*)"/)?.[1] ?? '';
    expect(subtitle).toContain('Works in Chat and via MCP');
    expect(subtitle).not.toMatch(/extension/i);
  });
});

describe('SQEM-384 — "MCP only" is gone from the UI, and stays gone', () => {
  // ⛔ The Sidebar badge said personas worked only through MCP. True from SQEM-350 to SQEM-373 (Chat
  // gained tool calling over the library), wrong for two days after, and in a UX test (2026-09-11)
  // it did exactly what a label does: the tester believed it. A label that states WHERE a feature
  // works is a claim that expires; this guard makes re-adding it a deliberate act.
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
    }
    return out;
  }

  it('no component or page renders the string "MCP only"', () => {
    const files = [...walk(resolve(ROOT, 'components')), ...walk(resolve(ROOT, 'pages'))];
    const hits = files
      .filter(f => {
        // Strip comments: the Sidebar keeps the history of the badge in a comment on purpose.
        const code = readFileSync(f, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1')
          .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
        return /MCP only/.test(code);
      })
      .map(f => f.slice(ROOT.length + 1));
    expect(hits).toEqual([]);
  });
});
