// SQEM-487 — a local stdio MCP server with a FAKE library, for measuring tool choice.
// Tool names and descriptions are read from the real mcp-server source, so the model sees what it
// would see against Sqemes. No real data: three personas, eight playbooks, all invented.
import { readFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const SRC = readFileSync(new URL('../../supabase/functions/mcp-server/index.ts', import.meta.url), 'utf8');
const LIST = SRC.slice(SRC.indexOf("if (method === 'tools/list') {"));
function realDescription(name) {
  const i = LIST.indexOf(`name: '${name}'`);
  const d = LIST.indexOf("description: '", i) + "description: '".length;
  let out = '';
  for (let k = d; k < LIST.length; k++) {
    const c = LIST[k];
    if (c === '\\') { const n = LIST[++k]; out += n === 'n' ? '\n' : n; continue; }
    if (c === "'") break;
    out += c;
  }
  return out;
}

const PLAYBOOKS = [
  { name: 'offer_letter', title: 'Angebot', kind: 'prompt', description: 'Ein Angebot für einen Kunden schreiben: Umfang, Lizenzen, Preis, Konditionen.' },
  { name: 'pricing_guidelines', title: 'Preisrichtlinien', kind: 'skill', description: 'Preisliste, Rabattregeln und wie weit wir in einer Preisverhandlung gehen.' },
  { name: 'candidate_rejection', title: 'Absage an Bewerber', kind: 'prompt', description: 'Eine wertschätzende Absage an einen Bewerber oder eine Bewerberin.' },
  { name: 'job_ad', title: 'Stellenanzeige', kind: 'prompt', description: 'Eine Stellenanzeige in unserer Arbeitgeberstimme.' },
  { name: 'complaint_handling', title: 'Reklamationen', kind: 'skill', description: 'Wie wir auf Kundenbeschwerden antworten und was wir anbieten dürfen.' },
  { name: 'meeting_notes', title: 'Meeting-Protokoll', kind: 'prompt', description: 'Ein Meeting zusammenfassen: Entscheidungen, Verantwortliche, nächste Schritte.' },
  { name: 'release_notes', title: 'Release Notes', kind: 'prompt', description: 'Release Notes für Kunden aus einer Liste von Änderungen.' },
  { name: 'brand_voice', title: 'Markenstimme', kind: 'skill', description: 'Unsere Tonalität: kurze Sätze, kein Jargon, freundlich, aber direkt.' },
];
const PERSONAS = [
  { name: 'sales_director', title: 'Sales Director', description: 'Neugeschäft: Angebote, Preisgespräche und Verhandlungen mit Interessenten.', routes: [['ein Angebot schreiben', 'offer_letter'], ['Preis oder Rabatt besprechen', 'pricing_guidelines']] },
  { name: 'account_manager', title: 'Account Manager', description: 'Bestandskunden: Verlängerungen, Angebote für weitere Lizenzen, Rabatte, Reklamationen.', routes: [['ein Angebot für einen Bestandskunden', 'offer_letter'], ['Preis- oder Rabattfragen', 'pricing_guidelines'], ['eine Reklamation', 'complaint_handling']] },
  { name: 'recruiter', title: 'Recruiter', description: 'Recruiting: Stellenanzeigen, Antworten an Bewerber, Vorbereitung von Interviews.', routes: [['einem Bewerber antworten', 'candidate_rejection'], ['eine Stellenanzeige schreiben', 'job_ad']] },
];

const TOOLS = [
  { name: 'search_templates', inputSchema: { type: 'object', properties: { query: { type: 'string' }, kind: { type: 'string', enum: ['prompt', 'skill'] } }, required: ['query'] } },
  { name: 'get_template', inputSchema: { type: 'object', properties: { name: { type: 'string' }, id: { type: 'string' } } } },
  { name: 'list_personas', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_persona', inputSchema: { type: 'object', properties: { name: { type: 'string' }, id: { type: 'string' } } } },
].map(t => ({ ...t, description: realDescription(t.name) }));

const LOG = process.env.MOCK_LOG;
const log = (o) => { if (LOG) appendFileSync(LOG, JSON.stringify(o) + '\n'); };
const words = (s) => String(s || '').toLowerCase().split(/[^a-zäöüß0-9-]+/).filter(w => w.length > 2);

function call(name, args) {
  log({ tool: name, args });
  if (name === 'list_personas') return PERSONAS.map(p => ({ id: p.name, name: p.name, title: p.title, description: p.description, routeCount: p.routes.length }));
  if (name === 'get_persona') {
    const p = PERSONAS.find(x => x.name === args.name || x.name === args.id || x.title === args.name);
    if (!p) return { error: 'Persona not found' };
    return `# ${p.title}\n\n${p.description}\n\n## Routes — load one only when its condition applies\n\n| When | Load |\n|---|---|\n` + p.routes.map(([w, t]) => `| ${w} | get_template(name: "${t}") |`).join('\n');
  }
  if (name === 'search_templates') {
    const q = words(args.query);
    const hits = PLAYBOOKS.filter(p => q.some(w => (p.title + ' ' + p.description).toLowerCase().includes(w)));
    return hits.map(p => ({ id: p.name, name: p.name, title: p.title, kind: p.kind, description: p.description }));
  }
  if (name === 'get_template') {
    const p = PLAYBOOKS.find(x => x.name === args.name || x.name === args.id);
    if (!p) return { error: 'Template not found' };
    return { ...p, content: p.kind === 'skill' ? `Rules for ${p.title}: be concise; follow the house style.` : `Write the ${p.title.toLowerCase()} for {{subject}}. Keep it under 150 words.`, variables: p.kind === 'prompt' ? ['subject'] : [] };
  }
  return { error: `Unknown tool ${name}` };
}

const rl = createInterface({ input: process.stdin });
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'sqemes', version: 'mock' } } });
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } });
  if (m.method === 'tools/call') {
    const r = call(m.params.name, m.params.arguments || {});
    return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: typeof r === 'string' ? r : JSON.stringify(r, null, 2) }] } });
  }
  if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} });
});
