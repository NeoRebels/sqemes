import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { noKeyHint, PROVIDER_KEYS_TAB } from '../../lib/chatKeyHint';

/**
 * SQEM-536 — Chat without a model: a way forward for whoever can add a key, a clear pointer to an
 * admin for everybody else, and never the name of a settings section that no longer exists.
 */
const chat = readFileSync(resolve(__dirname, '../../pages/Chat.tsx'), 'utf8');

describe('SQEM-536 — the no-key hint', () => {
  it('someone who can manage keys gets a button', () => {
    const h = noKeyHint(true);
    expect(h.actionLabel).toBe('Add an AI provider key');
    expect(h.text).toMatch(/AI provider key/);
  });

  it('a member is sent to an admin, with no button', () => {
    const h = noKeyHint(false);
    expect(h.actionLabel).toBeNull();
    expect(h.text).toMatch(/workspace admin/);
  });

  it('the button goes to the tab that holds the provider keys', () => {
    expect(PROVIDER_KEYS_TAB).toBe('api');
    const settings = readFileSync(resolve(__dirname, '../../pages/Settings.tsx'), 'utf8');
    expect(settings).toMatch(/activeTab === 'api'[\s\S]{0,2000}AI provider keys/);
  });

  it('Chat decides by api-keys:manage and drops the stale wording', () => {
    expect(chat).toMatch(/noKeyHint\(can\(currentUser, workspace, 'api-keys:manage'\)\)/);
    expect(chat).not.toMatch(/LLM API Keys/);
    expect(chat).not.toMatch(/emptyActionLabel="Add API key"/);
    // The model picker offers its action only when the hint has one.
    expect(chat).toMatch(/onEmptyAction=\{keyHint\.actionLabel \? openProviderKeys : undefined\}/);
  });
});
