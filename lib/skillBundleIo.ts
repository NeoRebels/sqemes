// SQEM-243 — the workspace half of the skill bundle.
//
// ⚠️ SQEM-302 — **the "bytes out" half is gone.** The export switched to the Sqemes bundle, so what
// remains here is import only: an Agent Skill folder somebody uploads still lands in the workspace,
// which was the explicit condition on that change.
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
import { uploadWorkspaceFile } from './api/files';
import { createPrompt } from './api/prompts';
import { workspacePathFor, type SkillBundle } from './skillBundle';

export async function importSkillBundle(
  b: SkillBundle, workspaceId: string, userId: string,
): Promise<{ skillId: string; files: WorkspaceFile[] }> {
  const created: WorkspaceFile[] = [];
  for (const f of b.files) {
    // The name keeps its path — that IS the folder structure. `uploadWorkspaceFile` sanitises only
    // the storage key (SQEM-237), which is the separation this whole feature rests on.
    //
    // SQEM-251 — and it gets the skill's folder in front of it, because the workspace is one flat
    // namespace: without the prefix the second imported skill merges its `references/` into the
    // first one's, every time.
    const uploaded = await uploadWorkspaceFile(
      workspaceId,
      new File([f.blob], workspacePathFor(b.title, f.name), { type: f.mimeType || 'application/octet-stream' }),
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
    createdBy: userId,
    isFavorite: false,
    usageCount: 0,
    published: true,
  } as unknown as Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'>, workspaceId);

  return { skillId: skill.id, files: created };
}
