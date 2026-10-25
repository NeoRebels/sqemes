import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-436 — connectors are always sent; the icon only says whether the chosen model can use them.
 *
 * The step that went away: a menu of checkboxes, starting empty, that had to be ticked before any
 * connector was passed at all. A connector is set up in order to be there.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const CHAT = read('pages/Chat.tsx');

describe('SQEM-436 — connectors always active', () => {
  it('⛔ the per-session selection is gone', () => {
    expect(CHAT).not.toContain('enabledConnectorIds');
    expect(CHAT).not.toContain('connectorMenuOpen');
    // The checkbox list went with it.
    expect(CHAT).not.toMatch(/type="checkbox"[\s\S]{0,400}c\.mcp_url/);
  });

  it('⛔ the state depends on the SELECTED model, not on which keys exist', () => {
    // The old menu appeared when `enabledModels.some(...)` found any Claude/OpenAI model — a
    // different question: a workspace with a Claude key could be chatting on Gemini and still be
    // offered connectors that would never be sent.
    expect(CHAT).toMatch(/const m = AVAILABLE_MODELS\.find\(x => x\.id === selectedModel\)/);
    // SQEM-584 — every text model (own MCP client for non-Claude/OpenAI); only image models cannot.
    expect(CHAT).toMatch(/return !!m && !isImageModel\(m\.id\);/);
  });

  it('nothing is sent when the model cannot use them', () => {
    // Since SQEM-582 the timeout no longer depends on connectors, so this is only about not sending
    // ids the server would ignore.
    expect(CHAT).toMatch(/connectorsSupported \? connectors\.map\(c => c\.id\) : \[\]/);
    expect(CHAT).toMatch(/connectorIds: activeConnectorIds/);
  });

  it('both hover texts are present, in the owner’s wording', () => {
    expect(CHAT).toContain('Your MCP Connectors are active');
    expect(CHAT).toContain('image models cannot use them'); // SQEM-584 — was "only works with Claude and ChatGPT"
    // ⚠️ Both states name the thing. "inactive" alone made the reader supply the subject, and next to
    // a red dot the likeliest guess is "something is broken" rather than "the model you picked cannot".
    expect(CHAT).toContain('Your MCP Connectors are inactive');
  });

  it('⚠️ green and red, and red is a deliberate choice', () => {
    // Red reads as an error everywhere else in this app, and "this model cannot do it" is not an
    // error — it is a consequence of the model choice. The owner chose red knowing that; recorded
    // here so it is not later "fixed" to amber by someone who assumes it was an accident.
    // SQEM-584 — the same two states, on the design tokens.
    expect(CHAT).toMatch(/connectorsSupported\s*\n?\s*\? 'text-success bg-success-soft'/);
    expect(CHAT).toMatch(/: 'text-danger bg-danger-soft'/);
  });

  it('the indicator shows whenever the workspace has connectors', () => {
    // Including when no Claude/OpenAI key exists at all: "inactive" is the honest answer there too,
    // and hiding it would leave a connected service looking broken.
    expect(CHAT).toMatch(/\{connectors\.length > 0 && \(/);
  });
});
