// SQEM-487 — measure which Sqemes tool Claude reaches for, with a given library prompt pasted in.
// SQEM-487 — which Sqemes tool does Claude reach for, with a given library prompt pasted in?
// Runs Claude Code headless (`claude -p`, your own login) against mock-mcp.mjs, a local MCP server
// with a FAKE library and the real tool descriptions, and judges each run by the calls it made.
//
//   node scripts/prompt-eval/run.mjs <variant> <prompt-file> [runs=3] [parallel=3] [CASE,CASE]
//
// Write the current prompt to a file first:
//   node -e "const s=require('fs').readFileSync('supabase/functions/_shared/libraryPrompt.ts','utf8');
//            require('fs').writeFileSync('/tmp/prompt.txt', s.match(/LIBRARY_SYSTEM_PROMPT = \`([\s\S]*?)\`;/)[1])"
// Each run
// costs one short Claude Code session on the account that is logged in; results land in
// scripts/prompt-eval/results/<variant>/ (git-ignored).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const [variant, promptFile, runsArg = '3', parArg = '3', only] = process.argv.slice(2);
const RUNS = Number(runsArg), PAR = Number(parArg);
const HERE = new URL('.', import.meta.url).pathname;
const PROMPT = readFileSync(promptFile, 'utf8');

// SQEM-683 — the text a routine run adds (`UNATTENDED_INSTRUCTION` in `_shared/routineRun.ts`), read from the source.
const ROUTINE = (() => {
  const src = readFileSync(new URL('../../supabase/functions/_shared/routineRun.ts', import.meta.url), 'utf8');
  const block = src.match(/UNATTENDED_INSTRUCTION = \[([\s\S]*?)\]\.join/)[1];
  return [...block.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'")).join('\n');
})();

const CASES = [
  { id: 'P1', type: 'persona', want: 'recruiter', q: 'Schreib eine Absage an einen Bewerber für die Stelle als Backend-Entwickler.' },
  { id: 'P2', type: 'persona', want: 'recruiter', q: 'Ich brauche eine Stellenanzeige für eine Werkstudentin im Marketing.' },
  { id: 'P3', type: 'persona', want: 'sales_director', q: 'Bereite mich auf ein Preisgespräch mit einem Neukunden vor.' },
  // SQEM-689 — two fitting personas: ONE is loaded and the other is named, so the person can switch (no longer: ask).
  { id: 'M1', type: 'pick', want: ['sales_director', 'account_manager'], q: 'Erstelle ein Angebot über 50 Lizenzen für einen Kunden.' },
  { id: 'M2', type: 'pick', want: ['sales_director', 'account_manager'], q: 'Ein Kunde will mehr Rabatt. Wie antworte ich ihm?' },
  { id: 'T1', type: 'playbook', want: 'release_notes', q: 'Schreib Release Notes für Version 2.3: Login ist schneller, der Export-Fehler ist behoben.' },
  { id: 'T2', type: 'playbook', want: 'meeting_notes', q: 'Fass dieses Meeting zusammen: Wir haben beschlossen, das Projekt bis Q2 zu verschieben; Anna klärt das Budget.' },
  { id: 'T3', type: 'playbook', want: 'brand_voice', q: 'Formulier diesen Satz in unserer Markenstimme: Wir sind ab Montag wieder erreichbar.' },
  // SQEM-623 — a correction of the loaded playbook should end in ONE offer to update it; T1–T3 must stay quiet.
  { id: 'C1', type: 'correct', want: 'release_notes', q: 'Schreib Release Notes für Version 2.3: Login ist schneller, der Export-Fehler ist behoben. Wichtig: Bei uns haben Release Notes immer einen Abschnitt „Bekannte Probleme“, der fehlt in eurer Vorlage.' },
  { id: 'C2', type: 'correct', want: 'candidate_rejection', q: 'Schreib eine Absage an einen Bewerber für die Stelle als Backend-Entwickler. Achtung: Wir duzen Bewerber grundsätzlich, und wir nennen immer einen konkreten Grund für die Absage.' },
  // SQEM-681 — the person NAMES a playbook, spelled differently from its title; or one that does not exist.
  { id: 'S1', type: 'named', want: 'brand_voice', q: 'Nutze unseren Skill „Brand Voice“ und formulier: Wir sind ab Montag wieder erreichbar.' },
  { id: 'S2', type: 'named', want: 'meeting_notes', q: 'Nimm das Playbook Meeting Protokoll und fass zusammen: Wir verschieben das Projekt bis Q2; Anna klärt das Budget.' },
  { id: 'S3', type: 'named', want: 'pricing_guidelines', q: 'Wende die Preis-Richtlinien an: Ein Kunde will 30 Prozent Rabatt. Was antworte ich?' },
  { id: 'S4', type: 'missing', q: 'Nutze unser Playbook „Onboarding-Checkliste“ und erstelle mir die Liste für eine neue Kollegin.' },
  // SQEM-682 — a role's task that ALSO needs a playbook none of its routes covers: persona AND that playbook.
  { id: 'R1', type: 'both', want: ['recruiter', 'brand_voice'], q: 'Schreib eine Stellenanzeige für eine Werkstudentin im Marketing, in unserer Markenstimme.' },
  { id: 'R2', type: 'both', want: ['sales_director', 'meeting_notes'], q: 'Ich hatte gerade ein Preisgespräch mit einem Neukunden. Mach mir daraus ein Meeting-Protokoll: Er will 50 Lizenzen, wir haben 10 Prozent Rabatt angeboten, er meldet sich Freitag.' },
  // SQEM-683 — German request, English title (named, unnamed); and a routine, which may not ask, with two fitting personas.
  { id: 'L1', type: 'named', want: 'proposal_checklist', q: 'Nutze unsere Angebots-Checkliste und prüf mein Angebot: 50 Lizenzen, 10 Prozent Rabatt, Zahlung in 30 Tagen.' },
  { id: 'L2', type: 'playbook', want: 'process_diagrams', q: 'Zeichne mir ein Ablaufdiagramm für unseren Bestellprozess: Bestellung per E-Mail, Prüfung im Lager, Versand, Rechnung.' },
  // SQEM-685 — a named title with a bracket: one get_template on a guessed name, then "not found".
  { id: 'L4', type: 'named', want: 'erp_kundenreview_mcp', q: 'Nutze den Skill "ERP Kundenreview (MCP)" und erstelle den Kundenreview für die Musterfirma GmbH als Excel.' },
  { id: 'L3', type: 'routine', want: ['sales_director', 'account_manager'], extra: ROUTINE, q: 'Erstelle ein Angebot über 50 Lizenzen für einen Kunden.' },
  { id: 'N1', type: 'none', q: 'Was ist die Hauptstadt von Australien?' },
  { id: 'N2', type: 'none', q: 'Erklär mir in zwei Sätzen, was ein Mutex ist.' },
].filter(c => !only || only.split(',').includes(c.id));

const OUT = join(HERE, 'results', variant);
mkdirSync(OUT, { recursive: true });
// ⛔ OUTSIDE the repository: run from inside it, Claude Code picks up this project's own agent
// instructions and settings, and the mock server was not reachable at all (seen 2026-10-19). An empty temp dir is the
// clean room the numbers in the module header were measured in.
const WORK = mkdtempSync(join(tmpdir(), 'sqemes-prompt-eval-'));

function runOne(c, n) {
  return new Promise((resolve) => {
    const log = join(OUT, `${c.id}-${n}.calls.jsonl`);
    if (existsSync(log)) rmSync(log);
    const cfg = join(OUT, `${c.id}-${n}.mcp.json`);
    writeFileSync(cfg, JSON.stringify({ mcpServers: { sqemes: { type: 'stdio', command: 'node', args: [join(HERE, 'mock-mcp.mjs')], env: { MOCK_LOG: log, MOCK_HINT: process.env.MOCK_HINT ?? '', MOCK_UNATTENDED: c.type === 'routine' ? '1' : '' } } } }));
    const args = ['-p', c.q, '--append-system-prompt', c.extra ? `${PROMPT}\n\n${c.extra}` : PROMPT, '--mcp-config', cfg, '--strict-mcp-config',
      '--allowedTools', 'mcp__sqemes__search_templates,mcp__sqemes__list_templates,mcp__sqemes__get_template,mcp__sqemes__list_personas,mcp__sqemes__get_persona',
      '--disallowedTools', 'Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Task,Agent,TodoWrite,NotebookEdit',
      '--setting-sources', 'project', '--model', 'sonnet', '--max-turns', '8', '--output-format', 'json', '--no-session-persistence'];
    const p = spawn('claude', args, { cwd: WORK, env: { ...process.env } });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', () => {});
    const timer = setTimeout(() => p.kill('SIGKILL'), 240_000);
    p.on('close', () => {
      clearTimeout(timer);
      let text = '';
      try { text = JSON.parse(out).result ?? ''; } catch { text = out.slice(0, 2000); }
      const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
      resolve(judge(c, n, calls, text));
    });
  });
}

function judge(c, n, calls, text) {
  const tools = calls.map(k => k.tool);
  const personaLoaded = calls.filter(k => k.tool === 'get_persona').map(k => k.args.name || k.args.id);
  // SQEM-683 — only a template that was really there counts as loaded; a miss on a guessed name does not.
  const templates = calls.filter(k => k.tool === 'get_template' && k.found !== false).map(k => k.args.name || k.args.id);
  let ok;
  if (c.type === 'persona') ok = personaLoaded.includes(c.want);
  // SQEM-689 — exactly one of the two loaded, the other named by its title or its name (SQEM-683: either counts).
  const title = n => n.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  const named = n => text.includes(n) || text.includes(title(n));
  if (c.type === 'pick') ok = c.want.filter(w => personaLoaded.includes(w)).length === 1 && c.want.some(w => !personaLoaded.includes(w) && named(w));
  // SQEM-689 — noise check: a clear role case should not name another persona as an alternative (recorded, not judged).
  const alt = ['sales_director', 'account_manager', 'recruiter'].some(w => !personaLoaded.includes(w) && named(w));
  if (c.type === 'playbook') ok = templates.includes(c.want);
  if (c.type === 'none') ok = tools.length === 0;
  // SQEM-683 — a routine may not ask: it loads one of the two fitting personas instead of offering the choice.
  if (c.type === 'routine') ok = personaLoaded.some(p => c.want.includes(p));
  if (c.type === 'both') ok = personaLoaded.includes(c.want[0]) && templates.includes(c.want[1]);
  // SQEM-681 — found despite the spelling; a missing one is SAID, not silently skipped.
  if (c.type === 'named') ok = templates.includes(c.want);
  // SQEM-685 — also "nichts … gefunden", "konnte … nicht finden", "finde … keine" (three false misses in one run).
  if (c.type === 'missing') ok = templates.length === 0 && /(nicht gefunden|nichts[^.?!\n]{0,60}gefunden|nicht finden|finde[^.?!\n]{0,60}kein|kein[^.?!\n]{0,40}gefunden|finde[^.?!\n]{0,40}nicht|nicht vorhanden|gibt es[^.?!\n]{0,40}nicht|existiert nicht|kein[^.?!\n]{0,30}(playbook|vorlage)[^.?!\n]{0,30}(namens|mit dem namen|„onboarding))/i.test(text);
  // SQEM-623 — an offer is a sentence naming the playbook/persona/template next to a change verb.
  // SQEM-683 — also "Soll ich es … aktualisieren / umstellen", where the playbook was named one sentence earlier.
  const offered = /(playbook|vorlage|persona|template)[^.?!\n]{0,160}(anpass|aktualis|ergänz|erweiter|aufnehm|übernehm|hinzufüg|speicher|update)|(anpass|aktualis|ergänz|erweiter|aufnehm|übernehm|hinzufüg|speicher|update)[^.?!\n]{0,160}(playbook|vorlage|persona|template)|soll ich (es|sie|das)[^.?!\n]{0,80}(anpass|aktualis|ergänz|umstell|überarbeit)/i.test(text);
  if (c.type === 'correct') ok = templates.includes(c.want) && offered;
  if (c.type === 'playbook') ok = ok && !offered;
  const r = { variant, id: c.id, type: c.type, n, ok, offered, alt, first: tools[0] ?? '-', tools: tools.join('>'), persona: personaLoaded.join(','), templates: templates.join(','), text: text.slice(0, 3000) };
  writeFileSync(join(OUT, `${c.id}-${n}.json`), JSON.stringify(r, null, 2));
  console.log(`${variant} ${c.id}#${n} ${ok ? 'OK ' : 'NO '} first=${r.first} tools=${r.tools || '-'}`);
  return r;
}

const jobs = CASES.flatMap(c => Array.from({ length: RUNS }, (_, i) => [c, i + 1]));
const results = [];
let next = 0;
await Promise.all(Array.from({ length: PAR }, async () => {
  while (next < jobs.length) { const [c, n] = jobs[next++]; results.push(await runOne(c, n)); }
}));
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(results, null, 2));
const by = {};
for (const r of results) { by[r.id] ??= []; by[r.id].push(r.ok); }
console.log('\nSUMMARY', variant);
for (const c of CASES) console.log(c.id, c.type.padEnd(8), (by[c.id] || []).filter(Boolean).length + '/' + (by[c.id] || []).length);
const ok = results.filter(r => r.ok).length;
console.log('TOTAL', ok + '/' + results.length);
