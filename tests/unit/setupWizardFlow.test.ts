import { describe, it, expect, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import SecretInput from '../../components/ui/SecretInput';

/**
 * SQEM-386 — the setup wizard: one order, a why, an end.
 *
 * ⚠️ `SetupWizard` imports the store and `lib/api` → Supabase, which throws at import without env
 * vars (see `tests-must-not-import-supabase`), so it cannot be rendered here. What CAN be pinned is
 * what three UX tests asked for, read from the source: the order, the three key variants, the two
 * exits with honest labels, the wording that confused people, and that the last step exists and
 * ends in "Done" and nothing else. `SecretInput` is a primitive and IS rendered.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const WIZARD = read('components/SetupWizard.tsx');
const CREATE = read('components/WizardCreateStep.tsx');
/** Source minus comments — the comments deliberately quote the OLD labels as history. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const WIZARD_CODE = code(WIZARD);
const CREATE_CODE = code(CREATE);

describe('⛔ SQEM-386 — one order everywhere: Welcome → Templates → Where to use them → (setup) → AI key → You\'re set', () => {
  it('the step list keeps one order, templates guarded for self-host only', () => {
    // SQEM-414 — the list is built from the chosen channels now (`STEPS_FOR`), but the ORDER is still
    // one list, and the extension/MCP steps sit between the question and the AI key, never before it.
    const m = WIZARD.match(/const STEPS_FOR[\s\S]*?\n\];/);
    expect(m, 'STEPS_FOR list').not.toBeNull();
    const steps = m![0];
    const order = ['welcome', 'templates', 'channels', 'extension', 'mcp', 'provider', 'done'].map(id => steps.indexOf(`id: '${id}'`));
    expect(order.every(i => i >= 0), `all ids present: ${order}`).toBe(true);
    expect([...order].sort((a, b) => a - b), 'in order').toEqual(order);
    // The ONLY environment branch is the templates step; the rest is one list.
    expect(steps.match(/IS_SELF_HOSTED/g)?.length).toBe(1);
    expect(steps).toMatch(/IS_SELF_HOSTED \? \[\] : \[\{ id: 'templates'/);
  });

  it('the progress bar counts working steps only — neither the welcome screen nor the ledger is a step to "do"', () => {
    expect(WIZARD_CODE).toMatch(/const WORK_STEPS = useMemo\(\(\) => STEPS\.filter\(s => s\.id !== 'welcome' && s\.id !== 'done'\)/);
    expect(WIZARD_CODE).toMatch(/WORK_STEPS\.map\(/);
    // Welcome sits at index 0, so the visible step number is the index itself.
    expect(WIZARD_CODE).toMatch(/Step \{step\} of \{WORK_STEPS\.length\}/);
  });

  it('⛔ round 2 — a welcome screen carries the why and the outcome; the header no longer does', () => {
    expect(WIZARD_CODE).toMatch(/current === 'welcome' && \(/);
    expect(WIZARD_CODE).toMatch(/Welcome to sqemes/);
    // SQEM-420 — the why and the outcome stay; the step COUNT is gone, see the SQEM-420 block below.
    expect(WIZARD_CODE).toMatch(/A few minutes, and your first playbooks are ready/);
    expect(WIZARD_CODE).toMatch(/A few minutes, and your playbooks work where you already do/);
    expect(WIZARD_CODE).toMatch(/Let&apos;s go/);
    // The first cut's header sentence is gone — it crowded the first step ("cold water").
    expect(WIZARD_CODE).not.toMatch(/At the end your first templates are ready — in Chat/);
  });

  it('"connect a key" from the templates step jumps by id, not to index 0', () => {
    expect(WIZARD_CODE).toMatch(/onConnectKey=\{\(\) => goTo\('provider'\)\}/);
    expect(WIZARD_CODE).not.toMatch(/onConnectKey=\{\(\) => setStep\(0\)\}/);
  });
});

describe('⛔ SQEM-386 — the key step in three variants', () => {
  it('credits / included / required exist, and "included" covers the managed workspace', () => {
    expect(WIZARD_CODE).toMatch(/const keyMode: 'credits' \| 'included' \| 'required'/);
    expect(WIZARD_CODE).toMatch(/workspace\.isManaged\) \? 'included'/);
  });
  it('the reassurance is the headline, in the two optional variants', () => {
    expect(WIZARD_CODE).toMatch(/You can start right away/);
    expect(WIZARD_CODE).toMatch(/AI is included in your workspace/);
    expect(WIZARD_CODE).toMatch(/Optional: add your own key/);
  });
  it('the required variant still says why, for self-host and for Cloud without a funded model', () => {
    expect(WIZARD_CODE).toMatch(/This instance runs on your own keys/);
    // SQEM-418 — the reason now follows the channel choice: Chat is named only when it was picked,
    // and otherwise the sentence names what actually stops working without a key.
    expect(WIZARD_CODE).toMatch(/for AI in sqemes Chat and for generating playbooks here/);
    expect(WIZARD_CODE).toMatch(/for generating and adapting playbooks here/);
  });
  it('the old footnote block under the provider grid is gone', () => {
    expect(WIZARD_CODE).not.toMatch(/mt-6 pt-5 border-t[^\n]*\n\s*<div className="flex items-start gap-3">\n\s*<div className="p-2\.5 rounded-xl bg-emerald-50/);
  });
  it('the key field can be revealed', () => {
    expect(WIZARD_CODE).toMatch(/<SecretInput\b/);
    expect(WIZARD_CODE).not.toMatch(/type="password"/);
  });
});

describe('⛔ SQEM-386 — exits say what they do', () => {
  it('the whole-wizard exit names the way back; the step exit is "Skip for now"', () => {
    expect(WIZARD_CODE).toMatch(/Later — reopen from the dashboard/);
    expect(WIZARD_CODE).not.toMatch(/I&apos;ll do this later/);
    expect(WIZARD_CODE).not.toMatch(/Skip this step/);
    expect(WIZARD_CODE).toMatch(/'Skip for now'/);
  });
  it('on the templates step "Skip for now" moves on — it no longer closes the wizard', () => {
    expect(WIZARD_CODE).toMatch(/<button onClick=\{next\} className=\{MUTED_BTN\}>Skip for now<\/button>/);
    expect(WIZARD_CODE).not.toMatch(/onClick=\{\(\) => onClose\(true\)\} className=\{MUTED_BTN\}>Skip for now/);
  });
});

describe('⛔ SQEM-386 — the end is a ledger with one button', () => {
  it('the done step exists, names the end state and ends in Done', () => {
    expect(WIZARD_CODE).toMatch(/current === 'done' && \(/);
    // SQEM-417 — the headline is the achievement ("3 playbooks ready"), with the neutral fallback for
    // a run that created none. "You're set" survives as the step's label in STEPS, which is what the
    // progress line reads out. The rule this test guards is unchanged: the last screen says the run is
    // over, and exactly one button ends it.
    expect(WIZARD_CODE).toMatch(/playbook\{createdCount === 1 \? '' : 's'\} ready/);
    expect(WIZARD_CODE).toMatch(/Your workspace is ready/);
    expect(WIZARD_CODE).toMatch(/label: "You're set"/);
    expect(WIZARD_CODE).toMatch(/<button onClick=\{finish\} className=\{PRIMARY_BTN\}>Done<\/button>/);
  });
  it('it reports the real count and the three states, and offers no "try it" action', () => {
    expect(WIZARD_CODE).toMatch(/\{createdCount\} playbook\{createdCount === 1 \? '' : 's'\} created/);
    expect(WIZARD_CODE).toMatch(/No playbooks yet/);
    // SQEM-423 — the three key states are still all reported, now inside the single sqemes Chat row
    // (credits · included · a key of your own) instead of a second row repeating the subject.
    expect(WIZARD_CODE).toMatch(/It runs on the AI credits included in your workspace/);
    expect(WIZARD_CODE).toMatch(/AI is included in your workspace — nothing to do/);
    expect(WIZARD_CODE).toMatch(/Your own key powers it, so AI here is unlimited/);
    expect(WIZARD_CODE).not.toMatch(/Try .* in Chat/);
    expect(WIZARD_CODE).not.toMatch(/launchTemplateId/);
  });
  it('WizardCreateStep reports the count and no longer navigates; the wizard lands on Templates from Done', () => {
    expect(CREATE_CODE).toMatch(/onComplete: \(createdCount: number\) => void/);
    expect(CREATE_CODE).toMatch(/onComplete\(chosen\.length\)/);
    expect(CREATE_CODE).not.toMatch(/navigate\(/);
    expect(CREATE_CODE).not.toMatch(/useNavigate/);
    expect(WIZARD_CODE).toMatch(/if \(createdCount > 0\) navigate\('\/playbooks'\)/);
  });
});

describe('SQEM-386 — the words that confused people', () => {
  it('"library" is not what the button says', () => {
    expect(CREATE_CODE).not.toMatch(/Generate library|Generating your library/);
    expect(CREATE_CODE).toMatch(/Generate my starter playbooks/);
  });
  it('the review step says whose templates these are', () => {
    expect(CREATE_CODE).toMatch(/Generated for \{brand\.brandName\.trim\(\) \|\| 'your brand'\} from what you told us/);
  });
  it('the extension step leads with the benefit, names what is missing without it, and that it can wait', () => {
    // SQEM-423 — the title is now the channel card's ("In your browser"); the benefit moved into the
    // sentence under it, which is what this test was really about.
    expect(WIZARD_CODE).toMatch(/tracking-tight">In your browser<\/h3>/);
    expect(WIZARD_CODE).toMatch(/The extension brings your playbooks into the AI you already use/);
    // SQEM-420 — same three jobs, but "Chat only" became "Chat and your MCP tools" (SQEM-414).
    expect(WIZARD_CODE).toMatch(/Without it, they still work in sqemes Chat and in your MCP tools/);
    expect(WIZARD_CODE).toMatch(/install it any time from Settings/);
  });
  it('⛔ round 3/4 — the extension CTA is a button to the store led by the store\'s own glyph; no badge, no Chrome mark; it says a tab opens', () => {
    expect(WIZARD_CODE).toMatch(/href=\{CHROME_STORE_URL\}[\s\S]*?<ChromeWebStoreIcon className="w-4 h-4" \/> Install from Chrome Web Store/);
    // The glyph is CC0 (Simple Icons) and inline; nothing under assets/browsers/ carries a Chrome mark any more.
    expect(readdirSync(resolve(ROOT, 'assets/browsers'))).not.toContain('chrome.svg');
    expect(WIZARD_CODE).toMatch(/Opens the Chrome Web Store in a new tab\. Come back here after installing — this step will notice\./);
    expect(WIZARD_CODE).not.toMatch(/badgeSrc|assets\/webstore|IconTile|chrome\.svg|Works on/);
  });

  it('⛔ round 3 — the wizard notices an install made in another tab: the hook pings again on focus', () => {
    const hook = code(read('hooks/useExtensionInstalled.ts'));
    expect(hook).toMatch(/addEventListener\('focus', again\)/);
    expect(hook).toMatch(/addEventListener\('visibilitychange', again\)/);
    expect(hook).toMatch(/removeEventListener\('focus', again\)/);
  });

  it('⛔ round 2 — the wizard form is website-first; Settings keeps the full form', () => {
    // `[\s\S]*?`, not `[^>]*`: the props carry an arrow function, and `=>` ends a `[^>]` run early.
    expect(CREATE_CODE).toMatch(/<BrandProfileForm[\s\S]*?collapsible \/>/);
    const settings = code(read('pages/Settings.tsx'));
    const usage = settings.match(/<BrandProfileForm[\s\S]*?\/>/)![0];
    expect(usage).not.toMatch(/collapsible/);
    const form = code(read('components/BrandProfileForm.tsx'));
    // Round 3: two exclusive views with a link each way; the analysis lands on the fields.
    expect(form).toMatch(/Or fill in the details yourself/);
    expect(form).toMatch(/← Analyze a website instead/);
    expect(form).toMatch(/onChange\(patch\);\s*setView\('manual'\);/);
    expect(form).toMatch(/\(!collapsible \|\| view === 'website'\) && \(/);
    expect(form).toMatch(/\(!collapsible \|\| view === 'manual'\) && \(/);
  });

  it('round 3 — the ledger points to the Template Wizard; Personas moved out to the Gleap onboarding', () => {
    expect(WIZARD_CODE).toMatch(/Playbook Wizard<\/Link> writes it from a sentence/);
    expect(WIZARD_CODE).not.toMatch(/Next: Personas|Persona Wizard/);
    expect(WIZARD_CODE).not.toMatch(/id: 'personas'/);
  });
  it('SQEM-395 — the tone select is gone; the form asks the three facts and the website', () => {
    // SQEM-386 had relabelled it "Tone of your playbooks"; SQEM-395 removed it (and the use-case field).
    const form = code(read('components/BrandProfileForm.tsx'));
    expect(form).not.toMatch(/Tone of your playbooks|use AI for/);
    expect(form).toMatch(/Brand name/);
    expect(form).toMatch(/What does your brand do\?/);
    expect(form).toMatch(/Who is your audience\?/);
  });
  it('"Finish setup" stretches across on a phone', () => {
    const dash = read('pages/Dashboard.tsx');
    const i = dash.indexOf('Finish setup <ArrowRight');
    expect(i).toBeGreaterThan(-1);
    // SQEM-419 restyled the button (white on the brand band); the phone rule survives it.
    expect(dash.slice(Math.max(0, i - 600), i)).toMatch(/w-full sm:w-auto justify-center/);
  });
});

// SQEM-419 — the two banners above the wizard now look like the wizard they lead into.
describe('SQEM-419 — the dashboard banners', () => {
  const dash = read('pages/Dashboard.tsx');

  it('the setup banner is the wizard’s brand band, and survives dark mode', () => {
    const i = dash.indexOf('Finish setting up your workspace');
    expect(i).toBeGreaterThan(-1);
    const banner = dash.slice(Math.max(0, i - 900), i);
    expect(banner).toMatch(/from-brand-900 via-brand-800 to-brand-700/);
    // ⚠️ Without the ring a dark band dissolves into a dark dashboard.
    expect(banner).toMatch(/dark:ring-1 dark:ring-brand-700\/60/);
    expect(banner).toMatch(/animate-step-in/);
  });

  it('⛔ the trial banner stays light — two dark bands would fight for the same attention', () => {
    const i = dash.indexOf('Your card is on file');
    const banner = dash.slice(Math.max(0, i - 2400), i);
    expect(banner).not.toMatch(/from-brand-900/);
    // The days left are a chip, not a clause inside a sentence.
    expect(banner).toMatch(/day left' : `\$\{d\} days left`/);
  });

  it('the cancelled state keeps its amber — it is a warning, not an invitation', () => {
    const i = dash.indexOf('Your subscription is cancelled');
    expect(dash.slice(Math.max(0, i - 2600), i)).toMatch(/bg-amber-50 dark:bg-amber-900\/20/);
  });
});

describe('SQEM-386 — SecretInput reveals and hides', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; });

  it('starts hidden, toggles to text and back, and keeps every other prop', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(React.createElement(SecretInput, { placeholder: 'sk-…', className: 'p-2' })));
    const input = host.querySelector('input')!;
    const toggle = host.querySelector('button')!;
    expect(input.type).toBe('password');
    expect(input.placeholder).toBe('sk-…');
    expect(input.className).toContain('p-2');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    act(() => { toggle.click(); });
    expect(input.type).toBe('text');
    expect(toggle.getAttribute('aria-label')).toBe('Hide key');
    act(() => { toggle.click(); });
    expect(input.type).toBe('password');
  });
});

// SQEM-413 — the way back out of the review. The old one was a "← Edit brand" link that a UX tester
// read as "edit colours and logo" and never used; the footer's Back left the whole step instead.
describe('SQEM-413 — Back belongs to the step while its review is open', () => {
  const wizard = readFileSync(resolve(__dirname, '../../components/SetupWizard.tsx'), 'utf8');
  const step = readFileSync(resolve(__dirname, '../../components/WizardCreateStep.tsx'), 'utf8');

  it('the wizard asks the step first and only then walks back a step', () => {
    expect(wizard).toMatch(/if \(stepBack\) \{ stepBack\(\); return; \}/);
    // The updater form matters: a function put into state directly would be CALLED by React.
    expect(wizard).toMatch(/onBackChange=\{handler => setStepBack\(\(\) => handler\)\}/);
  });

  it('the step claims Back while it has a phase of its own to go back to', () => {
    // SQEM-416 — two rungs now: review → areas → brand, and only the first phase hands Back back.
    expect(step).toMatch(/phase === 'review' \? \(\) => setPhase\('areas'\)/);
    expect(step).toMatch(/phase === 'areas' \? \(\) => setPhase\('brand'\)/);
    expect(step).toMatch(/: null,/);
    // The phrase survives in the comment that records WHY it went — the rendered link must not.
    expect(step).not.toMatch(/>← Edit brand</);
  });

  it('the areas decide what is generated — and travel on as the playbook’s tag', () => {
    expect(step).toContain('Which areas should your first playbooks cover?');
    expect(step).toMatch(/tag: d\.area \?\? null/);
    expect(step).toMatch(/MAX_AREAS = 3/);
  });
});


// SQEM-425 — the MCP row could never be ticked. The owner asked when it turns green; the answer was
// "never", which is what made it a bug.
describe('SQEM-425 — the MCP row states what is known', () => {
  const api = read('lib/api/apiKeys.ts');

  it('⛔ no empty checkbox that can never be ticked', () => {
    const done = WIZARD_CODE.slice(WIZARD_CODE.indexOf("current === 'done' && ("));
    const row = done.slice(done.indexOf("channels.includes('mcp')"));
    const end = row.indexOf('</li>');
    expect(row.slice(0, end)).not.toMatch(/<Circle /);
    expect(row.slice(0, end)).toMatch(/<McpIcon /);
  });

  it('the check is earned: a key that a tool actually used', () => {
    expect(api).toMatch(/\.not\('last_used_at', 'is', null\)/);
    expect(api).toMatch(/export async function hasUsedMcpConnection/);
    expect(WIZARD_CODE).toMatch(/mcpConnected\s*\n?\s*\? <CheckCircle2/);
    expect(WIZARD_CODE).toMatch(/Connected — a tool has already used this workspace/);
  });

  it('⚠️ unknown renders as not-confirmed — never as a check', () => {
    // RLS shows a member only their own keys, and the wizard is not admin-only: the query must fail
    // to false rather than throw or guess.
    expect(api).toMatch(/if \(error\) return false;/);
    expect(api).toMatch(/\} catch \{\s*\n\s*return false;/);
  });

  it('it is asked only where it matters, and not after the wizard closes', () => {
    expect(WIZARD_CODE).toMatch(/if \(current !== 'done' \|\| !channels\.includes\('mcp'\) \|\| !workspace\.id\) return;/);
    expect(WIZARD_CODE).toMatch(/let cancelled = false;/);
    expect(WIZARD_CODE).toMatch(/if \(!cancelled\) setMcpConnected/);
  });
});

// SQEM-424 — four wordings the owner caught while walking the wizard.
describe('SQEM-424 — what the copy promises and in which order', () => {
  const dash = read('pages/Dashboard.tsx');

  it('the welcome screen promises reversibility, not mechanics', () => {
    expect(WIZARD_CODE).toContain('Nothing here is final — you can change any of it later in Settings.');
    expect(WIZARD_CODE).not.toMatch(/No steps for anything you did not pick/);
  });

  it('⛔ the dashboard banner no longer advertises the pre-SQEM-386 order', () => {
    // Key first, playbooks last is the order three UX tests rejected.
    expect(dash).not.toMatch(/Add a provider key, install the extension, and let AI build your first playbooks/);
    expect(dash).toMatch(/Let AI write your first playbooks, choose where you want to use them/);
  });

  it('⚠️ and it does not promise playbook generation on self-host', () => {
    const i = dash.indexOf('Let AI write your first playbooks');
    expect(dash.slice(Math.max(0, i - 400), i)).toMatch(/IS_SELF_HOSTED/);
    expect(dash).toMatch(/Choose where you want to use your playbooks — and set up only that/);
  });

  it('the step chips are the owner\'s names', () => {
    expect(WIZARD_CODE).toMatch(/id: 'mcp' as const, label: 'MCP'/);
    expect(WIZARD_CODE).toMatch(/id: 'provider' as const, label: 'AI provider keys'/);
    // ⚠️ The chip may abbreviate; the step's own heading may not (SQEM-201).
    expect(WIZARD_CODE).toMatch(/tracking-tight">In Claude Code, Cursor and Codex<\/h3>/);
  });

  it('the dashboard says the same words as the step it leads to', () => {
    expect(dash).toMatch(/flex-1">AI provider keys<\/span>/);
  });
});

// SQEM-423 — a step wears the icon and the title of the card that led to it, and the closing ledger
// stopped saying sqemes Chat twice.
describe('SQEM-423 — step and card are the same thing', () => {
  it('the browser step is the browser card', () => {
    expect(WIZARD_CODE).toMatch(/<Chromium className="w-5 h-5" \/>/);
    expect(WIZARD_CODE).toMatch(/tracking-tight">In your browser<\/h3>/);
  });

  it('the MCP step is the MCP card, and still names the clients somewhere', () => {
    expect(WIZARD_CODE).toMatch(/tracking-tight">In Claude Code, Cursor and Codex<\/h3>/);
    expect(WIZARD_CODE).toMatch(/Claude Desktop, Cursor, VS Code, Codex and Claude Code/);
  });

  it('⛔ the key step is the Chat card ONLY when Chat was chosen', () => {
    expect(WIZARD_CODE).toMatch(/channels\.includes\('chat'\) \? <MessageSquare className="w-5 h-5" \/> : <Key className="w-5 h-5" \/>/);
    expect(WIZARD_CODE).toMatch(/channels\.includes\('chat'\) \? 'In sqemes Chat' : 'Add an AI provider key'/);
    expect(WIZARD_CODE).toMatch(/channels\.includes\('chat'\) \? 'In sqemes Chat' : 'Optional: add your own key'/);
  });

  it('⚠️ "Optional" survives the new headline — it moved into the sentence (SQEM-386)', () => {
    expect(WIZARD_CODE).toMatch(/Optional — unlimited AI with your own ChatGPT/);
    // And the reassurance block it belongs to is untouched.
    expect(WIZARD_CODE).toMatch(/You can start right away/);
  });

  it('⛔ the ledger says sqemes Chat once, not twice', () => {
    const done = WIZARD_CODE.slice(WIZARD_CODE.indexOf("current === 'done' && ("));
    const rows = [...done.matchAll(/font-semibold text-slate-900 dark:text-slate-100">(sqemes Chat|AI in sqemes[^<]*)</g)];
    expect(rows.map(r => r[1])).toEqual(['sqemes Chat', 'AI in sqemes']);
    // They never render together: one needs Chat, the other needs Chat NOT to be there.
    expect(done).toMatch(/!channels\.includes\('chat'\) && keyMode === 'required'/);
  });
});

// SQEM-421 — the three channel cards carry the website's own sentences and icons. Someone arriving
// here has just read them on sqemes.com; saying the same thing differently is how one product starts
// to feel like two.
describe('SQEM-421 — the channel cards match the website', () => {
  it('each card carries the website sentence, word for word', () => {
    for (const text of [
      'Your playbooks inside ChatGPT, Claude and Gemini. One click away, without switching tabs.',
      'Run your playbooks with any AI provider you connect, straight inside the sqemes webapp.',
      'The same playbooks inside Claude Code, Codex, Cursor and any other tool that connects via MCP.',
    ]) expect(WIZARD_CODE).toContain(text);
  });

  it('⛔ the third card names MCP — the whole point of the rewrite', () => {
    expect(WIZARD_CODE).toContain('In Claude Code, Cursor and Codex');
    expect(WIZARD_CODE).toMatch(/connects via MCP/);
  });

  it('the icons are the website\'s: lucide chromium, lucide message-square, the MCP mark', () => {
    expect(WIZARD_CODE).toMatch(/icon: <Chromium /);
    expect(WIZARD_CODE).toMatch(/icon: <MessageSquare /);
    expect(WIZARD_CODE).toMatch(/icon: <McpIcon /);
  });

  it('the brand is lower case where it is not starting a sentence (SQEM-422 rule)', () => {
    expect(WIZARD_CODE).toContain('In sqemes Chat');
    expect(WIZARD_CODE).toContain('inside the sqemes webapp');
  });
});

// SQEM-420 — the welcome screen promised steps the wizard no longer always has, and the extension step
// promised a detection that cannot work off app.sqemes.com.
describe('SQEM-420 — the wizard only promises what it delivers', () => {
  it('⛔ no fixed step count on the welcome screen', () => {
    // The list is built from channels nobody has chosen yet: self-host 2–4 work steps, Cloud 2–5.
    for (const claim of [/Two short steps/, /Three short steps/, /\b(two|three|four|five) short steps\b/i]) {
      expect(WIZARD_CODE).not.toMatch(claim);
    }
  });

  it('the three promises are the ones that hold whatever gets picked', () => {
    expect(WIZARD_CODE).toContain('You say where you work');
    expect(WIZARD_CODE).toContain('Only that gets set up');
    // ⛔ Neither of the two that SQEM-414/418 made conditional.
    expect(WIZARD_CODE).not.toMatch(/title: 'Use them in ChatGPT, Claude & Co\.'/);
    expect(WIZARD_CODE).not.toMatch(/title: 'Bring your AI into Sqemes Chat'/);
    expect(WIZARD_CODE).not.toMatch(/Included credits, or your own key — your choice/);
  });

  it('⛔ the install step promises detection only where detection can happen', () => {
    const i = WIZARD_CODE.indexOf('this step will notice');
    expect(i).toBeGreaterThan(-1);
    // The promise sits in the Cloud branch of an IS_SELF_HOSTED ternary.
    const before = WIZARD_CODE.slice(Math.max(0, i - 700), i);
    expect(before).toMatch(/IS_SELF_HOSTED/);
    expect(before).toMatch(/cannot be detected from this page/);
  });

  it('the ledger does not claim "not yet" where it cannot know', () => {
    expect(WIZARD_CODE).toMatch(/Can&apos;t be checked from a self-hosted instance/);
  });

  it('the extension step knows MCP exists (SQEM-414)', () => {
    expect(WIZARD_CODE).not.toMatch(/playbooks work in sqemes Chat only/);
    expect(WIZARD_CODE).toMatch(/they still work in sqemes Chat and in your MCP tools/);
  });
});

// SQEM-418 — the key step showed for someone who had not picked Chat. Found by the owner walking the
// wizard: "Optional: add your own key" after choosing the browser only.
describe('SQEM-418 — the key step exists when it has something to do', () => {
  it('the step list asks BOTH the channel and whether a key is required', () => {
    expect(WIZARD_CODE).toMatch(/STEPS_FOR = \(channels: Channel\[\], keyRequired: boolean\)/);
    expect(WIZARD_CODE).toMatch(/channels\.includes\('chat'\) \|\| keyRequired \? \[\{ id: 'provider'/);
    expect(WIZARD_CODE).toMatch(/STEPS_FOR\(channels, keyMode === 'required'\)/);
  });

  it('⛔ it is NOT gated on the channel alone — self-host would lose its only place for a key', () => {
    // `keyRequired` is what keeps the step on an instance where nothing AI-powered works without one.
    const call = WIZARD_CODE.match(/channels\.includes\('chat'\)[^\n]*id: 'provider'[^\n]*/)![0];
    expect(call).toContain('keyRequired');
  });

  it('the ledger row follows the same rule, and names Chat only when Chat was chosen', () => {
    // The STEP is still gated on both (that is SQEM-418); SQEM-423 narrowed the ledger ROW, because the
    // Chat row above now carries the "where does the AI come from" sentence itself.
    expect(WIZARD_CODE).toMatch(/channels\.includes\('chat'\) \|\| keyRequired \? \[\{ id: 'provider'/);
    expect(WIZARD_CODE).toMatch(/!channels\.includes\('chat'\) && keyMode === 'required' && \(/);
    expect(WIZARD_CODE).toMatch(/drafting and adapting playbooks/);
  });

  it('⚠️ the step list is still only ever changed BEHIND the channels step (SQEM-414)', () => {
    const list = WIZARD_CODE.slice(WIZARD_CODE.indexOf('STEPS_FOR ='), WIZARD_CODE.indexOf("{ id: 'done'"));
    const channelsAt = list.indexOf("id: 'channels'");
    for (const conditional of ["id: 'extension'", "id: 'mcp'", "id: 'provider'"]) {
      expect(list.indexOf(conditional), `${conditional} must sit behind the channels step`).toBeGreaterThan(channelsAt);
    }
  });
});

// SQEM-417 — the wizard is the first screen a new customer sees, and it looked like a settings dialog.
describe('SQEM-417 — the first impression', () => {
  const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');
  const step = readFileSync(resolve(__dirname, '../../components/WizardCreateStep.tsx'), 'utf8');

  it('the header is the brand band the app already uses, and the progress sits inside it', () => {
    expect(WIZARD_CODE).toMatch(/from-brand-900 via-brand-800 to-brand-700/);
    // The bars moved onto the band — white on a quarter-opacity track, not slate on white.
    expect(WIZARD_CODE).toMatch(/i < step \? 'bg-white' : 'bg-white\/25'/);
  });

  it('⚠️ the step body remounts per step, or the entrance never fires', () => {
    expect(WIZARD_CODE).toMatch(/key=\{current\}[\s\S]{0,120}animate-step-in/);
  });

  it('⛔ motion is a preference — reduced motion still shows every screen and every item', () => {
    const block = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(block).toMatch(/\.animate-step-in/);
    expect(block).toMatch(/\.animate-stagger/);
    expect(block).toMatch(/animation: none !important/);
    // ⛔ Never `display`: an item that is not animated must still be visible, not hidden.
    expect(block).toMatch(/opacity: 1/);
    expect(block).not.toMatch(/display:\s*none/);
  });

  it('the wait is named per section instead of one spinner for all three', () => {
    expect(step).toMatch(/if \(generating\) \{/);
    for (const label of ["'brand voice'", "'prompts'", "'skills'"]) expect(step).toContain(label);
    // The rows report what actually landed — a failed section shows as such, it does not spin on.
    expect(step).toMatch(/state === true/);
    expect(step).toMatch(/state === false/);
  });

  it('the generation callback is wired through to the library, not faked in the UI', () => {
    const gen = readFileSync(resolve(__dirname, '../../lib/wizardGeneration.ts'), 'utf8');
    expect(gen).toMatch(/onSection\?: \(label: string, ok: boolean\) => void/);
    expect(gen).toMatch(/onSection\?\.\(s\.label, true\)/);
    expect(gen).toMatch(/onSection\?\.\(s\.label, false\)/);
    expect(step).toMatch(/\(label, ok\) => setSections/);
  });
});

// SQEM-416 — the areas got a screen of their own, and "Generate" moved onto it. The owner walked the
// wizard and found the generate button sitting under the website field, before anything had asked what
// the playbooks were for.
describe('SQEM-416 — brand → areas → review', () => {
  const step = readFileSync(resolve(__dirname, '../../components/WizardCreateStep.tsx'), 'utf8');

  it('there are three phases and the brand form is the first', () => {
    expect(step).toMatch(/useState<'brand' \| 'areas' \| 'review'>\('brand'\)/);
    expect(step).toMatch(/if \(phase === 'areas'\)/);
    expect(step).toMatch(/if \(phase === 'review'\)/);
  });

  it('⛔ each phase carries its own primary button — Generate belongs to the areas', () => {
    // The reported action, not the prose: the phrase also appears in the comment that records the move.
    const effect = step.slice(step.indexOf('onActionChange('), step.indexOf('onActionChange(null)'));
    expect(effect).toMatch(/phase === 'brand'\s*\n?\s*\? \{ label: 'Continue'/);
    const generate = effect.indexOf('Generate my starter playbooks');
    expect(generate, 'Generate is still reported somewhere').toBeGreaterThan(-1);
    expect(effect.slice(0, generate)).toMatch(/phase === 'areas'/);
  });

  it('the key warning sits where generation happens, not on the brand form', () => {
    const areasStart = step.indexOf("if (phase === 'areas')");
    const brandStart = step.lastIndexOf('---- Brand phase ----');
    const warning = step.indexOf('A provider key is needed to generate playbooks here');
    expect(warning).toBeGreaterThan(areasStart);
    expect(warning).toBeLessThan(brandStart);
  });

  it('⚠️ the areas are asked ONCE — a phase change must not reset the answer', () => {
    // `areas` lives in the component, above the phase switch: going back and forward keeps it.
    const areasState = step.indexOf('const [areas, setAreas]');
    expect(areasState).toBeGreaterThan(-1);
    expect(areasState).toBeLessThan(step.indexOf('const [phase, setPhase]'));
  });
});

// SQEM-414 — the wizard asks where the playbooks will be used and shows only those setup steps.
describe('SQEM-414 — where to use them', () => {
  it('the channel step exists, offers the three channels and gates the setup steps', () => {
    expect(WIZARD_CODE).toMatch(/current === 'channels' && \(/);
    expect(WIZARD_CODE).toContain('Where do you want to use your playbooks?');
    for (const id of ["'browser'", "'chat'", "'mcp'"]) expect(WIZARD_CODE).toContain(id);
    expect(WIZARD_CODE).toMatch(/channels\.includes\('browser'\) \? \[\{ id: 'extension'/);
    expect(WIZARD_CODE).toMatch(/channels\.includes\('mcp'\) \? \[\{ id: 'mcp'/);
  });

  it('⛔ the MCP step leads with the tools, not with the acronym (SQEM-201 took it out for that)', () => {
    // SQEM-423 — the heading is the card's, and it still names tools rather than the acronym; the full
    // client list sits in the line below instead of vanishing.
    expect(WIZARD_CODE).toMatch(/tracking-tight">In Claude Code, Cursor and Codex<\/h3>/);
    expect(WIZARD_CODE).toMatch(/Claude Desktop, Cursor, VS Code, Codex and Claude Code reach your playbooks/);
    // No JSON block here: the snippet stays in Settings, where the key is made.
    expect(WIZARD_CODE).not.toMatch(/mcpServers/);
  });

  it('⛔ names no client as "signs in" or "needs a key" — nothing here verifies that per client', () => {
    for (const claim of [/Claude Desktop signs in/, /Cursor needs a key/, /sign in with Claude/i]) {
      expect(WIZARD_CODE).not.toMatch(claim);
    }
    expect(WIZARD_CODE).toMatch(/Some tools then ask you to sign in; others ask for a key/);
  });

  it('the ledger only claims what was chosen', () => {
    expect(WIZARD_CODE).toMatch(/channels\.includes\('browser'\) && \(/);
    expect(WIZARD_CODE).toMatch(/channels\.includes\('mcp'\) && \(/);
    expect(WIZARD_CODE).toMatch(/channels\.includes\('chat'\) && \(/);
  });
});
