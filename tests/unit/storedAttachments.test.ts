import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitStoredAttachments } from '../../lib/storedAttachments';

// SQEM-699 — a reloaded chat says an attachment is gone instead of showing "[Attachment: DOCX]".
describe('splitStoredAttachments', () => {
  it('takes the trailing attachment lines off and names their types', () => {
    expect(splitStoredAttachments('Was steht drin?\n[Attachment: DOCX]\n[Attachment: image/png]'))
      .toEqual({ text: 'Was steht drin?', lost: ['DOCX', 'image/png'] });
  });
  it('a message without attachments is unchanged', () => {
    expect(splitStoredAttachments('Hallo\nWelt')).toEqual({ text: 'Hallo\nWelt', lost: [] });
  });
  it('only the trailing lines: the same text inside a message is left alone', () => {
    expect(splitStoredAttachments('[Attachment: DOCX] steht hier mitten\nim Text')).toEqual({ text: '[Attachment: DOCX] steht hier mitten\nim Text', lost: [] });
  });
  it('a message that was only an attachment', () => {
    expect(splitStoredAttachments('[Attachment: PDF]')).toEqual({ text: '', lost: ['PDF'] });
  });
});

describe('what is stored', () => {
  it('the line the page writes is the one this module reads, with the type, not the file name', () => {
    const chat = readFileSync(resolve(__dirname, '../../pages/Chat.tsx'), 'utf8');
    expect(chat).toContain('`[Attachment: ${a.label ?? a.mimeType}]`');
  });
});
