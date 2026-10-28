import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en } from './i18nText';

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
    expect(card).toMatch(/\{txt\.am_title\(\)\}\n/);
    expect(en.am_title).toBe('Default AI model'); // SQEM-608 — the words live in messages/
    expect(en.am_desc).toMatch(/^New chats start with this model/);
    expect(card).not.toMatch(/AI for authoring|It does not affect Chat/);
    expect(read('lib/wizardUploads.ts')).toMatch(/m\.wu_pdf_provider\(/); // SQEM-610
    expect(en.wu_pdf_provider).toMatch(/Settings → General → Default AI model/);
    // SQEM-604 — aiErrors' words live in messages/; the code must still use that sentence.
    expect(read('lib/aiErrors.ts')).toMatch(/txt\.aierr_alternative\(\)/);
    expect(en.aierr_alternative).toMatch(/Settings → General → Default AI model/);
  });
});

describe('SQEM-578 — "Work in" above the AI tool links on Start', () => {
  it('a visible, centred heading that still names the nav', () => {
    const links = read('components/AiToolLinks.tsx');
    expect(links).toMatch(/<nav aria-labelledby="start-ai-tools"/);
    expect(links).toMatch(/<h2 id="start-ai-tools" className="[^"]*text-center[^"]*">\{m\.start_work_in\(\)\}<\/h2>/);
    expect(en.start_work_in).toBe('Work in'); // SQEM-604
    expect(links).not.toMatch(/sr-only/);
  });
});
