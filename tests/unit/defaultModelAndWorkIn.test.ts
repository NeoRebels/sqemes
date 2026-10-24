import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('SQEM-577 — the default AI model is also where a chat starts', () => {
  const chat = read('pages/Chat.tsx');
  it('a chat without a model starts on the workspace default, when it is usable', () => {
    expect(chat).toMatch(/const preferred = authoringModelId\(workspace\);/);
    expect(chat).toMatch(/preferred && enabledModels\.some\(m => m\.id === preferred\) \? preferred : \(enabledModels\[0\]\?\.id \?\? ''\)/);
    expect(chat).toMatch(/if \(!selectedModel && defaultModelId\) setSelectedModel\(defaultModelId\);/);
  });
  it('a session whose stored model is gone falls back to the default, not to list order', () => {
    expect(chat).toMatch(/setSelectedModel\(isValid \? active\.model : defaultModelId\);/);
    expect(chat).not.toMatch(/setSelectedModel\(enabledModels\[0\]/);
  });
  it('the card says so, under its new name, and the hints point at that name', () => {
    const card = read('components/AuthoringModelCard.tsx');
    expect(card).toMatch(/Default AI model\n/);
    expect(card).toMatch(/New chats start with this model/);
    expect(card).not.toMatch(/AI for authoring|It does not affect Chat/);
    for (const f of ['lib/aiErrors.ts', 'lib/wizardUploads.ts']) expect(read(f), f).toMatch(/Settings → General → Default AI model/);
  });
});

describe('SQEM-578 — "Work in" above the AI tool links on Start', () => {
  it('a visible, centred heading that still names the nav', () => {
    const links = read('components/AiToolLinks.tsx');
    expect(links).toMatch(/<nav aria-labelledby="start-ai-tools"/);
    expect(links).toMatch(/<h2 id="start-ai-tools" className="[^"]*text-center[^"]*">Work in<\/h2>/);
    expect(links).not.toMatch(/sr-only/);
  });
});
