// SQEM-514 — the only file parts a model is ever sent: text, PDF and the four raster image types.
//
// chat-message and execute-step translate an `inlineData` part per provider as "text/* → text, PDF →
// document, ANYTHING ELSE → image". That was safe only because nothing but images and PDFs could be
// stored. Since SQEM-514 a skill may carry fonts, archives and office files (stored as
// application/octet-stream); sent down the image branch they make the provider reject the whole
// request. This runs once on the way in, so every provider branch below can keep its shape.

const SENDABLE_BINARY = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function isSendableMime(mime: string): boolean {
  const m = String(mime ?? '').toLowerCase();
  return m.startsWith('text/') || SENDABLE_BINARY.has(m);
}

type Part = { text?: string; inlineData?: { mimeType: string; data: string } } & Record<string, unknown>;

/** Replaces an inlineData part the providers cannot take with a short text part saying so. */
export function dropUnsendableParts<T>(parts: T): T {
  if (!Array.isArray(parts)) return parts;
  return parts.map((p: Part) => (p && p.inlineData && !isSendableMime(p.inlineData.mimeType)
    ? { text: `[A binary file (${p.inlineData.mimeType}) was attached; it is not readable here.]` }
    : p)) as unknown as T;
}

/** The same for a chat history: every message whose content is a parts array. */
export function dropUnsendableInMessages<T extends { content: unknown }>(messages: T[]): T[] {
  return messages.map(m => (Array.isArray(m.content) ? { ...m, content: dropUnsendableParts(m.content) } : m));
}
