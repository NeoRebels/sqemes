// SQEM-182 — self-host STUB. The public export's `publish/` overlay replaces the real
// components/MarketplaceAdminEntry.tsx with this: the Sqemes super-admin marketplace surface
// (moderation, reports, invite-only publisher management) is Cloud-only and never ships to self-host.
// It imports nothing, so lib/api/marketplaceAdmin.ts (pruned by build-public-export.sh) is unreferenced.
export default function MarketplaceAdminEntry() {
  return null;
}
