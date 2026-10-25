// SQEM-590 — GET ?host=<mcp server hostname> → the site's raster favicon, or 404.
//
// Public on purpose (an <img> cannot send a login): it only ever returns an image found at a public
// site's /favicon.ico or named by its home page — see `_shared/connectorIcon.ts` for the limits.
// The browser caches a hit for a day and a miss for an hour, so Settings does not refetch on every visit.
import { findConnectorIcon } from '../_shared/connectorIcon.ts';

const baseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'",
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: baseHeaders });
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: baseHeaders });
  const host = (new URL(req.url).searchParams.get('host') ?? '').trim().toLowerCase();
  const icon = await findConnectorIcon(host).catch(() => null);
  if (!icon) {
    return new Response('No icon', { status: 404, headers: { ...baseHeaders, 'Cache-Control': 'public, max-age=3600' } });
  }
  return new Response(icon.bytes, {
    headers: { ...baseHeaders, 'Content-Type': icon.type, 'Cache-Control': 'public, max-age=86400' },
  });
});
