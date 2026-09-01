// SQEM-314 — does template access mean anything in this workspace?
//
// Two different questions used to be answered by accident, in two different places, and neither
// answered the one the user was asking.
//
// ⛔ **The reported symptom was not the plan.** Switching Solo → Team left "Restrict access" hidden,
// because `TemplateAccessControl` hides it when there is nobody to grant to — and a plan change
// alters the *seat allowance*, not the member count. A plan gate alone would not have fixed it.
//
// So there are two rules, and they are here rather than inline so that the editor, the workspace
// default in Settings and any future surface cannot drift apart — the failure mode SQEM-308
// recorded when three screens each had their own answer to "is the brand filled in?".

import type { Workspace } from '../types';

/**
 * A workspace that can hold more than one person: any paid multi-seat tier, or a managed workspace.
 *
 * ⚠️ **There is no `Enterprise` tier** — `PlanTier` is `Solo | Team | Business`. What an enterprise
 * arrangement looks like in the data is `isManaged`, which lifts seat limits entirely, so it counts.
 */
export function isMultiSeat(workspace: Pick<Workspace, 'plan' | 'isManaged'> | null | undefined): boolean {
  if (!workspace) return false;
  return workspace.isManaged || workspace.plan !== 'Solo';
}

/**
 * Whether to show the access controls at all.
 *
 * On Solo there is one seat and nobody to grant to, so the question does not arise — **except when
 * rules already exist.**
 *
 * ⛔ **That exception is not politeness, it is the difference between hiding a question and hiding
 * an answer.** A workspace can be downgraded from Team to Solo with restricted templates still in
 * it; their `template_access` rows survive the downgrade untouched. Hiding the control then leaves
 * the owner looking at a template that is restricted *against them*, with no control saying so and
 * no way to lift it. Same class of defect as SQEM-240: **a control that silently lacks an option
 * teaches nothing.**
 */
export function accessAppliesTo(
  workspace: Pick<Workspace, 'plan' | 'isManaged'> | null | undefined,
  hasExistingRules: boolean,
): boolean {
  return isMultiSeat(workspace) || hasExistingRules;
}
