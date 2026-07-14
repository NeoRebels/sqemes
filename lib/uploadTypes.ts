export const SUPPORTED_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown',
]);

// Text/code extensions → a specific mime, used for the file-type label. The bytes are
// stored as text/plain to pass the storage bucket allowlist; this mapping is label-only.
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
export const isTextType  = (mimeType: string) => mimeType.startsWith('text/');

/** Specific mime for a text/code file by extension, or null if it's not a known text type. */
export function inferTextMime(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return TEXT_EXT_TO_MIME[ext] ?? null;
}

export function fileTypeLabel(mimeType: string): string {
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
