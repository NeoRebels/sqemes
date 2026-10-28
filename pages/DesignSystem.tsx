import React, { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import { Inbox, Search, Plus } from 'lucide-react';
import { useWorkspace, useUI } from '../store';
import { can } from '../lib/permissions';
import { IS_SELF_HOSTED } from '../lib/env';
import { canSeeDesignSystem } from '../lib/designAccess';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import Checkbox from '../components/ui/Checkbox';
import Switch from '../components/ui/Switch';
import SegmentedTabs from '../components/ui/SegmentedTabs';
import KindBadge from '../components/ui/KindBadge';
import AccessBadge from '../components/ui/AccessBadge';
import EmptyState from '../components/ui/EmptyState';
import ConfirmModal from '../components/ui/ConfirmModal';
import CardSaveBar from '../components/ui/CardSaveBar';
import MoveButtons from '../components/ui/MoveButtons';
import Select from '../components/ui/Select';

/**
 * SQEM-545 — the webapp's design system, shown from the real code.
 *
 * ⛔ Everything on this page is RENDERED, not described: the swatches read their colour from the
 * token class, the contrast numbers are computed from what the browser actually paints, and every
 * component is the component. A page that describes a design system drifts the first week; one that
 * renders it cannot. If something here needs a sentence of explanation, the rule goes in the "Rules"
 * card and nowhere else.
 */

const COLOUR_TOKENS: { cls: string; name: string; role: string }[] = [
  { cls: 'bg-surface', name: 'surface', role: 'page background' },
  { cls: 'bg-surface-raised', name: 'surface-raised', role: 'card, panel, dialog' },
  { cls: 'bg-surface-sunken', name: 'surface-sunken', role: 'track, well, chip' },
  { cls: 'bg-surface-field', name: 'surface-field', role: 'input' },
  { cls: 'bg-line', name: 'line', role: 'card edge' },
  { cls: 'bg-line-strong', name: 'line-strong', role: 'input edge, divider' },
  { cls: 'bg-accent', name: 'accent', role: 'links, active state' },
  { cls: 'bg-accent-strong', name: 'accent-strong', role: 'filled primary' },
  { cls: 'bg-accent-soft', name: 'accent-soft', role: 'selected, highlighted' },
  { cls: 'bg-danger', name: 'danger', role: 'destructive, errors' },
  { cls: 'bg-warning', name: 'warning', role: 'caution' },
  { cls: 'bg-success', name: 'success', role: 'done, valid' },
  { cls: 'bg-skill', name: 'skill', role: 'the skill kind (petrol)' },
  { cls: 'bg-skill-soft', name: 'skill-soft', role: 'skill badge ground' },
];

const TEXT_TOKENS: { cls: string; name: string; role: string }[] = [
  { cls: 'text-ink-strong', name: 'ink-strong', role: 'headings, values' },
  { cls: 'text-ink', name: 'ink', role: 'body text' },
  { cls: 'text-ink-muted', name: 'ink-muted', role: 'secondary text' },
  { cls: 'text-ink-subtle', name: 'ink-subtle', role: 'hints, icons' },
  { cls: 'text-accent', name: 'accent', role: 'links' },
  { cls: 'text-danger', name: 'danger', role: 'error text' },
  { cls: 'text-skill', name: 'skill', role: 'skill kind label' },
];

const TYPE_SCALE = ['text-2xs', 'text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl'];
const RADII = [['rounded-chip', 'badges, tags, small icon buttons'], ['rounded-control', 'buttons, inputs, rows'], ['rounded-card', 'Card, panels'], ['rounded-overlay', 'dialogs, drawers'], ['rounded-full', 'pills, avatars, switches']];
const SHADOWS = [['shadow-rest', 'resting card'], ['shadow-raised', 'hover, lifted'], ['shadow-overlay', 'dialog, popover']];

const RULES = [
  'Name the role, not the shade: text-ink-muted, not text-slate-500 dark:text-slate-400 — a token cannot forget dark mode.',
  'Two faces: Figtree for text, Bricolage Grotesque (font-display) for headings from 20px up — never for body or labels.',
  'A kind is not a status: prompt = accent, skill = skill (petrol); success (green) only means done.',
  'Eight type sizes, 2xs to 3xl. Hierarchy comes from size first and weight second; no text-[Npx].',
  'Radius and shadow by role: a control is rounded-control, a card rounded-card, a dialog rounded-overlay.',
  'Settings save on a click: a card that edits a value ends in CardSaveBar (SQEM-539).',
  'Every field has a name and every control a label; nothing is hover-only (SQEM-538, SQEM-540).',
  'Colours outside the palette may only decrease — tests/unit/designBaseline.json.',
];

// Contrast of the text a swatch paints against the surface it sits on, as the browser computed them.
function parseRgb(s: string): number[] | null {
  const m = s.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function contrast(fg: number[], bg: number[]): number {
  const lum = ([r, g, b]: number[]) => {
    const c = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
  };
  const [a, b] = [lum(fg), lum(bg)].sort((p, q) => q - p);
  return (a + 0.05) / (b + 0.05);
}

function TextSample({ cls, name, role }: { cls: string; name: string; role: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      const card = el?.closest('[data-surface]') as HTMLElement | null;
      const fg = el ? parseRgb(getComputedStyle(el).color) : null;
      const bg = card ? parseRgb(getComputedStyle(card).backgroundColor) : null;
      setRatio(fg && bg ? contrast(fg, bg) : null);
    };
    measure();
    // Re-measure when the theme flips.
    const obs = new MutationObserver(measure);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span ref={ref} className={`${cls} text-sm font-medium`}>{name}</span>
      <span className="text-xs text-ink-muted">{role}</span>
      <span className={`text-xs font-mono tabular-nums ${ratio !== null && ratio < 4.5 ? 'text-danger' : 'text-ink-subtle'}`}>
        {ratio === null ? '—' : `${ratio.toFixed(1)}:1`}
      </span>
    </div>
  );
}

export default function DesignSystem() {
  const { currentUser, workspace, isSqemesAdmin } = useWorkspace();
  const [tab, setTab] = useState<'one' | 'two'>('one');
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { showToast } = useUI();
  const [dirty, setDirty] = useState(true);

  const allowed = canSeeDesignSystem({
    isSqemesAdmin,
    isSelfHosted: IS_SELF_HOSTED,
    canManageTeam: can(currentUser, workspace, 'team:manage'),
    isDev: import.meta.env.DEV,
  });
  if (!allowed) return <Navigate to="/" replace />;

  return (
    <div className="p-4 md:p-8 pb-16 max-w-6xl mx-auto space-y-8">
      <PageHeader title="Design system" subtitle="The webapp's tokens, scales and components — rendered from the code, so this page cannot drift." />

      <Card className="p-6 md:p-8">
        <h2 className="text-lg font-bold text-ink-strong mb-4">Rules</h2>
        <ul className="space-y-2 text-sm text-ink list-disc pl-5">
          {RULES.map(r => <li key={r}>{r}</li>)}
        </ul>
      </Card>

      <section aria-labelledby="ds-colour">
        <h2 id="ds-colour" className="text-lg font-bold text-ink-strong mb-4">Colour tokens</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {COLOUR_TOKENS.map(t => (
            <div key={t.name} className="rounded-card border border-line bg-surface-raised overflow-hidden">
              <div className={`h-14 ${t.cls}`} />
              <div className="p-3">
                <p className="text-xs font-mono font-semibold text-ink-strong">{t.name}</p>
                <p className="text-2xs text-ink-muted">{t.role}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          {(['bg-surface-raised', 'bg-surface'] as const).map(bg => (
            <div key={bg} data-surface className={`${bg} rounded-card border border-line p-4`}>
              <p className="text-2xs font-bold uppercase tracking-wider text-ink-subtle mb-2">Text on {bg.replace('bg-', '')} · contrast as painted</p>
              {TEXT_TOKENS.map(t => <TextSample key={t.name} {...t} />)}
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="ds-type">
        <h2 id="ds-type" className="text-lg font-bold text-ink-strong mb-4">Type scale</h2>
        <Card className="p-6 space-y-2">
          {TYPE_SCALE.map(c => (
            <div key={c} className="flex items-baseline gap-4">
              <span className="w-24 shrink-0 text-xs font-mono text-ink-subtle">{c}</span>
              <span className={`${c} text-ink-strong`}>Playbooks your team can reuse</span>
            </div>
          ))}
          <div className="flex items-baseline gap-4 pt-3 border-t border-line">
            <span className="w-24 shrink-0 text-xs font-mono text-ink-subtle">font-display</span>
            <span className="font-display text-3xl font-semibold tracking-tight text-ink-strong">What are we working on?</span>
          </div>
        </Card>
      </section>

      <section aria-labelledby="ds-shape">
        <h2 id="ds-shape" className="text-lg font-bold text-ink-strong mb-4">Radius and elevation</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Card className="p-6 flex flex-wrap gap-4">
            {RADII.map(([c, role]) => (
              <div key={c} className="text-center">
                <div className={`w-20 h-14 bg-accent-soft border border-line-strong ${c}`} />
                <p className="mt-1 text-2xs font-mono text-ink-strong">{c}</p>
                <p className="text-2xs text-ink-muted max-w-[6rem]">{role}</p>
              </div>
            ))}
          </Card>
          <Card className="p-6 flex flex-wrap gap-6">
            {SHADOWS.map(([c, role]) => (
              <div key={c} className="text-center">
                <div className={`w-24 h-16 bg-surface-raised rounded-card ${c}`} />
                <p className="mt-2 text-2xs font-mono text-ink-strong">{c}</p>
                <p className="text-2xs text-ink-muted">{role}</p>
              </div>
            ))}
          </Card>
        </div>
      </section>

      <section aria-labelledby="ds-components" className="space-y-4">
        <h2 id="ds-components" className="text-lg font-bold text-ink-strong">Components</h2>

        <Card className="p-6">
          <h3 className="text-sm font-bold text-ink-strong mb-3">Button</h3>
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button disabled>Disabled</Button>
            <Button loading>Loading</Button>
            <Button size="sm"><Plus className="w-3.5 h-3.5" /> Small</Button>
          </div>
        </Card>

        <Card className="p-6 grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="ds-input" className="block text-xs font-bold text-ink-muted mb-1.5">Input</label>
            <Input id="ds-input" placeholder="Type here" />
          </div>
          <div>
            <label htmlFor="ds-input-disabled" className="block text-xs font-bold text-ink-muted mb-1.5">Input, disabled</label>
            <Input id="ds-input-disabled" placeholder="Not editable" disabled />
          </div>
          {/* SQEM-602 — the field states: one `tone` prop on Input / Textarea, never a call-site class list. */}
          <div>
            <label htmlFor="ds-input-error" className="block text-xs font-bold text-ink-muted mb-1.5">{'Input, tone="error"'}</label>
            <Input id="ds-input-error" defaultValue="not a valid value" tone="error" aria-invalid />
          </div>
          <div>
            <label htmlFor="ds-input-warning" className="block text-xs font-bold text-ink-muted mb-1.5">{'Input, tone="warning"'}</label>
            <Input id="ds-input-warning" placeholder="Allowed, but worth a look" tone="warning" />
          </div>
          <div>
            <label htmlFor="ds-input-success" className="block text-xs font-bold text-ink-muted mb-1.5">{'Input, tone="success"'}</label>
            <Input id="ds-input-success" placeholder="••••••••  (already configured)" tone="success" />
          </div>
          <div>
            <label htmlFor="ds-textarea" className="block text-xs font-bold text-ink-muted mb-1.5">Textarea</label>
            <Textarea id="ds-textarea" rows={2} placeholder="Several lines" className="resize-none" />
          </div>
          {/* SQEM-601 — the form field select; next to Input so the equal height is visible. */}
          <div>
            <label htmlFor="ds-select" className="block text-xs font-bold text-ink-muted mb-1.5">Select</label>
            <Select id="ds-select" defaultValue="two">
              <option value="one">Option one</option>
              <option value="two">Option two</option>
              <option value="three">Option three</option>
            </Select>
          </div>
          <div>
            <label htmlFor="ds-select-disabled" className="block text-xs font-bold text-ink-muted mb-1.5">Select, disabled</label>
            <Select id="ds-select-disabled" disabled defaultValue="one">
              <option value="one">Not changeable</option>
            </Select>
          </div>
          <div className="flex items-center gap-6">
            <Checkbox checked={checked} onChange={() => setChecked(c => !c)} aria-label="Checkbox sample" />
            <span id="ds-switch-label" className="text-sm text-ink">Switch</span>
            <Switch checked={on} onChange={setOn} labelledBy="ds-switch-label" />
            <MoveButtons label="sample" index={1} count={3} onMove={() => {}} />
          </div>
          <SegmentedTabs<'one' | 'two'> value={tab} onChange={setTab} tabs={[{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }]} />
        </Card>

        <Card className="p-6 flex flex-wrap items-center gap-3">
          <KindBadge kind="prompt" />
          <KindBadge kind="skill" />
          <AccessBadge mode="restricted" />
          <AccessBadge mode="private" />
        </Card>

        <Card className="p-6">
          <h3 className="text-sm font-bold text-ink-strong mb-1">CardSaveBar</h3>
          <p className="text-sm text-ink-muted">Toggle to see the clean and the dirty state.</p>
          <CardSaveBar dirty={dirty} onSave={() => setDirty(false)} onCancel={() => setDirty(false)} />
          {!dirty && <Button variant="ghost" size="sm" onClick={() => setDirty(true)}>Make dirty again</Button>}
        </Card>

        {/* SQEM-554 (a) — both tones: `brand` invites the first item, `neutral` reports an empty filter. */}
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState
            icon={<Inbox className="w-6 h-6" />}
            tone="brand"
            title="EmptyState · brand"
            description="Nothing here yet — and the one way forward."
            action={<Button size="sm"><Search className="w-3.5 h-3.5" /> The way forward</Button>}
          />
          <EmptyState
            icon={<Search className="w-6 h-6" />}
            title="EmptyState · neutral"
            description="Nothing matches the filter."
          />
        </div>

        <Card className="p-6">
          <h3 className="text-sm font-bold text-ink-strong mb-3">Modal / ConfirmModal</h3>
          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>Open a confirmation</Button>
          <ConfirmModal
            open={confirmOpen}
            title="Delete this sample?"
            confirmLabel="Delete"
            confirmText="sample"
            onConfirm={() => setConfirmOpen(false)}
            onClose={() => setConfirmOpen(false)}
          >
            <p>A typed confirmation, as used for deleting a workspace. Nothing is deleted here.</p>
          </ConfirmModal>
        </Card>

        {/* SQEM-554 (a) — the toast is a light card; its type is the icon's colour. */}
        <Card className="p-6">
          <h3 className="text-sm font-bold text-ink-strong mb-3">Toast</h3>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => showToast('Saved.', 'success')}>Success</Button>
            <Button variant="secondary" size="sm" onClick={() => showToast('That did not work. Try again.', 'error')}>Error</Button>
            <Button variant="secondary" size="sm" onClick={() => showToast('Something to know.', 'info')}>Info</Button>
          </div>
        </Card>
      </section>
    </div>
  );
}
