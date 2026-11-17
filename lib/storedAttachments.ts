/**
 * SQEM-699 — what is left of a chat attachment after a reload.
 *
 * An attachment's content lives only in the browser and is never stored (privacy: nothing a person
 * attaches is kept). The stored user message carries one line per attachment instead, written by
 * `pages/Chat.tsx` as `[Attachment: DOCX]` — the file type, never the file name.
 * After a reload the model gets that line and asks for the file again, which is right; this module
 * lets the page say the same thing to the person instead of showing the raw line.
 */
const LINE = /^\[Attachment: ([^\]\n]{1,80})\]$/;

/** The text of a stored message without its trailing attachment lines, and the types those lines name. */
export function splitStoredAttachments(content: string): { text: string; lost: string[] } {
  const lines = content.split('\n');
  const lost: string[] = [];
  while (lines.length) {
    const match = lines[lines.length - 1].trim().match(LINE);
    if (!match) break;
    lost.unshift(match[1]);
    lines.pop();
  }
  return { text: lines.join('\n').trimEnd(), lost };
}
