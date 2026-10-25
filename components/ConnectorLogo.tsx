import { useState } from 'react';
import { Plug } from 'lucide-react';
import { functionCallUrl } from '../lib/env';
import { appLogoForMcpUrl } from './connectorAppTiles';

/**
 * SQEM-590 — the logo of a custom connector.
 *
 * 1. A server we have a tile for → that tile's logo (Cloud only; the self-host stub knows none).
 * 2. Otherwise → the favicon of the server's site, fetched by OUR `connector-icon` function, so no
 *    viewer's browser calls the vendor directly (see `_shared/connectorIcon.ts`).
 * 3. Nothing found, or the image fails → the plug, as before.
 */
export default function ConnectorLogo({ mcpUrl, className = 'w-6 h-6' }: { mcpUrl: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const known = appLogoForMcpUrl(mcpUrl, className);
  if (known) return known;
  let host = '';
  try { host = new URL(mcpUrl).hostname; } catch { /* invalid url → plug */ }
  if (!host || failed) return <Plug aria-hidden className={`${className} text-ink-subtle`} />;
  const src = new URL(functionCallUrl('connector-icon'));
  src.searchParams.set('host', host);
  return <img src={src.toString()} alt="" className={`${className} object-contain rounded-chip`} onError={() => setFailed(true)} loading="lazy" />;
}
