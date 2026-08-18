// SQEM-248 — what the server is willing to download, where the skill sits inside it, and the
// download itself.
//
// **No zip, no Deno globals, no Supabase.** Everything here is either pure or plain `fetch`, so the
// rules that decide which URL we talk to are testable from the browser test runner where the rest of
// this repo's unit tests live (`tests/unit/skillImport.test.ts`) — and `downloadArchive` can be run
// against a real archive from a plain Node script without standing anything in for it. The
// *unpacking* and everything touching storage stays in `mcp-server`, next to the service-role key.
//
// The redirect loop lives here rather than beside its caller on purpose: it is not transport, it is
// the allowlist being enforced a second time, and the two belong within sight of each other.

/**
 * The only hosts the importer will talk to.
 *
 * **An allowlist, not a denylist, and that is the whole SSRF containment.** This code runs in an
 * edge function that holds the service-role key and sits inside Supabase's network; "anything that
 * does not look internal" is the wrong default there, because the list of things that look internal
 * is not knowable from here.
 *
 * All four hosts are needed for *one* download: `github.com` is what a person pastes,
 * `api.github.com` is where we send the zipball request, and it redirects through `codeload` and
 * `objects.githubusercontent.com`. Drop one and the redirect chain dies halfway with a confusing
 * error rather than a refusal.
 */
export const ALLOWED_ARCHIVE_HOSTS = [
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
];

export function isAllowedArchiveHost(host: string): boolean {
  return ALLOWED_ARCHIVE_HOSTS.includes(host.toLowerCase());
}

export type ResolvedArchive = {
  /** The zip we will actually request. */
  archiveUrl: string;
  /** A folder inside the archive, when the link pointed at one. */
  subPath: string | null;
};

/**
 * Turn the link a person copied out of their address bar into an archive URL.
 *
 * Accepted, in the order people actually produce them:
 *   https://github.com/owner/repo                       → the default branch, whatever it is called
 *   https://github.com/owner/repo/tree/ref/some/folder  → that ref, that folder
 *   any allowed host, path ending in .zip               → taken as is
 *
 * `zipball` without a ref resolves the default branch server-side, which is why this does not guess
 * between `main` and `master` — a guess would fail on exactly the older repositories most likely to
 * carry a skill worth importing.
 *
 * Known limit, stated rather than silently mishandled: a **ref containing a slash**
 * (`tree/feature/x/...`) cannot be told apart from a folder path in this URL shape. Such a link is
 * read as ref `feature` — pass the repo URL plus `path` instead.
 */
export function resolveArchiveUrl(input: string): ResolvedArchive {
  let url: URL;
  try {
    url = new URL(String(input ?? '').trim());
  } catch {
    throw new Error(`Not a URL: ${input}`);
  }

  if (url.protocol !== 'https:') throw new Error('Only https URLs can be imported.');
  if (!isAllowedArchiveHost(url.hostname)) {
    throw new Error(
      `Refusing to download from ${url.hostname}. Accepted hosts: ${ALLOWED_ARCHIVE_HOSTS.join(', ')}. ` +
      `To import from elsewhere, download the folder and use the Sqemes app's skill import.`,
    );
  }

  if (url.hostname.toLowerCase() === 'github.com') {
    const [owner, repoRaw, kind, ref, ...rest] = url.pathname.split('/').filter(Boolean);
    if (!owner || !repoRaw) throw new Error('That GitHub URL names no repository.');
    const repo = repoRaw.replace(/\.git$/, '');

    if (!kind) return { archiveUrl: `https://api.github.com/repos/${owner}/${repo}/zipball`, subPath: null };
    if (kind === 'tree' && ref) {
      return {
        archiveUrl: `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(ref)}`,
        subPath: rest.length ? rest.join('/') : null,
      };
    }
    if (kind === 'archive' && url.pathname.endsWith('.zip')) return { archiveUrl: url.toString(), subPath: null };

    throw new Error(
      'Point at the repository (https://github.com/owner/repo) or at a folder in it ' +
      '(https://github.com/owner/repo/tree/main/skills/my-skill).',
    );
  }

  if (url.pathname.toLowerCase().endsWith('.zip')) return { archiveUrl: url.toString(), subPath: null };
  throw new Error(`That URL is not a .zip archive: ${url.toString()}`);
}

export const SKILL_ENTRY = 'SKILL.md';

/** Zip entries no archive meant to ship — a Mac packs them in, GitHub does not. */
export function isArchiveJunk(path: string): boolean {
  return path.startsWith('__MACOSX/') || path === '.DS_Store' || path.endsWith('/.DS_Store');
}

/**
 * Find the folder that *is* the skill, and return its prefix (with trailing slash, or `''` at the
 * archive root). A GitHub zipball wraps everything in `owner-repo-sha/`, so searching for the
 * SKILL.md rather than assuming a depth is what makes the wrapper a non-issue.
 *
 * **Ambiguity is refused, not resolved.** A repository can hold several skills (`skills/a`,
 * `skills/b`); picking the first would import something the caller did not ask for and say nothing —
 * which is the exact failure mode SQEM-248 exists to end.
 */
export function findSkillRoot(paths: string[], subPath?: string | null): string {
  const entries = paths.filter((p) => !isArchiveJunk(p));
  let candidates = entries.filter((p) => p === SKILL_ENTRY || p.endsWith(`/${SKILL_ENTRY}`));

  const want = (subPath ?? '').replace(/^\/+|\/+$/g, '');
  if (want) {
    const narrowed = candidates.filter((p) => p === `${want}/${SKILL_ENTRY}` || p.endsWith(`/${want}/${SKILL_ENTRY}`));
    if (!narrowed.length) {
      throw new Error(`No ${SKILL_ENTRY} under "${want}". Found: ${candidates.join(', ') || 'none anywhere in the archive'}`);
    }
    candidates = narrowed;
  }

  if (!candidates.length) {
    throw new Error(`No ${SKILL_ENTRY} in the archive — an Agent Skill is a folder with a ${SKILL_ENTRY} in it.`);
  }
  if (candidates.length > 1) {
    const folders = candidates.map((p) => p.slice(0, -SKILL_ENTRY.length - 1)).join(', ');
    throw new Error(`This archive holds ${candidates.length} skills. Name one with "path": ${folders}`);
  }

  const only = candidates[0];
  return only === SKILL_ENTRY ? '' : only.slice(0, only.length - SKILL_ENTRY.length);
}

// ---- The download ----------------------------------------------------------------------------

export const SKILL_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
// Redirect hops: api.github.com → codeload → objects. Four leaves room without allowing a loop.
const SKILL_MAX_REDIRECTS = 4;

/**
 * Download an archive, following redirects **by hand** so every hop is checked against the allowlist.
 * `redirect: 'follow'` would validate the first URL and then go wherever it is sent — that is not a
 * check, it is the check happening once, at the least interesting moment.
 *
 * The body is read in chunks rather than with `arrayBuffer()` so the size cap can stop the transfer
 * instead of describing it afterwards: `content-length` is a claim, and a chunked response makes no
 * claim at all.
 */
export async function downloadArchive(startUrl: string): Promise<Uint8Array> {
  let current = startUrl;

  for (let hop = 0; hop <= SKILL_MAX_REDIRECTS; hop++) {
    const res = await fetch(current, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'sqemes-skill-import',
        'Accept': 'application/vnd.github+json, application/zip;q=0.9, */*;q=0.8',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel();
      if (!location) throw new Error(`Redirect without a target (HTTP ${res.status}).`);
      const next = new URL(location, current);
      if (next.protocol !== 'https:' || !isAllowedArchiveHost(next.hostname)) {
        throw new Error(`Redirected to a host we do not download from: ${next.hostname}`);
      }
      current = next.toString();
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel();
      if (res.status === 404) throw new Error('Not found (404) — is the repository public, and is the branch or folder spelled correctly?');
      if (res.status === 403) throw new Error("GitHub refused the request (403). Its anonymous rate limit is per IP and resets hourly.");
      throw new Error(`HTTP ${res.status} from ${new URL(current).hostname}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('The response carried no body.');

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > SKILL_MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw new Error(`Archive exceeds the ${SKILL_MAX_DOWNLOAD_BYTES / 1048576} MB download limit.`);
      }
      chunks.push(value);
    }

    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
    return out;
  }

  throw new Error('Too many redirects.');
}
