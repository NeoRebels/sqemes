import { TEXT_EXT_TO_MIME, OCTET_STREAM, extensionOf } from '../supabase/functions/_shared/skillFile.ts';

export const SUPPORTED_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown',
]);

// Text/code extensions → a specific mime, used for the file-type label. The bytes are
// stored as text/plain to pass the storage bucket allowlist; this mapping is label-only.
// SQEM-514 — one table for browser and edge (was a near-copy of TEXT_MIME in mcp-server).
export { TEXT_EXT_TO_MIME };

// Chat composer (ephemeral inline attachments) — the narrow directly-storable set.
export const ACCEPT_STRING = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown',
  '.txt', '.csv', '.md',
].join(',');

// Files page (workspace context files) — adds the full text/code set, stored as text/plain.
export const FILE_ACCEPT_STRING = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf',
  ...Object.keys(TEXT_EXT_TO_MIME).map(ext => `.${ext}`),
].join(',');

export const MAX_FILE_SIZE_MB = 15;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export const isImageType = (mimeType: string) => mimeType.startsWith('image/');

/**
 * SQEM-562 — what the Files page counts as "Media": images, video and audio.
 *
 * ⚠️ By type OR extension, because the type alone misses most of them. The Files page uploads only
 * images, PDF and text, so video, audio and SVG arrive through a skill import or MCP — and there the
 * row type is decided from the bytes (`classifySkillFile`): an .mp4 is stored as
 * `application/octet-stream`, an .svg as text. Filtering by `image/*` alone filed both under
 * "Documents". The preview thumbnail and the icon stay on `isImageType`: only a real image has one.
 */
export const MEDIA_EXTENSIONS = new Set(['svg', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a', 'ogg']);

export function isMediaFile(name: string, mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/')
    || MEDIA_EXTENSIONS.has(extensionOf(name));
}
export const isTextType  = (mimeType: string) => mimeType.startsWith('text/');

/** Specific mime for a text/code file by extension, or null if it's not a known text type. */
export function inferTextMime(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return TEXT_EXT_TO_MIME[ext] ?? null;
}

/**
 * Short type label. SQEM-514: a skill file stored as `text/plain` or `application/octet-stream` is
 * labelled by its extension when a name is given — an .svg is text/plain and still reads "SVG".
 */
export function fileTypeLabel(mimeType: string, name?: string): string {
  if (name && (mimeType === 'text/plain' || mimeType === OCTET_STREAM)) {
    const ext = extensionOf(name);
    if (ext && ext.length <= 6) return ext.toUpperCase();
  }
  switch (mimeType) {
    // Documents
    case 'application/pdf':     return 'PDF';
    case 'application/msword':  return 'DOC';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': return 'DOCX';
    case 'application/vnd.ms-excel': return 'XLS';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': return 'XLSX';
    case 'application/vnd.ms-powerpoint': return 'PPT';
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation': return 'PPTX';
    // Images
    case 'image/png':  return 'PNG';
    case 'image/jpeg': return 'JPG';
    case 'image/webp': return 'WEBP';
    case 'image/gif':  return 'GIF';
    case 'image/svg+xml': return 'SVG';
    // Plain text
    case 'text/plain':    return 'TXT';
    case 'text/csv':      return 'CSV';
    case 'text/markdown': return 'MD';
    case 'text/x-rst':    return 'RST';
    case 'text/html':     return 'HTML';
    case 'text/css':      return 'CSS';
    case 'text/x-scss':   return 'SCSS';
    case 'text/x-sass':   return 'SASS';
    case 'text/xml':      return 'XML';
    case 'text/yaml':     return 'YAML';
    // Data / config
    case 'application/json': return 'JSON';
    case 'application/toml': return 'TOML';
    case 'application/sql':  return 'SQL';
    // Code
    case 'text/javascript': return 'JS';
    case 'text/typescript': return 'TS';
    case 'text/jsx':        return 'JSX';
    case 'text/tsx':        return 'TSX';
    case 'text/x-python':   return 'PY';
    case 'text/x-ruby':     return 'RB';
    case 'text/x-go':       return 'GO';
    case 'text/x-rust':     return 'RS';
    case 'text/x-java':     return 'JAVA';
    case 'text/x-php':      return 'PHP';
    case 'text/x-swift':    return 'SWIFT';
    case 'text/x-kotlin':   return 'KT';
    case 'text/x-csharp':   return 'CS';
    case 'text/x-c':        return 'C';
    case 'text/x-c++':      return 'CPP';
    case 'text/x-sh':       return 'SH';
    default:                return 'FILE';
  }
}
