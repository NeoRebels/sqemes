/**
 * SQEM-530 — the MCP request body is read with a ceiling.
 *
 * ⛔ **Why a ceiling at all.** An edge worker has 256 MB, and a tool call costs about ten times its body
 * before the handler is done: the region forward keeps the bytes, `req.json()` builds a string and an
 * object, `upload_file` then a `Blob` and a `TextEncoder` copy. Measured on 2026-10-19 with that exact
 * sequence: 5 MB of content → +64 MB, 15 MB → +159 MB, 30 MB → +309 MB. Past the limit the worker is killed (546 "Memory limit
 * exceeded") and the client gets nothing it can act on. One worker serves several requests at once,
 * so the margin is shared.
 *
 * **Why 5 MB.** It is far above any text a tool takes (a playbook, a reference file), and it is the size
 * at which a worker stays well inside its limit even with a neighbour. Anything larger is a file, and
 * files go out of band: `create_upload_url` + PUT + `finalize_upload`, which never pass through the
 * function's memory. The error says exactly that, so a client can recover on its own.
 *
 * Imports nothing, so `tests/unit/mcpRequestBody.test.ts` runs it under Node.
 */
export const MCP_MAX_BODY_BYTES = 5 * 1024 * 1024;

/** The declared size, or null when the client sent none (chunked) or nonsense. */
export function declaredLength(headers: Headers): number | null {
  const n = Number(headers.get('content-length'));
  return Number.isFinite(n) && n >= 0 && headers.has('content-length') ? n : null;
}

export type BodyResult =
  | { ok: true; v: unknown }
  | { ok: false; tooLarge: false }
  | { ok: false; tooLarge: true; bytes: number };

/**
 * Parse the JSON body, refusing anything over `max` bytes. A declared length over the ceiling is refused
 * without reading a byte; a body without one is read as a stream and abandoned the moment it passes.
 */
export async function readJsonCapped(req: Request, max = MCP_MAX_BODY_BYTES): Promise<BodyResult> {
  const declared = declaredLength(req.headers);
  if (declared !== null && declared > max) {
    await req.body?.cancel().catch(() => {});
    return { ok: false, tooLarge: true, bytes: declared };
  }
  const reader = req.body?.getReader();
  if (!reader) return { ok: false, tooLarge: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        return { ok: false, tooLarge: true, bytes: total };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
    return { ok: true, v: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

/** What a client reads when its call was too big — with the way out, so it can retry correctly. */
export function tooLargeMessage(bytes: number, max = MCP_MAX_BODY_BYTES): string {
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
  return `This request is ${mb(bytes)}; a single MCP call may carry at most ${mb(max)}. `
    + 'Send a file through create_upload_url (PUT the bytes to the returned URL), then finalize_upload — '
    + 'that path takes any file up to the storage limit and does not count against this one.';
}
