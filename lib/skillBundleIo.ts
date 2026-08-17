// SQEM-243 — the workspace half of the skill bundle: fetch bytes out, put bytes in.
//
// ⚠️ **This exists so `lib/skillBundle.ts` can stay pure.** It originally lived there, and CI caught
// the mistake within the hour: importing this module pulls in `lib/api/*` → `lib/supabase`, which
// throws at load time without Supabase env vars. The round-trip test passed locally only because a
// `.env.local` happened to be present, and the pull request claimed a separation that was a comment
// rather than a fact.
//
// The fix is the better design anyway. `skillBundle.ts` now imports nothing but JSZip, so the pack /
// unpack invariant is testable with **no mock at all** — unlike `templateBundle.test.ts`, which has
// to `vi.mock('../../lib/supabase')` to get off the ground. **Keep the split.** Anything here that
// does not touch the network or the database belongs on the other side of the line.
import type { Prompt, WorkspaceFile } from '../types';
import { getWorkspaceFileSignedUrl, uploadWorkspaceFile } from './api/files';
import { createPrompt } from './api/prompts';
import { buildSkillZip, type SkillBundle } from './skillBundle';

/** Fetch a skill's files and pack the folder. */
export async function exportSkillToZip(skill: Prompt, allFiles: WorkspaceFile[]): Promise<Blob> {
  const byId = new Map(allFiles.map(f => [f.id, f]));
  const files: SkillBundle['files'] = [];
  for (const id of skill.contextFileIds || []) {
    const f = byId.get(id);
    if (!f) continue; // dangling reference — pruned, same as templateBundle does
    try {
      const resp = await fetch(await getWorkspaceFileSignedUrl(f.storagePath));
      if (!resp.ok) continue;
      files.push({ name: f.name, blob: await resp.blob(), mimeType: f.mimeType });
    } catch { /* unreachable file: export the rest rather than nothing */ }
  }
  return buildSkillZip({ title: skill.title, description: skill.description || '', content: skill.content || '', files });
}

/** Apply an unpacked skill folder to a workspace: upload the files, then create the skill. */
export async function importSkillBundle(
  b: SkillBundle, workspaceId: string, userId: string,
): Promise<{ skillId: string; files: WorkspaceFile[] }> {
  const created: WorkspaceFile[] = [];
  for (const f of b.files) {
    // The name keeps its path — that IS the folder structure. `uploadWorkspaceFile` sanitises only
    // the storage key (SQEM-237), which is the separation this whole feature rests on.
    const uploaded = await uploadWorkspaceFile(
      workspaceId,
      new File([f.blob], f.name, { type: f.mimeType || 'application/octet-stream' }),
      [],
    );
    created.push(uploaded);
  }

  const skill = await createPrompt({
    workspaceId,
    kind: 'skill',
    title: b.title,
    description: b.description,
    content: b.content,
    tag: null,
    variables: [],
    contextFileIds: created.map(f => f.id),
    skillIds: [],
    createdBy: userId,
    isFavorite: false,
    usageCount: 0,
    published: true,
  } as unknown as Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'>, workspaceId);

  return { skillId: skill.id, files: created };
}
