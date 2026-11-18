// SQEM-487 — a local stdio MCP server with a FAKE library, for measuring tool choice.
// Tool names and descriptions are read from the real mcp-server source, so the model sees what it
// would see against Sqemes. No real data: three personas, eight playbooks, all invented.
// SQEM-681 — descriptions come from `_shared/libraryToolDefs.ts` (the server imports them from there now), the
// search matches the WHOLE query as text like the real `searchTemplates`, and `list_templates` exists, as in Chat.
import { readFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
// SQEM-703 — the persona result is rendered by the REAL `composePersona`, so the eval measures the text clients get
// (run with node's type stripping, see run.mjs). Until SQEM-703 the mock rebuilt that markdown by hand.
import { composePersona } from '../../supabase/functions/_shared/libraryQueries.ts';

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
  // SQEM-690 — work that is not writing: an analysis, a workflow, a translation.
  { name: 'table_analysis', title: 'Tabellenauswertung', kind: 'skill', description: 'Tabellen und Zahlen auswerten: Kennzahlen, Ausreißer, Trends, im Hausformat.' },
  { name: 'n8n_workflows', title: 'n8n workflows', kind: 'skill', description: 'Build n8n workflows: structure, error handling, naming rules.' },
  { name: 'translation_glossary', title: 'Übersetzungen', kind: 'skill', description: 'Übersetzen ins Englische: unser Glossar und unser Ton.' },
  // SQEM-703 — complementary playbooks for one task (an offer needs the offer, the product facts and the positioning),
  // and two alternatives for the same part (a job ad as a full ad or as a short social post).
  { name: 'product_facts', title: 'Produktfakten', kind: 'skill', description: 'Was unser Produkt kann: Funktionen, Pläne, Grenzen, Integrationen.' },
  { name: 'positioning', title: 'Positionierung', kind: 'skill', description: 'Wie wir uns gegenüber Wettbewerbern beschreiben und welchen Nutzen wir betonen.' },
  // SQEM-705 — a prompt that asks for the output only: "no commentary" must not switch the learning loop off.
  { name: 'email_rewrite', title: 'E-Mail umformulieren', kind: 'prompt', description: 'Eine E-Mail an einen Kunden klarer und höflicher umformulieren.' },
  { name: 'job_ad_short', title: 'Kurz-Stellenanzeige', kind: 'prompt', description: 'Eine kurze Stellenanzeige als Beitrag für soziale Netzwerke.' },
  { name: 'erp_kundenreview_mcp', title: 'ERP Kundenreview (MCP)', kind: 'skill', description: 'Für Vertriebs-Kundenreviews: Umsatz, Zahlungen und Artikel eines Kunden aus dem ERP, als Excel.' },
];
// SQEM-690 — enough content that a model has a playbook to follow: with "be concise; follow the house style" alone it
// fairly offered to extend the playbook, which the judge counted as a miss (L2, X2).
const CONTENT = {
  offer_letter: 'Write the offer for {{subject}}: scope, number of licences, price per licence, total, payment in 30 days, valid for 4 weeks. Ask for any figure that is not given; never invent one. Under 200 words.',
  pricing_guidelines: 'List price 40 EUR per licence and month. Discounts: 10 % from 20 licences, 15 % from 50, never more than 20 % without the managing director. Annual billing adds 5 %. Answer a discount request with what we can offer and what we ask in return.',
  job_ad: 'Write the job ad for {{subject}}: who we are (two sentences), the tasks (bullet list), what the person brings, what we offer, how to apply. We use "du". Under 250 words.',
  complaint_handling: 'Thank the customer, apologise once, say what happens next and by when. We may offer a credit up to 10 % of the order; anything more goes to the account manager. Never blame the carrier.',
  meeting_notes: 'Write the notes for {{subject}}: date, participants, decisions, action items with owner and due date, open questions. Bullet lists, no prose.',
  release_notes: 'Write the release notes for {{subject}}: a one-line summary, then New, Improved, Fixed, each a bullet list in plain language. No internal ticket numbers.',
  brand_voice: 'Short sentences. No jargon, no superlatives. Friendly but direct. Address the reader with "du" unless the reader is a customer we already address with "Sie".',
  process_diagrams: 'Draw the process top to bottom as a flowchart: one box per step, a diamond for each decision, the system or team in brackets in each box. Use Mermaid when the output is text.',
  proposal_checklist: 'Before an offer goes out, check: scope matches the request, price per licence and total, discount within the pricing guidelines, payment terms, validity date, signature line.',
  table_analysis: 'For a table of figures: total, average, highest and lowest, change from period to period in per cent, and the one or two outliers with a likely reason. End with one recommendation.',
  n8n_workflows: 'Name every node by what it does. Start with the trigger, validate the input, then write. Add an error workflow that notifies the team. Show the result as the node list and the JSON to import.',
  product_facts: 'The product: a shared library of skills, prompts and personas, reachable from every AI tool over MCP. Plans: Team and Business, billed per user. It does not host models; customers bring their own keys.',
  positioning: 'We lead with knowledge kept once and arriving in every tool. We never name a competitor negatively. Benefit first, feature second.',
  email_rewrite: 'Rewrite the email for {{subject}}. Address the customer formally ("Sie"). Close with "Mit freundlichen Grüßen". Return only the rewritten email. Do not add any commentary before or after.',
  job_ad_short: 'Write a social post for {{subject}}: three short lines, one call to apply, at most two hashtags.',
  translation_glossary: 'Translate into British English. Glossary: Playbook stays Playbook, Angebot is quote, Lizenz is licence. Keep "Sie" as a polite "you" in tone.',
};

const PERSONAS = [
  { name: 'sales_director', title: 'Sales Director', description: 'Neugeschäft: Angebote, Preisgespräche und Verhandlungen mit Interessenten.', routes: [['ein Angebot schreiben', 'offer_letter'], ['Preis oder Rabatt besprechen', 'pricing_guidelines'], ['ein Text beschreibt unser Produkt', 'product_facts'], ['ein Text soll einen Interessenten überzeugen', 'positioning']] },
  { name: 'account_manager', title: 'Account Manager', description: 'Bestandskunden: Verlängerungen, Angebote für weitere Lizenzen, Rabatte, Reklamationen.', routes: [['ein Angebot für einen Bestandskunden', 'offer_letter'], ['Preis- oder Rabattfragen', 'pricing_guidelines'], ['eine Reklamation', 'complaint_handling']] },
  { name: 'recruiter', title: 'Recruiter', description: 'Recruiting: Stellenanzeigen, Antworten an Bewerber, Vorbereitung von Interviews.', routes: [['einem Bewerber antworten', 'candidate_rejection'], ['eine Stellenanzeige schreiben', 'job_ad'], ['eine Stellenanzeige schreiben', 'job_ad_short']] },
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
    const routes = p.routes.map(([w, t]) => { const pb = PLAYBOOKS.find(x => x.name === t); return { name: t, title: pb.title, kind: pb.kind, condition: w, description: pb.description }; });
    let md = composePersona({ title: p.title, description: p.description, content: '' }, routes, [], { unattended: process.env.MOCK_UNATTENDED === '1' });
    // The real reader always closes with the improvement hint; the mock serves it only with MOCK_HINT, as before.
    if (!HINT) md = md.replace(/\n## After the task[\s\S]*$/, '');
    return md;
  }
  if (name === 'search_templates') {
    // SQEM-681 — like `searchTemplates` in `_shared/libraryQueries.ts`: the whole query, as text, in title or description.
    const needle = String(args.query || '').toLowerCase();
    const hits = needle ? PLAYBOOKS.filter(p => p.title.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle)) : [];
    const list = hits.map(p => ({ id: p.name, name: p.name, title: p.title, kind: p.kind, description: p.description }));
    // SQEM-690 — measured variant: an empty result says what to do next (read by the model, never shown to the person).
    if (!list.length && process.env.MOCK_EMPTY_HINT === '1') return { results: [], next: 'No match for this word. Try another word, or call list_templates.' };
    return list;
  }
  if (name === 'list_templates') return PLAYBOOKS.filter(p => !args.kind || p.kind === args.kind).map(p => ({ id: p.name, name: p.name, title: p.title, kind: p.kind, description: p.description }));
  if (name === 'get_template') {
    const p = PLAYBOOKS.find(x => x.name === args.name || x.name === args.id);
    if (!p) return { error: 'Template not found' };
    // SQEM-623 — the rejection playbook states a rule (formal "Sie", no reason given) that case C2 contradicts.
    const content = p.name === 'candidate_rejection'
      ? 'Write the rejection for {{subject}}. Address the candidate formally ("Sie"). Do not state a reason for the rejection. Keep it under 150 words.'
      : CONTENT[p.name] ?? (p.kind === 'skill' ? `Rules for ${p.title}: be concise; follow the house style.` : `Write the ${p.title.toLowerCase()} for {{subject}}. Keep it under 150 words.`);
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
