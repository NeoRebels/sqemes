#!/usr/bin/env node
// SQEM-481 — measure MCP latency from the outside, the way a client experiences it.
//
// Usage:  SQEM481_MCP_KEY=sqm_live_… node scripts/mcp-latency.mjs [--url URL] [--runs 20] [--json out.json]
//         (or put SQEM481_MCP_KEY=… in .env.local — the script reads it, never prints it)
//
// Read-only on purpose: only initialize, tools/list and the read tools are called, so it is safe to
// point at production with a dedicated read-scoped key. Each call is timed end to end; the first call
// of a run is reported separately as "cold" (it may or may not hit a cold worker — see the note in the
// output). If the server sends a `Server-Timing` header (added later in SQEM-481), it is summarised too.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const URL_ = opt('url', 'https://api.sqemes.com/functions/v1/mcp-server');
const RUNS = Number(opt('runs', '20'));
const OUT = opt('json', null);
const ONLY = opt('template', null); // measure get_template inline/list for this template slug only

let KEY = process.env.SQEM481_MCP_KEY;
if (!KEY && existsSync('.env.local')) {
  const line = readFileSync('.env.local', 'utf8').split('\n').find(l => l.startsWith('SQEM481_MCP_KEY='));
  if (line) KEY = line.slice('SQEM481_MCP_KEY='.length).trim().replace(/^"|"$/g, '');
}
if (!KEY) {
  console.error('✖ No key. Set SQEM481_MCP_KEY (env or .env.local). Use a dedicated READ-scoped key.');
  process.exit(1);
}

let rpcId = 0;
async function rpc(method, params = {}) {
  const t0 = performance.now();
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  let body = null;
  try { body = JSON.parse(text); } catch { /* SSE or error page — size still counts */ }
  if (!res.ok || body?.error) {
    throw new Error(`${method} → HTTP ${res.status} ${body?.error ? JSON.stringify(body.error).slice(0, 200) : text.slice(0, 200)}`);
  }
  return { ms, bytes: Buffer.byteLength(text), body, serverTiming: res.headers.get('server-timing') };
}
const tool = (name, a = {}) => rpc('tools/call', { name, arguments: a });

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function main() {
  console.log(`MCP latency — ${URL_} — ${RUNS} runs per case — ${new Date().toISOString()}`);

  // Discover what to measure: the template with the most context bytes, and the persona with most routes.
  const listing = await tool('list_templates');
  const parsedT = JSON.parse(listing.body.result.content[0].text);
  const templates = Array.isArray(parsedT) ? parsedT : (parsedT.templates ?? []);
  const biggest = [...templates].sort((a, b) => (b.contextBytes ?? 0) - (a.contextBytes ?? 0))[0];
  const smallest = templates.find(t => !t.contextFileCount) ?? templates[0];
  const personasRes = await tool('list_personas');
  const personas = JSON.parse(personasRes.body.result.content[0].text);
  const persona = (Array.isArray(personas) ? personas : personas.personas ?? [])
    .sort((a, b) => (b.routeCount ?? 0) - (a.routeCount ?? 0))[0];
  const firstWord = (smallest?.title || smallest?.name || 'angebot').split(/[\s_-]+/)[0];

  console.log(`  biggest template: ${biggest?.name} (${biggest?.contextFileCount ?? 0} files, ${biggest?.contextBytes ?? 0} B)`);
  console.log(`  no-file template: ${smallest?.name} · persona: ${persona?.name} (${persona?.routeCount} routes) · search: "${firstWord}"`);

  if (ONLY) {
    const t = templates.find(x => x.name === ONLY);
    if (!t) { console.error(`✖ template ${ONLY} not found`); process.exit(1); }
    console.log(`  only: ${t.name} (${t.contextFileCount ?? 0} files, ${t.contextBytes ?? 0} B)`);
    for (const mode of ['inline', 'list']) {
      const ts = []; let b = 0;
      for (let i = 0; i < RUNS; i++) { const r = await tool('get_template', { name: t.name, include_files: mode }); ts.push(r.ms); b = r.bytes; }
      console.log(`  ${mode.padEnd(7)} p50 ${Math.round(pct(ts, 50))} ms · p95 ${Math.round(pct(ts, 95))} ms · ${(b / 1024).toFixed(1)} KB`);
    }
    return;
  }
  const cases = [
    ['initialize', () => rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sqem481-latency', version: '1' } })],
    ['tools/list', () => rpc('tools/list')],
    ['list_templates', () => tool('list_templates')],
    ['search_templates', () => tool('search_templates', { query: firstWord })],
    ['get_template (no files)', () => tool('get_template', { name: smallest.name })],
    ['get_template (biggest, inline)', () => tool('get_template', { name: biggest.name, include_files: 'inline' })],
    ['get_template (biggest, list)', () => tool('get_template', { name: biggest.name, include_files: 'list' })],
    ['list_personas', () => tool('list_personas')],
    ...(persona ? [['get_persona', () => tool('get_persona', { name: persona.name })]] : []),
  ];
  if (!persona) console.log('  (no persona in this workspace — get_persona skipped)');
  if (!biggest?.contextFileCount) console.log('  ⚠️ no template with context files here — the inline/list cases measure nothing file-related');

  const results = [];
  for (const [label, call] of cases) {
    const times = []; let bytes = 0; let cold = null; const timings = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await call();
      if (i === 0) cold = r.ms; else times.push(r.ms);
      bytes = r.bytes;
      if (r.serverTiming) timings.push(r.serverTiming);
    }
    const row = {
      case: label, first_ms: Math.round(cold), p50_ms: Math.round(pct(times, 50)), p95_ms: Math.round(pct(times, 95)),
      max_ms: Math.round(Math.max(...times)), payload_kb: +(bytes / 1024).toFixed(1),
      server_timing_sample: timings[timings.length - 1] ?? null,
    };
    results.push(row);
    console.log(`  ${label.padEnd(32)} first ${String(row.first_ms).padStart(5)} ms · p50 ${String(row.p50_ms).padStart(5)} · p95 ${String(row.p95_ms).padStart(5)} · ${String(row.payload_kb).padStart(6)} KB`);
  }
  console.log('\n  Note: "first" is the first call of each case in this run; only the very first call of the');
  console.log('  script is likely to hit a cold worker. Run again after ~10 min idle for a cold-start number.');
  if (OUT) { writeFileSync(OUT, JSON.stringify({ url: URL_, runs: RUNS, at: new Date().toISOString(), results }, null, 2)); console.log(`  → ${OUT}`); }
}

main().catch(e => { console.error('✖', e.message); process.exit(1); });
