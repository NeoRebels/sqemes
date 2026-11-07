// SQEM-514 — one rule for what a file in a skill IS, shared by the browser and the edge functions.
//
// A skill is a folder (Agent Skills spec): any file may be in it — schemas, scripts, fonts, templates.
// Until SQEM-514 Sqemes decided by extension lists, five of them, each slightly different, and dropped
// whatever none of them named (172 of 420 files in Anthropic's public skills). Now:
//
//   PNG/JPEG/GIF/WebP/PDF = their type, when the first bytes prove it (checked FIRST: an all-ASCII
//                           PDF is valid UTF-8)
//   text      = otherwise valid UTF-8 without a NUL byte, whatever the extension says
//   the rest  = application/octet-stream
//
// ⛔ The INVARIANT every reader depends on: a text file's row `mime_type` passes `isTextContentMime`
// (libraryQueries.ts), and nothing else does. The readers — MCP, chat, execute-step, the browser —
// decide "text or not" from that column, so this module only ever hands out `text/*` (or the three
// `application/*` text types already in that function) for text. The label in the UI comes from the
// file name, not from this type (an .svg is stored as text/plain and still reads "SVG").
//
// Plain TypeScript with no Deno or browser API, so both sides import it (precedent: authoringPrompts.ts).

import { officeKindOf, OFFICE_MIME } from './officeText.ts';

/** Extension → the row type for a TEXT file. Label and reader hint only; the bytes are stored as text/plain. */
export const TEXT_EXT_TO_MIME: Record<string, string> = {
  txt: 'text/plain', text: 'text/plain', log: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown', markdown: 'text/markdown', mdx: 'text/markdown',
  rst: 'text/x-rst',
  html: 'text/html', htm: 'text/html',
  css: 'text/css', scss: 'text/x-scss', sass: 'text/x-sass',
  xml: 'text/xml', yaml: 'text/yaml', yml: 'text/yaml',
  json: 'application/json', toml: 'application/toml', sql: 'application/sql',
  js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  ts: 'text/typescript', jsx: 'text/jsx', tsx: 'text/tsx',
  py: 'text/x-python', rb: 'text/x-ruby', go: 'text/x-go', rs: 'text/x-rust',
  java: 'text/x-java', php: 'text/x-php', swift: 'text/x-swift',
  kt: 'text/x-kotlin', kts: 'text/x-kotlin', cs: 'text/x-csharp',
  c: 'text/x-c', h: 'text/x-c', cpp: 'text/x-c++', cc: 'text/x-c++', hpp: 'text/x-c++',
  sh: 'text/x-sh', bash: 'text/x-sh',
};

/** The only binary types stored as themselves; everything else binary is octet-stream. */
export const BINARY_EXT_TO_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
};

export const OCTET_STREAM = 'application/octet-stream';

/** The readers' test for "text": what every text row's `mime_type` passes, and nothing binary does. */
export function isTextContentMime(mime: string): boolean {
  return mime.startsWith('text/')
    || mime === 'application/json'
    || mime === 'application/toml'
    || mime === 'application/sql';
}
export const STORAGE_TEXT_MIME = 'text/plain';

/**
 * SQEM-658 — the ONE size limit for a workspace file: upload (app and MCP) and reading as text follow
 * it ("if the upload size changes, reading must change with it"). The bucket
 * enforces the same number (`storage.buckets.file_size_limit`, set in a migration);
 * `tests/unit/officeAttachment.test.ts` fails when the two drift apart.
 */
export const MAX_FILE_SIZE_MB = 15;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/** Every content type an object in `workspace-files` can be stored with — must match the bucket allowlist. */
export const SKILL_STORAGE_MIMES: readonly string[] = [
  STORAGE_TEXT_MIME, 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', OCTET_STREAM,
];

export function extensionOf(name: string): string {
  const base = String(name ?? '').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Valid UTF-8 without a NUL byte. UTF-16 text counts as binary (it is full of NULs). */
export function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** The binary type the first bytes prove, or null. An extension alone never makes a file an image. */
export function sniffBinaryMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

export interface SkillFileType {
  /** `workspace_files.mime_type` — what every reader decides by. */
  rowMime: string;
  /** Content type of the storage object. */
  storageMime: string;
  isText: boolean;
}

export function classifySkillFile(name: string, bytes: Uint8Array): SkillFileType {
  // Signature first: a PDF written in plain ASCII is valid UTF-8 and would otherwise count as text.
  const sniffed = sniffBinaryMime(bytes);
  if (sniffed) return { rowMime: sniffed, storageMime: sniffed, isText: false };
  // SQEM-658 — a Word/Excel/PowerPoint file (a ZIP with the matching extension) keeps its Office type
  // on the row, so every upload path labels it alike; stored as octet-stream (the bucket allowlist).
  const office = officeKindOf(name);
  if (office && startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return { rowMime: OFFICE_MIME[office], storageMime: OCTET_STREAM, isText: false };
  if (isUtf8Text(bytes)) {
    return { rowMime: TEXT_EXT_TO_MIME[extensionOf(name)] ?? STORAGE_TEXT_MIME, storageMime: STORAGE_TEXT_MIME, isText: true };
  }
  return { rowMime: OCTET_STREAM, storageMime: OCTET_STREAM, isText: false };
}

/**
 * How MCP `read_context_file` hands a file out — ONE rule since SQEM-658:
 * what sqemes can read as text (a text file, a .docx/.xlsx/.pptx) comes back as text, wherever it
 * sits; everything else (fonts, images, PDF, archives) as a download link. `as: "file"` gives the
 * original of any file, `as: "text"` on something unreadable is refused rather than answered with
 * garbage.
 *
 * ⚠️ SQEM-514 had split by FOLDER (Agent Skills: `references/` read, `scripts/`/`assets/` used, as a
 * link). That was retired: sqemes' Files page has no such folders, so it was a rule users could
 * neither see nor follow, and a link alone is useless where no sandbox can fetch it (sqemes Chat,
 * ChatGPT in chat mode). A client that installs whole skills still gets the folder from
 * `download_skill`; a link is never sent unasked because on Cloud every link counts against the
 * workspace's daily download ceiling (SQEM-515).
 */
export type Delivery = 'text' | 'link' | 'refuse';

export function deliveryOf(name: string, mimeType: string, as?: unknown): Delivery {
  // SQEM-658 — a Word, Excel or PowerPoint file has text the server reads out of it; its row stays a binary.
  const readable = isTextContentMime(mimeType) || officeKindOf(name) !== null;
  if (as === 'file') return 'link';
  return readable ? 'text' : (as === 'text' ? 'refuse' : 'link');
}
