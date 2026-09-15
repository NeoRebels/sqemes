// SQEM-182 — self-host STUB. Self-host is BYOK and has no plan tiers, so the plan/"Managed" badge is not
// shipped. The public export's publish/ overlay replaces components/PlanBadge.tsx with this no-op.
//
// ⛔ SQEM-411 — a stub must accept the SAME props as the component it replaces. This one took none while
// `Sidebar.tsx` passes `workspace`, and `npm run typecheck` in the public repo failed on every release from
// v1.11.11 to v1.11.16. `tests/types/publishStubs.tsx` now renders each stub with its original's props.
// ⚠️ `workspace` is typed `unknown` on purpose: this file is compiled in two places — here, where `../types`
// does not exist, and in the export's `components/`, where it does. No import resolves in both.
export default function PlanBadge(_props: { workspace: unknown }) {
  return null;
}
