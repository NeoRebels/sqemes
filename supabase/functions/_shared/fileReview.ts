// SQEM-519 (A) — what the marketplace knows about every file of a submission, decided from the BYTES.
//
// A marketplace listing is copied into other people's workspaces, and a skill may carry scripts their
// agents will run. Anthropic's guidance is to treat a third-party skill like installed software and
// review every file. No scan makes arbitrary code safe — a malicious script is ordinary text and in no
// signature database. What this module does is the deterministic part of a review:
//
//   REJECT  what has no business in a skill: executables, Office files with macros, nested archives
//   FLAG    what looks dangerous, with the reason: active PDF/SVG/HTML content, the injection scan over
//           every text file, code patterns (largely after Datadog's GuardDog heuristics), and every
//           host the files talk to
//   PIN     the exact bytes: a hash over every file, so what was reviewed is what gets copied
//
// A human approves every listing (the database refuses an approval without the file confirmation,
// SQEM-519 migration); this module decides what that human is shown. Pure: no Deno, no browser API
// beyond `crypto.subtle`, so the submit functions, the browser pre-check and the tests share it.

// ⛔ No import of `./injectionScan.ts`: it is Cloud-only and pruned from the self-host export (SQEM-182),
// while this module ships there (the copier's summary, `copySummaryOf`). The submit functions pass the
// scanner in; importing it here broke the exported build (measured 2026-10-17, unresolved import).
export type ScanRisk = 'low' | 'medium' | 'high';
export type TextScan = (text: string) => { risk: ScanRisk; reasons: string[] };
/** For a caller that only needs the refusals (the browser pre-check before upload). */
export const NO_TEXT_SCAN: TextScan = () => ({ risk: 'low', reasons: [] });
import { isUtf8Text, extensionOf, sniffBinaryMime } from './skillFile.ts';
import { isResourcePath } from './skillPaths.ts';

export interface ReviewInput {
  path: string;
  bytes: Uint8Array;
}

export type FileKind = 'text' | 'image' | 'pdf' | 'office' | 'binary';

export interface FileFlag {
  /** Stable id, e.g. `download-exec`. */
  rule: string;
  label: string;
  strong: boolean;
}

export interface ReviewedFile {
  path: string;
  size: number;
  sha256: string;
  kind: FileKind;
  /** The type the first bytes prove, when they prove one. */
  detected: string | null;
  /** True when the extension claims something the bytes are not (a ".png" that is a program). */
  mismatch: boolean;
  /** A script or asset an agent can run or use — the moderator must confirm having looked. */
  executable: boolean;
  flags: FileFlag[];
}

export interface FileReview {
  files: ReviewedFile[];
  /** Files that make the submission fail, with the reason shown to the submitter. */
  rejected: { path: string; reason: string }[];
  /** Every host a file refers to (URLs), sorted, without localhost. */
  hosts: string[];
  risk: ScanRisk;
  reasons: string[];
  /** Scripts, assets or anything not plain text: approval needs `files_confirmed`. */
  needsFileReview: boolean;
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));

/** Does the byte sequence contain this ASCII string anywhere? (ZIP entry names are stored uncompressed.) */
function containsAscii(b: Uint8Array, s: string): boolean {
  const n = ascii(s);
  outer: for (let i = 0; i <= b.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (b[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

/** What the first bytes say a binary IS, beyond the five types storage keeps as themselves. */
export function sniffExecutableOrArchive(b: Uint8Array): { kind: 'executable' | 'archive' | 'zip'; what: string } | null {
  if (startsWith(b, [0x4d, 0x5a])) return { kind: 'executable', what: 'Windows program (PE)' };
  if (startsWith(b, [0x7f, 0x45, 0x4c, 0x46])) return { kind: 'executable', what: 'Linux program (ELF)' };
  for (const sig of [[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe]]) {
    if (startsWith(b, sig)) return { kind: 'executable', what: 'macOS program (Mach-O)' };
  }
  if (startsWith(b, [0xca, 0xfe, 0xba, 0xbe])) return { kind: 'executable', what: 'macOS universal program or Java class' };
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06])) return { kind: 'zip', what: 'ZIP' };
  if (startsWith(b, [0x1f, 0x8b])) return { kind: 'archive', what: 'gzip archive' };
  if (startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { kind: 'archive', what: '7z archive' };
  if (startsWith(b, ascii('Rar!'))) return { kind: 'archive', what: 'RAR archive' };
  if (startsWith(b, ascii('BZh'))) return { kind: 'archive', what: 'bzip2 archive' };
  if (startsWith(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return { kind: 'archive', what: 'xz archive' };
  if (b.length > 262 && startsWith(b, ascii('ustar'), 257)) return { kind: 'archive', what: 'tar archive' };
  return null;
}

const MACRO_EXT = new Set(['docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppam', 'ppsm']);
const EXT_EXPECTS: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
};

// Code and text patterns. `strong` makes the submission high risk; the rest are context for the reviewer.
// Several follow Datadog GuardDog's source-code heuristics (download-executable, exec-base64,
// exfiltrate-sensitive-data, steganography/obfuscation, silent process execution) as regexes —
// GuardDog's own engine (Semgrep taint tracking) is a separate service and deliberately not here.
type CodeRule = { rule: string; label: string; strong: boolean; re: RegExp };
const CODE_RULES: CodeRule[] = [
  { rule: 'download-exec', strong: true, label: 'Downloads something and runs it (curl/wget piped to a shell, PowerShell download-and-execute)',
    re: /\b(curl|wget)\b[^\n|]{0,240}\|\s*(sudo\s+)?(ba|z|da)?sh\b|\b(iex|invoke-expression)\b[^\n]{0,120}\b(downloadstring|invoke-webrequest|iwr)\b|\b(downloadstring|invoke-webrequest)\b[^\n]{0,120}\|\s*(iex|invoke-expression)\b/i },
  { rule: 'decode-exec', strong: true, label: 'Decodes data and executes it (eval/exec of base64, marshal, zlib)',
    re: /\b(exec|eval)\s*\(\s*(base64\.b64decode|codecs\.decode|zlib\.decompress|marshal\.loads|atob\s*\(|Buffer\.from\([^)]*['"]base64['"])|base64\s+(-d|--decode)\b[^\n]{0,80}\|\s*(ba|z)?sh\b/i },
  { rule: 'credentials', strong: true, label: 'Reads credential stores (SSH/AWS keys, .netrc, keychains, browser profiles, /etc/shadow)',
    re: /~\/\.ssh\b|\.ssh\/id_[a-z0-9]+|~\/\.aws\b|\.aws\/credentials|\.netrc\b|\.git-credentials|\.npmrc\b|\.pypirc\b|\bsecurity\s+find-(generic|internet)-password\b|\bLogin Data\b|cookies\.sqlite|Local Storage\/leveldb|\/etc\/shadow\b/i },
  { rule: 'destructive', strong: true, label: 'Destructive command (deletes the home or root folder, overwrites a disk)',
    re: /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(\/(\s|$|\*)|~(\/|\s|$)|\$HOME\b)|shutil\.rmtree\(\s*['"](\/|~)['"]|\bmkfs(\.[a-z0-9]+)?\b|\bdd\s+if=[^\n]*\bof=\/dev\//i },
  { rule: 'persistence', strong: true, label: 'Installs itself to run again (crontab, launch agents, shell start-up files, Run keys)',
    re: /\bcrontab\s+(-[a-z]\s+)*[^\s-]|\bLaunch(Agents|Daemons)\b|>>\s*~?\/?\.?(bashrc|zshrc|bash_profile|profile)\b|\bsystemctl\s+enable\b|\bschtasks\s+\/create\b|CurrentVersion\\\\?Run\b/i },
  { rule: 'obfuscated', strong: false, label: 'Obfuscated code (long escaped byte strings or character arithmetic)',
    re: /(\\x[0-9a-f]{2}){60,}|(chr\(\s*\d+\s*\)\s*\+\s*){20,}|String\.fromCharCode\((\s*\d+\s*,){30,}/i },
  { rule: 'silent-process', strong: false, label: 'Starts processes hidden or detached from the user',
    re: /\bCREATE_NO_WINDOW\b|\bDETACHED_PROCESS\b|\bnohup\b[^\n]{0,80}&\s*$|\bsubprocess\.Popen\([^)]*start_new_session\s*=\s*True/im },
];

// Sending environment or files out needs two signals in the same file, as GuardDog's taint rule does:
// reading the environment, and a network call that sends.
const ENV_READ = /\bos\.environ\b|\bos\.getenv\(|\bprocess\.env\b|\bDeno\.env\b|\$\{?(ENV|HOME|USER|AWS_[A-Z_]+|[A-Z_]*TOKEN|[A-Z_]*KEY)\}?/;
const NET_SEND = /\brequests\.(post|put)\(|\bhttpx\.(post|put)\(|\burllib\.request\.(urlopen|Request)\(|\bhttp\.client\b|\bfetch\(\s*[^)]*method\s*:\s*['"](POST|PUT)|\baxios\.(post|put)\(|\bcurl\b[^\n]*\s(-d|--data|-F|--upload-file)\b|\bInvoke-RestMethod\b/i;

const URL_RE = /\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?/gi;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|example\.(com|org|net))$/i;

const SCRIPT_EXT = new Set(['py', 'js', 'mjs', 'cjs', 'ts', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'rb', 'pl', 'php', 'lua', 'r', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cpp', 'cs']);

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function activeContentFlags(path: string, text: string | null, bytes: Uint8Array, kind: FileKind): FileFlag[] {
  const flags: FileFlag[] = [];
  if (kind === 'pdf') {
    const latin = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4 * 1024 * 1024)));
    if (/\/JavaScript\b|\/JS\b/.test(latin)) flags.push({ rule: 'pdf-js', label: 'PDF contains JavaScript', strong: true });
    if (/\/OpenAction\b|\/AA\b/.test(latin)) flags.push({ rule: 'pdf-autorun', label: 'PDF runs an action when opened', strong: false });
    if (/\/Launch\b/.test(latin)) flags.push({ rule: 'pdf-launch', label: 'PDF can launch a program', strong: true });
    if (/\/EmbeddedFile\b/.test(latin)) flags.push({ rule: 'pdf-embedded', label: 'PDF carries embedded files', strong: false });
  }
  const ext = extensionOf(path);
  if (text != null && (ext === 'svg' || ext === 'html' || ext === 'htm' || ext === 'xhtml')) {
    if (/<script\b/i.test(text)) flags.push({ rule: 'markup-script', label: `${ext.toUpperCase()} contains a script element`, strong: true });
    if (/\son[a-z]+\s*=\s*["']/i.test(text)) flags.push({ rule: 'markup-handler', label: `${ext.toUpperCase()} contains event handlers`, strong: false });
    if (/javascript\s*:/i.test(text)) flags.push({ rule: 'markup-js-link', label: `${ext.toUpperCase()} contains javascript: links`, strong: true });
  }
  return flags;
}

/**
 * Reviews every file of a submission. `content` (the template body and description) is scanned too.
 * The fingerprint is not made here: `bundleHashOfZip` (submissionManifest.ts) hashes every ZIP entry,
 * the manifest included, which this function never sees.
 */
export async function reviewSubmissionFiles(inputs: ReviewInput[], content: string, scanText: TextScan): Promise<FileReview> {
  const files: ReviewedFile[] = [];
  const rejected: FileReview['rejected'] = [];
  const hosts = new Set<string>();
  const reasons = new Set<string>();
  let strong = false;
  let anyFlag = false;

  for (const { path, bytes } of inputs) {
    const ext = extensionOf(path);
    const sniffed = sniffBinaryMime(bytes);
    const exe = sniffed ? null : sniffExecutableOrArchive(bytes);
    let kind: FileKind;
    let detected: string | null = sniffed;
    let text: string | null = null;

    if (sniffed) kind = sniffed === 'application/pdf' ? 'pdf' : 'image';
    else if (exe?.kind === 'zip') {
      // Office (OOXML) and OpenDocument are ZIPs too — told apart by their own manifest entries.
      const isOoxml = containsAscii(bytes, '[Content_Types].xml');
      const isOdf = containsAscii(bytes, 'mimetypeapplication/vnd.oasis.opendocument');
      if (isOoxml || isOdf) {
        kind = 'office';
        detected = isOoxml ? 'Office document' : 'OpenDocument';
        if (MACRO_EXT.has(ext) || containsAscii(bytes, 'vbaProject.bin') || (isOdf && containsAscii(bytes, 'Basic/'))) {
          rejected.push({ path, reason: `"${path}" is an Office file with macros — macros do not belong in a marketplace listing` });
        }
      } else {
        kind = 'binary';
        detected = 'ZIP archive';
        rejected.push({ path, reason: `"${path}" is an archive inside the bundle — its contents cannot be reviewed; add the files themselves` });
      }
    } else if (exe?.kind === 'archive') {
      kind = 'binary';
      detected = exe.what;
      rejected.push({ path, reason: `"${path}" is a ${exe.what} — its contents cannot be reviewed; add the files themselves` });
    } else if (exe?.kind === 'executable') {
      kind = 'binary';
      detected = exe.what;
      rejected.push({ path, reason: `"${path}" is a ${exe.what} — programs do not belong in a marketplace listing` });
    } else if (isUtf8Text(bytes)) {
      kind = 'text';
      text = new TextDecoder('utf-8').decode(bytes);
    } else {
      kind = 'binary';
    }

    const flags: FileFlag[] = [];
    const expects = EXT_EXPECTS[ext];
    const mismatch = !!expects && expects !== sniffed;
    if (mismatch) flags.push({ rule: 'type-mismatch', label: `Named .${ext} but the bytes are ${detected ?? kind}`, strong: kind === 'binary' });

    flags.push(...activeContentFlags(path, text, bytes, kind));
    if (text != null) {
      for (const r of CODE_RULES) if (r.re.test(text)) flags.push({ rule: r.rule, label: r.label, strong: r.strong });
      if (ENV_READ.test(text) && NET_SEND.test(text)) {
        flags.push({ rule: 'env-exfil', label: 'Reads the environment and sends data over the network', strong: true });
      }
      const inj = scanText(text);
      if (inj.risk !== 'low') flags.push({ rule: 'injection', label: `Prompt-injection signals: ${inj.reasons.join('; ')}`, strong: inj.risk === 'high' });
      for (const m of text.matchAll(URL_RE)) {
        const h = m[1].toLowerCase();
        if (!LOCAL_HOST.test(h)) hosts.add(h);
      }
    }

    for (const f of flags) {
      anyFlag = true;
      if (f.strong) strong = true;
      reasons.add(`${path}: ${f.label}`);
    }
    files.push({
      path, size: bytes.length, sha256: await sha256Hex(bytes), kind, detected, mismatch,
      executable: isResourcePath(path) || SCRIPT_EXT.has(ext) || kind === 'binary' || kind === 'office',
      flags,
    });
  }

  const listing = scanText(content);
  for (const r of listing.reasons) reasons.add(`listing text: ${r}`);
  for (const m of content.matchAll(URL_RE)) { const h = m[1].toLowerCase(); if (!LOCAL_HOST.test(h)) hosts.add(h); }

  const risk: ScanRisk = strong || listing.risk === 'high' ? 'high' : anyFlag || listing.risk === 'medium' ? 'medium' : 'low';
  return {
    files, rejected, hosts: [...hosts].sort(), risk, reasons: [...reasons],
    needsFileReview: files.some(f => f.executable || f.kind !== 'text'),
  };
}

/** What a person copying the listing is told (no internal flags): counts and hosts. */
export interface CopySummary {
  scripts: number;
  binaries: number;
  textFiles: number;
  hosts: string[];
}

export function copySummaryOf(review: Pick<FileReview, 'files' | 'hosts'>): CopySummary {
  return {
    scripts: review.files.filter(f => f.kind === 'text' && (SCRIPT_EXT.has(extensionOf(f.path)) || /(^|\/)scripts\//.test(f.path))).length,
    binaries: review.files.filter(f => f.kind !== 'text').length,
    textFiles: review.files.filter(f => f.kind === 'text').length,
    hosts: review.hosts,
  };
}
