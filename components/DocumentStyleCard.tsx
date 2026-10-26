import { useEffect, useMemo, useState } from 'react';
import { Save, FileType } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import SettingsCardHeader from './ui/SettingsCardHeader';
import {
  DOCUMENT_FONTS, PDF_FONTS, PAGE_SIZES, MAX_HEADER, MAX_FOOTER, normalizeDocumentStyle, type DocumentStyle,
} from '../supabase/functions/_shared/documentStyle.ts';
import type { WorkspaceFile } from '../types';

/**
 * SQEM-597 — Settings → Brand → Document style: the workspace default for files from Chat. A skill
 * can still ask for another look for one file (`create_file` → `style`); that wins over this.
 *
 * Admins only (the column is guarded in the database too — guard_document_style). Everything is
 * validated by the same `normalizeDocumentStyle` the files are built with, so what is saved is what
 * a document can use.
 */
const FIELD = 'w-full p-2.5 border border-line-strong bg-surface-field rounded-xl text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 text-ink-strong';

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
        title="Document style"
        description="How Word, PDF, PowerPoint and Excel files from Chat look. A playbook can ask for another look for its own files; that takes priority."
        actions={canEdit ? (
          <Button onClick={save} disabled={!dirty || saving} className="px-5">
            <Save className="w-4 h-4" /> Save
          </Button>
        ) : undefined}
      />
      <fieldset disabled={!canEdit} className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label htmlFor="ds-color" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">House colour</label>
          <div className="flex items-center gap-2">
            <input id="ds-color" type="color" value={color} onChange={e => set({ primaryColor: e.target.value.toUpperCase() })} className="h-10 w-12 rounded-lg border border-line-strong bg-surface-field" />
            <input aria-label="House colour as hex" value={draft.primaryColor ?? ''} placeholder="#0A5C8F" onChange={e => set({ primaryColor: e.target.value })} className={`${FIELD} font-mono`} />
          </div>
        </div>
        <div>
          <label htmlFor="ds-font" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">Font</label>
          <select id="ds-font" value={draft.font ?? ''} onChange={e => set({ font: (e.target.value || undefined) as DocumentStyle['font'] })} className={FIELD}>
            <option value="">Default</option>
            {DOCUMENT_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          {pdfFallback && <p className="text-2xs text-ink-subtle mt-1.5">PDFs use Roboto instead — only Roboto, Open Sans and Lato are embedded. Word and PowerPoint show the font if it is installed.</p>}
        </div>
        <div>
          <label htmlFor="ds-logo" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">Logo</label>
          <select id="ds-logo" value={draft.logo ?? ''} onChange={e => set({ logo: e.target.value || undefined })} className={FIELD}>
            <option value="">No logo</option>
            {images.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
            {draft.logo && !images.some(f => f.name === draft.logo) && <option value={draft.logo}>{draft.logo} (not found)</option>}
          </select>
          <p className="text-2xs text-ink-subtle mt-1.5">A PNG or JPEG from Files.</p>
        </div>
        <div>
          <label htmlFor="ds-page" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">Page size</label>
          <select id="ds-page" value={draft.pageSize ?? 'A4'} onChange={e => set({ pageSize: e.target.value as DocumentStyle['pageSize'] })} className={FIELD}>
            {PAGE_SIZES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ds-header" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">Header</label>
          <input id="ds-header" value={draft.header ?? ''} maxLength={MAX_HEADER} onChange={e => set({ header: e.target.value })} placeholder="e.g. Confidential" className={FIELD} />
        </div>
        <div>
          <label htmlFor="ds-footer" className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">Footer</label>
          <input id="ds-footer" value={draft.footer ?? ''} maxLength={MAX_FOOTER} onChange={e => set({ footer: e.target.value })} placeholder="e.g. Company GmbH · Street 1 · City" className={FIELD} />
        </div>
      </fieldset>

      {/* A small preview: the heading and a table header in the house colour, header and footer lines. */}
      <div className="mt-6 rounded-lg border border-line bg-surface p-5" aria-label="Preview" style={{ fontFamily: draft.font ? `"${draft.font}", sans-serif` : undefined }}>
        <div className="flex items-center justify-between text-2xs text-ink-subtle border-b border-line pb-2 mb-3">
          <span className="inline-flex items-center gap-1"><FileType className="w-3.5 h-3.5" aria-hidden="true" /> {draft.logo ? draft.logo.split('/').pop() : 'no logo'}</span>
          <span>{draft.header ?? ''}</span>
        </div>
        <p className="text-lg font-bold mb-2" style={{ color }}>Offer for Müller GmbH</p>
        <table className="text-xs w-full border-collapse mb-3">
          <thead><tr style={{ backgroundColor: draft.primaryColor, color: draft.primaryColor ? '#FFFFFF' : undefined }}><th className="text-left px-2 py-1">Item</th><th className="text-right px-2 py-1">Price</th></tr></thead>
          <tbody><tr className="border-t border-line"><td className="px-2 py-1 text-ink">Consulting</td><td className="px-2 py-1 text-right text-ink">1.250,50 €</td></tr></tbody>
        </table>
        <p className="text-2xs text-ink-subtle border-t border-line pt-2 text-center">{draft.footer ?? ''}</p>
      </div>
      {!canEdit && <p className="text-xs text-ink-subtle mt-3">Only admins can change the document style.</p>}
    </Card>
  );
}
