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

describe('⛔ SQEM-386 — one order everywhere: Welcome → Templates → Extension → AI key → You\'re set', () => {
  it('the STEPS array lists the five ids in that order, templates guarded for self-host only', () => {
    const m = WIZARD.match(/const STEPS[\s\S]*?\];/);
    expect(m, 'STEPS array').not.toBeNull();
    const steps = m![0];
    const order = ['welcome', 'templates', 'extension', 'provider', 'done'].map(id => steps.indexOf(`id: '${id}'`));
    expect(order.every(i => i >= 0), `all five ids present: ${order}`).toBe(true);
    expect([...order].sort((a, b) => a - b), 'in order').toEqual(order);
    // The ONLY environment branch is the templates step; the rest is one list.
    expect(steps.match(/IS_SELF_HOSTED/g)?.length).toBe(1);
    expect(steps).toMatch(/IS_SELF_HOSTED \? \[\] : \[\{ id: 'templates'/);
  });

  it('the progress bar counts working steps only — neither the welcome screen nor the ledger is a step to "do"', () => {
    expect(WIZARD_CODE).toMatch(/const WORK_STEPS = STEPS\.filter\(s => s\.id !== 'welcome' && s\.id !== 'done'\)/);
    expect(WIZARD_CODE).toMatch(/WORK_STEPS\.map\(/);
    // Welcome sits at index 0, so the visible step number is the index itself.
    expect(WIZARD_CODE).toMatch(/Step \{step\} of \{WORK_STEPS\.length\}/);
  });

  it('⛔ round 2 — a welcome screen carries the why and the outcome; the header no longer does', () => {
    expect(WIZARD_CODE).toMatch(/current === 'welcome' && \(/);
    expect(WIZARD_CODE).toMatch(/Welcome to Sqemes/);
    expect(WIZARD_CODE).toMatch(/Three short steps, and your first playbooks are ready/);
    expect(WIZARD_CODE).toMatch(/Two short steps, and your playbooks work inside/);
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
    expect(WIZARD_CODE).toMatch(/Needed for AI in Sqemes Chat and for generating playbooks here/);
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
  it('the done step exists and ends in Done', () => {
    expect(WIZARD_CODE).toMatch(/current === 'done' && \(/);
    expect(WIZARD_CODE).toMatch(/You&apos;re set/);
    expect(WIZARD_CODE).toMatch(/<button onClick=\{finish\} className=\{PRIMARY_BTN\}>Done<\/button>/);
  });
  it('it reports the real count and the three states, and offers no "try it" action', () => {
    expect(WIZARD_CODE).toMatch(/\{createdCount\} playbook\{createdCount === 1 \? '' : 's'\} created/);
    expect(WIZARD_CODE).toMatch(/No playbooks yet/);
    expect(WIZARD_CODE).toMatch(/AI credits are included/);
    expect(WIZARD_CODE).toMatch(/AI is included in your workspace — nothing to do/);
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
    expect(WIZARD_CODE).toMatch(/Use your playbooks inside ChatGPT, Claude &amp; Co\./);
    expect(WIZARD_CODE).toMatch(/Without it, playbooks work in Sqemes Chat only/);
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
    expect(dash.slice(Math.max(0, i - 600), i)).toMatch(/className="w-full sm:w-auto justify-center/);
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
