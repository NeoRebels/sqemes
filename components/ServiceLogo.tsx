import ConnectorLogo from './ConnectorLogo';
import { appLogoForServiceKey } from './connectorAppTiles';

/**
 * SQEM-642/643 — the logo of a persona's connector SERVICE, in the frame Settings → Connectors uses:
 * the app tile for an `app:` key (also when nobody here connected it), the server's favicon for a custom
 * one (`ConnectorLogo`), the plug otherwise. `mcpUrl` is for the logo only and is never stored.
 */
export default function ServiceLogo({ serviceKey, mcpUrl }: { serviceKey: string; mcpUrl?: string }) {
  const url = mcpUrl ?? (serviceKey.startsWith('url:') ? serviceKey.slice(4) : '');
  return (
    <span aria-hidden className="w-7 h-7 shrink-0 rounded-lg bg-surface-raised border border-line flex items-center justify-center">
      {appLogoForServiceKey(serviceKey, 'w-4 h-4') ?? <ConnectorLogo mcpUrl={url} className="w-4 h-4" />}
    </span>
  );
}
