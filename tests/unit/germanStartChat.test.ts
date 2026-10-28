import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { connectorRefusedNotice } from '../../supabase/functions/_shared/connectorRefusal';
import { allowanceNotice, webNotSetUpNotice } from '../../supabase/functions/_shared/webSearch';
import { m } from '../../supabase/functions/_shared/locale';
import { describeAIError } from '../../lib/aiErrors';

/** SQEM-604 — Start and Chat in two languages: what the server adds, plurals, provider errors. */
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('SQEM-604 — notices sqemes adds to an answer follow the request language', () => {
  it('a refused connector — one and several, both languages', () => {
    expect(connectorRefusedNotice(['Plaud'])).toBe('\n\n---\n_Answered without Plaud: the connector refused the connection. Reconnect it in Settings → Connectors._');
    expect(connectorRefusedNotice(['A', 'B'])).toMatch(/the connectors refused the connection\. Reconnect them/);
    expect(connectorRefusedNotice(['Plaud'], 'de')).toMatch(/^\n\n---\n_Ohne Plaud beantwortet: Der Connector hat/);
    expect(connectorRefusedNotice(['A', 'B'], 'de')).toMatch(/Die Connectors haben .* Verbinde sie neu/);
    expect(connectorRefusedNotice([], 'de')).toBe('');
  });

  it('web search: allowance used up, and not set up', () => {
    expect(allowanceNotice()).toMatch(/^\n\n---\n_The web searches included in your plan are used up for this month\./);
    expect(allowanceNotice('de')).toMatch(/Die Websuchen in deinem Plan sind für diesen Monat aufgebraucht\./);
    expect(webNotSetUpNotice()).toBe('\n\n---\n_Web search is not set up here. A workspace admin can add a search key in Settings → API & MCP → Web search._');
    expect(webNotSetUpNotice('de')).toMatch(/Die Websuche ist hier nicht eingerichtet\./);
  });

  it('every provider call carries the language down to its own notices', () => {
    const fn = read('supabase/functions/chat-message/index.ts');
    expect([...fn.matchAll(/\/\*\* SQEM-604 — the language of the notices this function adds to an answer\. \*\/\n {2}locale: Locale = 'en',/g)]).toHaveLength(4);
    expect(fn).not.toMatch(/'No content generated\.'/);
  });
});

describe('SQEM-604 — plurals', () => {
  it('one and several, in both languages', () => {
    expect(m.chat_file_count({ count: 1 }, { locale: 'en' })).toBe('1 file');
    expect(m.chat_file_count({ count: 3 }, { locale: 'en' })).toBe('3 files');
    expect(m.chat_file_count({ count: 1 }, { locale: 'de' })).toBe('1 Datei');
    expect(m.chat_file_count({ count: 3 }, { locale: 'de' })).toBe('3 Dateien');
  });
});

describe('SQEM-604 — provider errors keep their English exactly', () => {
  it('is busy / refused the key / generic — unchanged sentences', () => {
    expect(describeAIError(new Error('Gemini API error (503): {"error":{"message":"overloaded"}}'), 'x'))
      .toBe('Gemini is busy right now. They said: “overloaded”');
    expect(describeAIError(new Error('Claude API error (401): nope'), 'x'))
      .toBe('Claude refused the key. They said: “nope” Check the API key for this provider in Settings — it may be wrong, revoked, or out of quota.');
    expect(describeAIError(new Error('API error (418): teapot'), 'x')).toBe('The AI provider returned an error (418). They said: “teapot”');
  });
});
