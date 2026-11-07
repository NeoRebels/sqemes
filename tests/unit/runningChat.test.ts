import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  startRunning, updateRunning, finishRunning, failRunning, endRunning, takeFinished, clearFailed,
  getRunningChat, subscribeRunningChat, resetRunningChat, runningBubble, withRunningAnswer, type RunningMsg,
} from '../../lib/runningChat';

// SQEM-657 — the running answer lives outside the chat page, so it survives a chat switch and a page
// change. These tests pin the module; the last block pins how the page uses it.

const user = (id: string): RunningMsg => ({ id, role: 'user', content: 'Frage' });
const answer = (id: string): RunningMsg => ({ id, role: 'assistant', content: 'Antwort' });

function start(sessionId: string | null = 'A') {
  return startRunning({ sessionId, userMsg: user('u1'), model: '', controller: new AbortController() });
}

beforeEach(() => resetRunningChat());

describe('SQEM-657 — lib/runningChat', () => {
  it('a new answer is running, and clears the previous error', () => {
    const first = start();
    failRunning(first, 'kaputt', null);
    expect(getRunningChat().failed?.message).toBe('kaputt');
    start();
    expect(getRunningChat().running).not.toBeNull();
    expect(getRunningChat().failed).toBeNull();
  });

  it('every change is a new state object (what useSyncExternalStore needs) and notifies', () => {
    let calls = 0;
    const off = subscribeRunningChat(() => { calls++; });
    const run = start();
    const before = getRunningChat();
    updateRunning(run, { text: 'Hallo' });
    expect(getRunningChat()).not.toBe(before);
    expect(calls).toBe(2);
    off();
    updateRunning(run, { text: 'Hallo Welt' });
    expect(calls).toBe(2);
  });

  it('⛔ the page and the send handler hold the SAME object — a Stop from the page reaches the handler', () => {
    const run = start();
    const fromPage = getRunningChat().running!;
    updateRunning(fromPage, { stopped: true });
    expect(run.stopped).toBe(true);
  });

  it('⛔ text is replaced, never appended (deltas carry the whole text so far)', () => {
    const run = start();
    updateRunning(run, { jobId: 'j', assistantMsgId: 'a1' });
    updateRunning(run, { text: 'Hal' });
    updateRunning(run, { text: 'Hallo' });
    expect(runningBubble(run)!.content).toBe('Hallo');
  });

  it('the bubble thinks until the first text, then shows it; it carries "continuing"', () => {
    const run = start();
    expect(runningBubble(run)).toBeNull(); // no answer id yet — nothing to draw
    updateRunning(run, { jobId: 'j', assistantMsgId: 'a1', model: 'GPT' });
    expect(runningBubble(run)).toMatchObject({ id: 'a1', role: 'assistant', content: '', pending: true, model: 'GPT' });
    updateRunning(run, { text: 'x', continuing: true });
    expect(runningBubble(run)).toMatchObject({ pending: false, continuing: true });
  });

  it('finish hands the message to its chat; take removes it', () => {
    const run = start('A');
    finishRunning(run, answer('a1'));
    expect(getRunningChat().running).toBeNull();
    expect(getRunningChat().finished).toEqual({ sessionId: 'A', msg: answer('a1') });
    takeFinished('other');
    expect(getRunningChat().finished).not.toBeNull();
    takeFinished('a1');
    expect(getRunningChat().finished).toBeNull();
  });

  it('a failure belongs to its chat and can be cleared', () => {
    const run = start('A');
    failRunning(run, 'Zu groß', 'context_overflow');
    expect(getRunningChat().failed).toEqual({ sessionId: 'A', message: 'Zu groß', code: 'context_overflow' });
    clearFailed();
    expect(getRunningChat().failed).toBeNull();
  });

  it('⛔ a stale handler cannot touch the next answer (New chat abandoned it)', () => {
    const old = start('A');
    endRunning(old);
    const next = start('B');
    updateRunning(old, { text: 'alt' });
    finishRunning(old, answer('old'));
    failRunning(old, 'alt', null);
    endRunning(old);
    expect(getRunningChat().running).toBe(next);
    expect(next.text).toBe('');
    expect(getRunningChat().finished).toBeNull();
    expect(getRunningChat().failed).toBeNull();
  });

  it('end after finish is a no-op (the finally block)', () => {
    const run = start('A');
    finishRunning(run, answer('a1'));
    endRunning(run);
    expect(getRunningChat().finished?.msg.id).toBe('a1');
  });

  it('a new chat: the answer joins its chat once the row exists', () => {
    const run = start(null);
    updateRunning(run, { sessionId: 'NEW', jobId: 'j', assistantMsgId: 'a1' });
    expect(withRunningAnswer([], getRunningChat(), 'NEW').map(m => m.id)).toEqual(['u1', 'a1']);
  });
});

describe('SQEM-657 — withRunningAnswer', () => {
  it('back in the running chat after the history load: question and bubble come back', () => {
    const run = start('A');
    updateRunning(run, { jobId: 'j', assistantMsgId: 'a1', text: 'bis hier' });
    const shown = withRunningAnswer([user('old')], getRunningChat(), 'A');
    expect(shown.map(m => m.id)).toEqual(['old', 'u1', 'a1']);
    expect(shown[2].content).toBe('bis hier');
  });

  it('the question already stored is not shown twice', () => {
    const run = start('A');
    updateRunning(run, { jobId: 'j', assistantMsgId: 'a1' });
    expect(withRunningAnswer([user('u1')], getRunningChat(), 'A').map(m => m.id)).toEqual(['u1', 'a1']);
  });

  it('another chat shows nothing of it', () => {
    const run = start('A');
    updateRunning(run, { jobId: 'j', assistantMsgId: 'a1' });
    const msgs = [user('b')];
    expect(withRunningAnswer(msgs, getRunningChat(), 'B')).toBe(msgs);
  });

  it('a finished answer shows in its chat until taken, never twice', () => {
    const run = start('A');
    finishRunning(run, answer('a1'));
    expect(withRunningAnswer([user('u1')], getRunningChat(), 'A').map(m => m.id)).toEqual(['u1', 'a1']);
    expect(withRunningAnswer([user('u1'), answer('a1')], getRunningChat(), 'A').map(m => m.id)).toEqual(['u1', 'a1']);
    expect(withRunningAnswer([user('u1')], getRunningChat(), 'B').map(m => m.id)).toEqual(['u1']);
  });
});

describe('SQEM-657 — the chat page reads it', () => {
  const chat = readFileSync('pages/Chat.tsx', 'utf8');

  it('the module imports no Supabase (it must load without env vars)', () => {
    expect(readFileSync('lib/runningChat.ts', 'utf8')).not.toMatch(/from ['"][^'"]*supabase/);
  });
  it('no page-level running state is left', () => {
    expect(chat).not.toMatch(/runningJobRef|streamedTextRef|abortControllerRef|setIsLoading|setError\(/);
    expect(chat).toMatch(/useSyncExternalStore\(subscribeRunningChat, getRunningChat<ChatMsg>\)/);
  });
  it('the list shows the running answer of this chat', () => {
    expect(chat).toMatch(/withRunningAnswer\(messages, runningChat, sessionId\)/);
    expect(chat).toMatch(/\{shownMessages\.map\(\(msg, index\) => \(/);
  });
  it('Stop only in the chat whose answer runs; elsewhere Send is locked and says why', () => {
    expect(chat).toMatch(/\{generatingHere \? \(\s*<button onClick=\{handleStop\}/);
    expect(chat).toMatch(/disabled=\{isLoading \|\| !input\.trim\(\)/);
    expect(chat).toMatch(/isLoading && !generatingHere && \([\s\S]{0,400}chat_running_elsewhere/);
  });
  it('the hint is a card as wide as the composer, like the other chat notices (not a full-width strip)', () => {
    const hint = chat.match(/isLoading && !generatingHere && \(([\s\S]*?)chat_running_elsewhere/)![1];
    expect(hint).toMatch(/max-w-3xl mx-auto p-3 rounded-xl border border-line bg-surface-sunken text-sm/);
    expect(hint).not.toMatch(/border-t/);
  });
  it('"someone is waiting" is the same card, in amber', () => {
    const hint = chat.match(/otherIsGenerating && \(([\s\S]*?)chat_someone_waiting/)![1];
    expect(hint).toMatch(/max-w-3xl mx-auto p-3 rounded-xl border border-amber-100/);
    expect(hint).not.toMatch(/border-t/);
  });
  it('"someone is waiting" is never about our own answer', () => {
    expect(chat).toMatch(/const otherIsGenerating = !!activeSession\?\.isGenerating && !generatingHere;/);
  });
  it('the error is the one of this chat', () => {
    expect(chat).toMatch(/runningChat\.failed && runningChat\.failed\.sessionId === sessionId/);
  });
  it('both languages', () => {
    const en = JSON.parse(readFileSync('messages/en.json', 'utf8'));
    const de = JSON.parse(readFileSync('messages/de.json', 'utf8'));
    expect(en.chat_running_elsewhere).toBeTruthy();
    expect(de.chat_running_elsewhere).toBeTruthy();
  });
});
