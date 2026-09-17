// SQEM-261 — feedback and bug reports from inside the product.
//
// Everything worth knowing about this integration is a decision, not a detail. They are all here.

import type { User, Workspace } from '../types';
import { ROLE_LABELS } from '../constants';

/**
 * ⛔ **The key is the only thing that switches Gleap on, and that is deliberate.**
 *
 * Without it nothing initializes, nothing loads, nothing is sent. That is what protects a
 * **self-hosted** instance: the export ships this code but no key (env files are not exported), so a
 * stranger's users never report into *our* workspace. A self-hoster who wants the feature sets their
 * OWN project key and it talks to their own Gleap — which is the honest version of "optional".
 *
 * ⚠️ `VITE_` values are inlined at build time. An **empty but defined** variable is the failure mode
 * that killed the public listing page for a week (SQEM-405), so the guard tests the trimmed string,
 * not the presence of the key.
 */
const KEY = (import.meta.env.VITE_GLEAP_API_KEY ?? '').trim();

/** Whether this build can run Gleap at all. Read by the boot component and by nothing else. */
export const gleapConfigured = KEY !== '';

let started = false;

/**
 * Start Gleap for a signed-in person.
 *
 * ⛔ **Call this only from the authenticated tree.** The public listing page (`/library/:id`,
 * SQEM-258) is read by strangers who never agreed to anything; loading a third-party widget there
 * would put a tracker in front of someone who only followed a shared link.
 */
export async function startGleap(user: User, workspace: Workspace): Promise<void> {
  if (started) return;
  /**
   * ⚠️ **A feature that does nothing must say so.** Without this line the only symptom of a missing
   * or stale key is an absent widget — indistinguishable from a blocked request, a hidden button or a
   * bug in this file. That cost a full round of guessing on 2026-09-16, and the person guessing had
   * written the code. `VITE_` values are baked in at build time, so "the variable is set in Vercel"
   * and "this build has it" are different statements; this line reports the second one.
   */
  if (!gleapConfigured) {
    console.info('[gleap] disabled — VITE_GLEAP_API_KEY is empty in THIS build (env vars are inlined at build time; a redeploy of this environment is what picks up a new value)');
    return;
  }
  started = true;

  /**
   * ⚠️ **Loaded on demand, and that is not a micro-optimisation.** Imported at the top of this file,
   * Gleap and its `@rrweb/record` dependency land in the ENTRY chunk: the first paint grew from
   * 124 kB to 719 kB (measured 2026-09-16) — every visitor paying for a widget only signed-in people
   * ever see. As a dynamic import it becomes its own chunk, fetched after someone is inside.
   */
  const Gleap = (await import('gleap')).default;

  /**
   * ⛔ **THE ORDER MATTERS, AND THE REASON IS NOT OBVIOUS.**
   *
   * `Gleap.initialize()` starts the session recorder **immediately and unconditionally** — read from
   * `gleap@17.0.3`: `initialize` does `try { replay.startIfNotRunning() } catch {}` before anything
   * else. Only later, when the project config arrives, does `applyConfig` check the dashboard's
   * `enableWebReplays` flag and call `replay.stop()` if it is off.
   *
   * So between `initialize` and that config response, the DOM **is** being recorded — with rrweb's
   * defaults, which capture the visible text of the page and every input except `type="password"`.
   * In a product where people paste contracts and client data into playbooks, that window is not
   * acceptable, and "we turned it off in the dashboard" does not close it.
   *
   * `setReplayOptions` stores its options on the recorder singleton, so setting them **before**
   * `initialize` means the transient buffer is masked too. `maskTextSelector: '*'` masks every text
   * node; `maskAllInputs` covers the fields. Belt and braces: the dashboard switch is still off.
   *
   * ⚠️ The privacy policy tells customers *"We do not record your screen or your session."* These two
   * lines are what makes that sentence true. Do not reorder them, and do not delete them because the
   * dashboard toggle "already handles it".
   */
  Gleap.setReplayOptions({ maskAllInputs: true, maskTextSelector: '*' });
  Gleap.initialize(KEY);

  // Who is asking — so a reply reaches the person, and so the owner can follow up on a report.
  // Exactly the data named in the privacy policy: identity, and the workspace it came from.
  console.info('[gleap] started');

  Gleap.identify(user.id, {
    name: user.name,
    email: user.email,
    customData: {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      plan: workspace.plan,
      // ⚠️ SQEM-432 — the LABEL, not the stored value: the owner reads these reports, and `admin`
      // where the whole app says `Admin` is a second vocabulary for one thing.
      role: ROLE_LABELS[user.role] ?? user.role,
    },
  });
}
