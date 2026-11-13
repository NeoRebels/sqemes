// SQEM-487 — a local stdio MCP server with a FAKE library, for measuring tool choice.
// Tool names and descriptions are read from the real mcp-server source, so the model sees what it
// would see against Sqemes. No real data: three personas, eight playbooks, all invented.
// SQEM-681 — descriptions come from `_shared/libraryToolDefs.ts` (the server imports them from there now), the
// search matches the WHOLE query as text like the real `searchTemplates`, and `list_templates` exists, as in Chat.
import { readFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const LIST = readFileSync(new URL('../../supabase/functions/_shared/libraryToolDefs.ts', import.meta.url), 'utf8');
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

// SQEM-623 — MOCK_HINT=1 serves the improvement hint the way the real readers do (`afterUse` on a
// template, `## After the task` closing a persona), read from the real source like the descriptions.
const HINT = process.env.MOCK_HINT === '1'
  ? readFileSync(new URL('../../supabase/functions/_shared/libraryPrompt.ts', import.meta.url), 'utf8').match(/IMPROVEMENT_HINT = '([^']*)'/)[1]
  : null;

const PLAYBOOKS = [
  { name: 'offer_letter', title: 'Angebot', kind: 'prompt', description: 'Ein Angebot für einen Kunden schreiben: Umfang, Lizenzen, Preis, Konditionen.' },
  { name: 'pricing_guidelines', title: 'Preisrichtlinien', kind: 'skill', description: 'Preisliste, Rabattregeln und wie weit wir in einer Preisverhandlung gehen.' },
  { name: 'candidate_rejection', title: 'Absage an Bewerber', kind: 'prompt', description: 'Eine wertschätzende Absage an einen Bewerber oder eine Bewerberin.' },
  { name: 'job_ad', title: 'Stellenanzeige', kind: 'prompt', description: 'Eine Stellenanzeige in unserer Arbeitgeberstimme.' },
  { name: 'complaint_handling', title: 'Reklamationen', kind: 'skill', description: 'Wie wir auf Kundenbeschwerden antworten und was wir anbieten dürfen.' },
  { name: 'meeting_notes', title: 'Meeting-Protokoll', kind: 'prompt', description: 'Ein Meeting zusammenfassen: Entscheidungen, Verantwortliche, nächste Schritte.' },
  { name: 'release_notes', title: 'Release Notes', kind: 'prompt', description: 'Release Notes für Kunden aus einer Liste von Änderungen.' },
  { name: 'brand_voice', title: 'Markenstimme', kind: 'skill', description: 'Unsere Tonalität: kurze Sätze, kein Jargon, freundlich, aber direkt.' },
  // SQEM-683 — titled in English, as many real libraries are; a German request has to search in English to find them.
  { name: 'process_diagrams', title: 'Process diagrams', kind: 'skill', description: 'Draw flowcharts and process diagrams: steps, systems, hand-offs, in our house style.' },
  { name: 'proposal_checklist', title: 'Proposal checklist', kind: 'skill', description: 'What to check before an offer goes out: scope, price, terms, payment, signature.' },
  // SQEM-685 — named the way the real library names them: its slug is the title's (`toSlug`), which a model passing the title misses.
  { name: 'erp_kundenreview_mcp', title: 'ERP Kundenreview (MCP)', kind: 'skill', description: 'Für Vertriebs-Kundenreviews: Umsatz, Zahlungen und Artikel eines Kunden aus dem ERP, als Excel.' },
];
const PERSONAS = [
  { name: 'sales_director', title: 'Sales Director', description: 'Neugeschäft: Angebote, Preisgespräche und Verhandlungen mit Interessenten.', routes: [['ein Angebot schreiben', 'offer_letter'], ['Preis oder Rabatt besprechen', 'pricing_guidelines']] },
  { name: 'account_manager', title: 'Account Manager', description: 'Bestandskunden: Verlängerungen, Angebote für weitere Lizenzen, Rabatte, Reklamationen.', routes: [['ein Angebot für einen Bestandskunden', 'offer_letter'], ['Preis- oder Rabattfragen', 'pricing_guidelines'], ['eine Reklamation', 'complaint_handling']] },
  { name: 'recruiter', title: 'Recruiter', description: 'Recruiting: Stellenanzeigen, Antworten an Bewerber, Vorbereitung von Interviews.', routes: [['einem Bewerber antworten', 'candidate_rejection'], ['eine Stellenanzeige schreiben', 'job_ad']] },
];

const TOOLS = [
  { name: 'search_templates', inputSchema: { type: 'object', properties: { query: { type: 'string' }, kind: { type: 'string', enum: ['prompt', 'skill'] } }, required: ['query'] } },
  { name: 'list_templates', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['prompt', 'skill'] } } } },
  { name: 'get_template', inputSchema: { type: 'object', properties: { name: { type: 'string' }, id: { type: 'string' } } } },
  { name: 'list_personas', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_persona', inputSchema: { type: 'object', properties: { name: { type: 'string' }, id: { type: 'string' } } } },
].map(t => ({ ...t, description: realDescription(t.name) }));

const PROMPT_SRC = readFileSync(new URL('../../supabase/functions/_shared/libraryPrompt.ts', import.meta.url), 'utf8');
const CHOOSE = PROMPT_SRC.match(/PERSONA_CHOICE_NOTE = '([^']*)'/)[1];
const CHOOSE_UNATTENDED = PROMPT_SRC.match(/PERSONA_CHOICE_NOTE_UNATTENDED = '([^']*)'/)[1];
const LOG = process.env.MOCK_LOG;
const log = (o) => { if (LOG) appendFileSync(LOG, JSON.stringify(o) + '\n'); };

function call(name, args) {
  // SQEM-688 — the same shape as `personaList` in `_shared/libraryPrompt.ts`: the list and the rule for choosing.
  if (name === 'list_personas') return { personas: PERSONAS.map(p => ({ id: p.name, name: p.name, title: p.title, description: p.description, routeCount: p.routes.length })), choose: process.env.MOCK_UNATTENDED === '1' ? CHOOSE_UNATTENDED : CHOOSE };
  if (name === 'get_persona') {
    const p = PERSONAS.find(x => x.name === args.name || x.name === args.id || x.title === args.name);
    if (!p) return { error: 'Persona not found' };
    return `# ${p.title}\n\n${p.description}\n\n## Routes — load one only when its condition applies\n\n| When | Load |\n|---|---|\n` + p.routes.map(([w, t]) => `| ${w} | get_template(name: "${t}") |`).join('\n')
      + (HINT ? `\n\n## After the task\n\n${HINT}` : '');
  }
  if (name === 'search_templates') {
    // SQEM-681 — like `searchTemplates` in `_shared/libraryQueries.ts`: the whole query, as text, in title or description.
    const needle = String(args.query || '').toLowerCase();
    const hits = needle ? PLAYBOOKS.filter(p => p.title.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle)) : [];
    return hits.map(p => ({ id: p.name, name: p.name, title: p.title, kind: p.kind, description: p.description }));
  }
  if (name === 'list_templates') return PLAYBOOKS.filter(p => !args.kind || p.kind === args.kind).map(p => ({ id: p.name, name: p.name, title: p.title, kind: p.kind, description: p.description }));
  if (name === 'get_template') {
    const p = PLAYBOOKS.find(x => x.name === args.name || x.name === args.id);
    if (!p) return { error: 'Template not found' };
    // SQEM-623 — the rejection playbook states a rule (formal "Sie", no reason given) that case C2 contradicts.
    const content = p.name === 'candidate_rejection'
      ? 'Write the rejection for {{subject}}. Address the candidate formally ("Sie"). Do not state a reason for the rejection. Keep it under 150 words.'
      : p.kind === 'skill' ? `Rules for ${p.title}: be concise; follow the house style.` : `Write the ${p.title.toLowerCase()} for {{subject}}. Keep it under 150 words.`;
    return { ...p, content, variables: p.kind === 'prompt' ? ['subject'] : [], ...(HINT ? { afterUse: HINT } : {}) };
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
    // SQEM-683 — `found: false` marks a call that hit nothing (a get_template on a name that does not exist).
    log({ tool: m.params.name, args: m.params.arguments || {}, found: !(r && typeof r === 'object' && 'error' in r) });
    return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: typeof r === 'string' ? r : JSON.stringify(r, null, 2) }] } });
  }
  if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} });
});
