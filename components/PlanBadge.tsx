// SQEM-182 — self-host STUB. Self-host is BYOK and has no plan tiers, so the plan/"Managed" badge is not
// shipped. The public export's publish/ overlay replaces components/PlanBadge.tsx with this no-op.
export default function PlanBadge() {
  return null;
}
