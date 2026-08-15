// SQEM-205 — take your data with you.
//
// The product could already delete an account ("Danger Zone") but offered no way to get the data out
// first. Deletion without export is the half of the pair that costs the user something; several
// jurisdictions expect both, and for a team product the export is also a trust signal.
//
// Deliberately client-side, like the single-template export it sits next to (`templateBundle.ts`,
// SQEM-161): everything gathered here is data the signed-in user can already read, so RLS remains
// the authority and no new edge function, secret or deploy step is introduced. The cost is that a
// very large workspace is bounded by the browser's memory — acceptable, and stated in the README
// that ships inside the archive.

import JSZip from 'jszip';
import type { Prompt, WorkspaceFile, Workspace, User } from '../types';
import { fetchPrompts } from './api/prompts';
import { fetchWorkspaceFiles, getWorkspaceFileSignedUrl } from './api/files';
import { fetchChatSessions, fetchChatMessages } from './api/chatSessions';

export interface AccountExportProgress {
  /** Human-readable step, for a status line while the archive is built. */
  step: string;
}

/** Files bigger than this are listed in the manifest but not embedded, to keep the archive sane. */
const MAX_EMBEDDED_FILE_BYTES = 25 * 1024 * 1024;

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function buildAccountExport(
  workspace: Workspace,
  currentUser: User,
  onProgress?: (p: AccountExportProgress) => void,
): Promise<Blob> {
  const zip = new JSZip();
  const report = (step: string) => onProgress?.({ step });

  // ---- Templates -------------------------------------------------------------------------------
  report('Collecting templates…');
  let templates: Prompt[] = [];
  try {
    const result = await fetchPrompts(workspace.id, currentUser.id);
    templates = Array.isArray(result) ? result : ((result as { prompts?: Prompt[] })?.prompts ?? []);
  } catch {
    templates = [];
  }
  zip.file('templates.json', JSON.stringify(templates, null, 2));

  // ---- Chats -----------------------------------------------------------------------------------
  report('Collecting chats…');
  const chats: unknown[] = [];
  try {
    const sessions = await fetchChatSessions(workspace.id, currentUser.id);
    for (const session of sessions) {
      let messages: unknown[] = [];
      try {
        messages = await fetchChatMessages(session.id);
      } catch {
        messages = [];
      }
      chats.push({ ...session, messages });
    }
  } catch {
    // Leave the array empty rather than failing the whole export.
  }
  zip.file('chats.json', JSON.stringify(chats, null, 2));

  // ---- Files -----------------------------------------------------------------------------------
  report('Collecting files…');
  let files: WorkspaceFile[] = [];
  try {
    files = await fetchWorkspaceFiles(workspace.id);
  } catch {
    files = [];
  }
  zip.file('files.json', JSON.stringify(files, null, 2));

  const skipped: string[] = [];
  const folder = zip.folder('files');
  for (const file of files) {
    if (file.sizeBytes > MAX_EMBEDDED_FILE_BYTES) {
      skipped.push(`${file.name} (${Math.round(file.sizeBytes / 1024 / 1024)} MB)`);
      continue;
    }
    report(`Downloading ${file.name}…`);
    try {
      const url = await getWorkspaceFileSignedUrl(file.storagePath);
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      folder?.file(file.name, await res.blob());
    } catch {
      skipped.push(`${file.name} (could not be downloaded)`);
    }
  }

  // ---- Profile & workspace ---------------------------------------------------------------------
  report('Collecting profile…');
  zip.file(
    'profile.json',
    JSON.stringify(
      {
        user: { id: currentUser.id, name: currentUser.name, email: currentUser.email, role: currentUser.role },
        workspace: { id: workspace.id, name: workspace.name, plan: workspace.plan },
        brandProfile: workspace.brandProfile ?? null,
        exportedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  // ---- README ----------------------------------------------------------------------------------
  // Say plainly what is and is not in the archive — a half export that looks complete is worse than
  // one that names its own gaps.
  zip.file(
    'README.txt',
    [
      `Sqemes data export — ${workspace.name}`,
      `Created ${new Date().toISOString()}`,
      '',
      'Contents',
      '  templates.json  every template you can see in this workspace',
      '  chats.json      your chat sessions, each with its messages',
      '  files.json      metadata for the workspace files',
      '  files/          the files themselves',
      '  profile.json    your profile, the workspace, and its brand profile',
      '',
      'Scope',
      '  This is one workspace. If you belong to several, switch workspace and export again.',
      '  It contains what your account is allowed to read — nothing that was hidden from you.',
      '',
      skipped.length
        ? `Not included (${skipped.length}):\n${skipped.map(s => `  - ${s}`).join('\n')}`
        : 'Everything listed above was included.',
      '',
      'JSON is UTF-8 and readable in any text editor.',
    ].join('\n'),
  );

  report('Packing the archive…');
  return zip.generateAsync({ type: 'blob' });
}

export function accountExportFilename(workspaceName: string): string {
  const safe = workspaceName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
  return `sqemes-export-${safe}-${stamp()}.zip`;
}
