// Sqemes self-host api sidecar (SQEM-116 increment 2).
//
// On Sqemes Cloud these endpoints are Vercel serverless functions (see /api + vercel.json).
// Self-host has no Vercel, so this tiny Node server serves the SAME handler files unchanged,
// with a minimal Vercel-style res shim (status/json/send). Caddy routes the matching paths here
// (see docker-compose.caddy.yml + volumes/proxy/caddy/Caddyfile). Zero npm dependencies.

import http from 'node:http';
import extensionConfig from './api/extension-config.js';
import oauthAuthorize from './api/oauth-authorize.js';
import mcpOauthMetadata from './api/mcp-oauth-metadata.js';

// Path → handler. Mirrors the vercel.json rewrites.
const routes = {
  '/.well-known/sqemes-extension-config': extensionConfig,
  '/oauth/authorize': oauthAuthorize,
  '/.well-known/oauth-authorization-server': mcpOauthMetadata,
};

const PORT = Number(process.env.PORT) || 8787;

const server = http.createServer((req, res) => {
  // Minimal Vercel-style helpers the handlers rely on (they use only these + native setHeader/end).
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (body) => { res.end(body); return res; };

  const path = (req.url || '').split('?')[0];
  const handler = routes[path];
  if (!handler) {
    res.status(404).json({ error: 'not_found', path });
    return;
  }
  try {
    handler(req, res);
  } catch (err) {
    console.error(`[api-sidecar] ${path} failed:`, err);
    if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
  }
});

server.listen(PORT, () => {
  console.log(`[api-sidecar] listening on :${PORT} — serving ${Object.keys(routes).join(', ')}`);
});
