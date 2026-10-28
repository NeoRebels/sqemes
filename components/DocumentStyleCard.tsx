import { useEffect, useMemo, useState } from 'react';
import { Save, FileType } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import SettingsCardHeader from './ui/SettingsCardHeader';
import {
  DOCUMENT_FONTS, PDF_FONTS, PAGE_SIZES, MAX_HEADER, MAX_FOOTER, normalizeDocumentStyle, type DocumentStyle,
} from '../supabase/functions/_shared/documentStyle.ts';
import type { WorkspaceFile } from '../types';
import Select from './ui/Select';
import { Input } from './ui/Input';
import { m } from '../lib/i18n';

/**
 * SQEM-597 — Settings → Brand → Document style: the workspace default for files from Chat. A skill
 * can still ask for another look for one file (`create_file` → `style`); that wins over this.
 *
 * Admins only (the column is guarded in the database too — guard_document_style). Everything is
 * validated by the same `normalizeDocumentStyle` the files are built with, so what is saved is what
 * a document can use.
 */

export default function DocumentStyleCard({ value, files, canEdit, onSave }: {
  value: DocumentStyle | null | undefined;
  files: WorkspaceFile[];
  canEdit: boolean;
  onSave: (style: DocumentStyle | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState<DocumentStyle>(value ?? {});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(value ?? {}); setDirty(false); }, [value]);

  const images = useMemo(() => files.filter(f => /^image\/(png|jpe?g)$/i.test(f.mimeType)), [files]);
  const set = (patch: Partial<DocumentStyle>) => { setDraft(d => ({ ...d, ...patch })); setDirty(true); };
  const color = draft.primaryColor ?? '#1F2937';
  const pdfFallback = !!draft.font && !PDF_FONTS.includes(draft.font);

  const save = async () => {
    setSaving(true);
    try { await onSave(normalizeDocumentStyle(draft)); setDirty(false); } finally { setSaving(false); }
  };

  return (
    <Card className="p-6 md:p-8">
      <SettingsCardHeader
        title={m.ds_title()}
        description={m.ds_desc()}
        actions={canEdit ? (
          <Button onClick={save} disabled={!dirty || saving} className="px-5">
            <Save className="w-4 h-4" /> {m.st_save()}
          </Button>
        ) : undefined}
      />
      <fieldset disabled={!canEdit} className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label htmlFor="ds-color" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">{m.ds_color()}</label>
          <div className="flex items-center gap-2">
            <input id="ds-color" type="color" value={color} onChange={e => set({ primaryColor: e.target.value.toUpperCase() })} className="h-10 w-12 rounded-lg border border-line-strong bg-surface-field" />
            <Input aria-label={m.ds_color_hex()} value={draft.primaryColor ?? ''} placeholder="#0A5C8F" onChange={e => set({ primaryColor: e.target.value })} className="font-mono" />
          </div>
        </div>
        <div>
          <label htmlFor="ds-font" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">{m.ds_font()}</label>
          <Select id="ds-font" value={draft.font ?? ''} onChange={e => set({ font: (e.target.value || undefined) as DocumentStyle['font'] })}>
            <option value="">{m.ds_default()}</option>
            {DOCUMENT_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
          </Select>
          {pdfFallback && <p className="text-2xs text-ink-subtle mt-1.5">{m.ds_pdf_fallback()}</p>}
        </div>
        <div>
          <label htmlFor="ds-logo" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">{m.ds_logo()}</label>
          <Select id="ds-logo" value={draft.logo ?? ''} onChange={e => set({ logo: e.target.value || undefined })}>
            <option value="">{m.ds_no_logo()}</option>
            {images.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
            {draft.logo && !images.some(f => f.name === draft.logo) && <option value={draft.logo}>{m.ds_not_found({ name: draft.logo })}</option>}
          </Select>
          <p className="text-2xs text-ink-subtle mt-1.5">{m.ds_logo_hint()}</p>
        </div>
        <div>
          <label htmlFor="ds-page" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">{m.ds_page()}</label>
          <Select id="ds-page" value={draft.pageSize ?? 'A4'} onChange={e => set({ pageSize: e.target.value as DocumentStyle['pageSize'] })}>
            {PAGE_SIZES.map(p => <option key={p} value={p}>{p}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="ds-header" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">{m.ds_header()}</label>
          <Input id="ds-header" value={draft.header ?? ''} maxLength={MAX_HEADER} onChange={e => set({ header: e.target.value })} placeholder={m.ds_header_placeholder()} />
        </div>
        <div>
          <label htmlFor="ds-footer" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">{m.ds_footer()}</label>
          <Input id="ds-footer" value={draft.footer ?? ''} maxLength={MAX_FOOTER} onChange={e => set({ footer: e.target.value })} placeholder={m.ds_footer_placeholder()} />
        </div>
      </fieldset>

      {/* A small preview: the heading and a table header in the house colour, header and footer lines. */}
      <div className="mt-6 rounded-lg border border-line bg-surface p-5" aria-label={m.ds_preview()} style={{ fontFamily: draft.font ? `"${draft.font}", sans-serif` : undefined }}>
        <div className="flex items-center justify-between text-2xs text-ink-subtle border-b border-line pb-2 mb-3">
          <span className="inline-flex items-center gap-1"><FileType className="w-3.5 h-3.5" aria-hidden="true" /> {draft.logo ? draft.logo.split('/').pop() : m.ds_no_logo_preview()}</span>
          <span>{draft.header ?? ''}</span>
        </div>
        <p className="text-lg font-bold mb-2" style={{ color }}>{m.ds_sample_title()}</p>
        <table className="text-xs w-full border-collapse mb-3">
          <thead><tr style={{ backgroundColor: draft.primaryColor, color: draft.primaryColor ? '#FFFFFF' : undefined }}><th className="text-left px-2 py-1">{m.ds_sample_item()}</th><th className="text-right px-2 py-1">{m.ds_sample_price()}</th></tr></thead>
          <tbody><tr className="border-t border-line"><td className="px-2 py-1 text-ink">{m.ds_sample_row()}</td><td className="px-2 py-1 text-right text-ink">1.250,50 €</td></tr></tbody>
        </table>
        <p className="text-2xs text-ink-subtle border-t border-line pt-2 text-center">{draft.footer ?? ''}</p>
      </div>
      {!canEdit && <p className="text-xs text-ink-subtle mt-3">{m.ds_admins_only()}</p>}
    </Card>
  );
}
