import { useMemo, useState, type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Download, FileText, FileSpreadsheet, FileType, Presentation, X, Loader2 } from 'lucide-react';
import { markdownUrlTransform } from '../lib/markdownUrlTransform';
import { FILE_LABELS, type GeneratedFile } from '../supabase/functions/_shared/fileOutput.ts';
import { downloadGeneratedFile, plainTextFromMarkdown, sheetsFromMarkdown, slidesFromMarkdown, pdfFontFor } from '../lib/fileExport';
import { effectiveStyle, type DocumentStyle } from '../supabase/functions/_shared/documentStyle.ts';
import { loadLogo } from '../lib/logoImage';
import type { WorkspaceFile } from '../types';
import { m } from '../lib/i18n';

/**
 * SQEM-595 — a file a Chat answer handed out: the card under the answer, and the preview beside the
 * chat. Download only; nothing is stored (see `supabase/functions/_shared/fileOutput.ts`).
 *
 * ⭐ The preview shows the CONTENT rendered — Markdown for md/docx/pdf, text for txt, tables for xlsx —
 * not the binary file. Showing the real PDF would need `blob:` in the CSP's frame-src (or pdf.js); the
 * content is the same Markdown the file is built from, so what you see is what you download.
 */

function FileIcon({ format, className }: { format: GeneratedFile['format']; className?: string }) {
  if (format === 'xlsx') return <FileSpreadsheet className={className} aria-hidden="true" />;
  if (format === 'pptx') return <Presentation className={className} aria-hidden="true" />;
  if (format === 'pdf' || format === 'docx') return <FileType className={className} aria-hidden="true" />;
  return <FileText className={className} aria-hidden="true" />;
}

/** SQEM-597 — the style this file is built with: its own (from a skill) over the workspace default. */
function useDownload(file: GeneratedFile | null, workspaceStyle: DocumentStyle | null | undefined, files: WorkspaceFile[]) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = async () => {
    if (!file || busy) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const style = effectiveStyle(file.style, workspaceStyle);
      let logo = null;
      if (style.logo && file.format !== 'md' && file.format !== 'txt') {
        const r = await loadLogo(style.logo, files);
        if ('logo' in r) logo = r.logo; else setNote(m.chatfile_built_without({ reason: r.missing }));
      }
      await downloadGeneratedFile(file, { style, logo });
    }
    catch (e) { setError(e instanceof Error ? e.message : m.chatfile_create_failed()); }
    finally { setBusy(false); }
  };
  return { busy, error, note, run };
}

/** One line under the file name: which look applies, and what a format cannot do with it. */
function StyleLine({ file, workspaceStyle }: { file: GeneratedFile; workspaceStyle: DocumentStyle | null | undefined }) {
  if (file.format === 'md' || file.format === 'txt') return null;
  const s = effectiveStyle(file.style, workspaceStyle);
  if (!Object.keys(s).length) return null;
  const pdfFallback = file.format === 'pdf' && s.font && pdfFontFor(s) !== s.font;
  return (
    <p className="text-xs text-ink-subtle flex items-center gap-1.5 flex-wrap">
      {s.primaryColor && <span className="inline-block w-3 h-3 rounded-sm border border-line" style={{ backgroundColor: s.primaryColor }} aria-hidden="true" />}
      <span>{file.style ? m.chatfile_style_request() : m.chatfile_style_workspace()}{s.font ? ` · ${pdfFallback ? m.chatfile_font_fallback({ font: s.font }) : s.font}` : ''}{s.logo ? ` · ${m.chatfile_logo()}` : ''}</span>
    </p>
  );
}

export function GeneratedFilesCard({ files, onOpen }: { files: GeneratedFile[] | undefined; onOpen: (f: GeneratedFile) => void }) {
  if (!files?.length) return null;
  return (
    <div className="mt-2 ml-1 w-full max-w-md space-y-1.5">
      {files.map((f, i) => (
        <button
          key={`${f.name}:${i}`}
          type="button"
          onClick={() => onOpen(f)}
          className="w-full flex items-center gap-3 rounded-card border border-line bg-surface-raised shadow-rest px-4 py-3 text-left hover:border-accent transition-colors"
        >
          <FileIcon format={f.format} className="w-5 h-5 text-accent shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink truncate">{f.name}</span>
            <span className="block text-xs text-ink-subtle">{FILE_LABELS[f.format]} · {m.chatfile_open_preview()}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function XlsxPreview({ content }: { content: string }) {
  const sheets = useMemo(() => sheetsFromMarkdown(content), [content]);
  const [active, setActive] = useState(0);
  const sheet = sheets[Math.min(active, sheets.length - 1)];
  if (!sheet) return <p className="text-sm text-ink-muted">{m.chatfile_no_table()}</p>;
  return (
    <div>
      {sheets.length > 1 && (
        <div className="flex flex-wrap gap-1 mb-3" role="tablist" aria-label={m.chatfile_sheets()}>
          {sheets.map((s, i) => (
            <button key={s.name} type="button" role="tab" aria-selected={i === active} onClick={() => setActive(i)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium ${i === active ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-surface-sunken'}`}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-auto border border-line rounded-lg">
        <table className="text-sm border-collapse min-w-full">
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r} className={r === 0 ? 'bg-surface-sunken font-semibold' : 'border-t border-line'}>
                {row.map((cell, c) => <td key={c} className="px-3 py-1.5 whitespace-nowrap text-ink">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** SQEM-596 — the slides as 16:9 cards, from the same parse the .pptx is built from. */
function SlidesPreview({ content }: { content: string }) {
  const slides = useMemo(() => slidesFromMarkdown(content), [content]);
  if (!slides.length) return <p className="text-sm text-ink-muted">{m.chatfile_no_slides()}</p>;
  return (
    <ol className="space-y-4" aria-label={m.chatfile_slides()}>
      {slides.map((s, i) => (
        <li key={i} className="aspect-video w-full rounded-lg border border-line bg-surface shadow-rest overflow-hidden flex flex-col p-[4%]">
          {s.isTitle ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <p className="text-xl font-bold text-ink-strong">{s.title}</p>
              {s.subtitle && <p className="mt-2 text-sm text-ink-muted">{s.subtitle}</p>}
            </div>
          ) : (
            <>
              {s.title && <p className="text-base font-bold text-ink-strong mb-2">{s.title}</p>}
              {s.bullets.length > 0 && (
                <ul className="space-y-0.5 text-xs text-ink">
                  {s.bullets.map((b, j) => <li key={j} className="list-disc" style={{ marginLeft: `${1 + b.level}rem` }}>{b.text}</li>)}
                </ul>
              )}
              {s.table && (
                <table className="mt-2 text-2xs border-collapse">
                  <tbody>
                    {s.table.map((row, r) => (
                      <tr key={r} className={r === 0 ? 'bg-surface-sunken font-semibold' : 'border-t border-line'}>
                        {row.map((cell, c) => <td key={c} className="px-1.5 py-0.5 text-ink">{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
          <span className="mt-auto self-end text-2xs text-ink-subtle">{i + 1}</span>
        </li>
      ))}
    </ol>
  );
}

export function FilePreviewPanel({ file, onClose, markdownComponents, workspaceStyle, files = [] }: {
  file: GeneratedFile;
  onClose: () => void;
  /** SQEM-597 — the workspace's document style, and the files a logo name is resolved against. */
  workspaceStyle?: DocumentStyle | null;
  files?: WorkspaceFile[];
  /** Chat's own Markdown components, so the preview reads like the answer (there is no typography plugin). */
  markdownComponents?: ComponentProps<typeof ReactMarkdown>['components'];
}) {
  const { busy, error, note, run } = useDownload(file, workspaceStyle, files);
  const text = useMemo(() => (file.format === 'txt' ? plainTextFromMarkdown(file.content) : ''), [file]);
  return (
    <aside
      aria-label={m.chatfile_preview_of({ name: file.name })}
      className="fixed inset-0 z-40 md:static md:z-auto md:w-[46%] md:max-w-3xl shrink-0 flex flex-col min-h-0 h-full bg-surface-raised border-l border-line"
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-line shrink-0">
        <FileIcon format={file.format} className="w-5 h-5 text-accent shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-strong truncate">{file.name}</p>
          <p className="text-xs text-ink-subtle">{FILE_LABELS[file.format]}</p>
          <StyleLine file={file} workspaceStyle={workspaceStyle} />
        </div>
        <button type="button" onClick={run} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-control bg-accent-strong text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {m.chatfile_download()}
        </button>
        <button type="button" onClick={onClose} aria-label={m.chatfile_close_preview()} className="p-2 rounded-control text-ink-subtle hover:text-ink hover:bg-surface-sunken">
          <X className="w-4 h-4" />
        </button>
      </div>
      {error && <p role="alert" className="px-4 py-2 text-sm text-danger bg-danger-soft">{error}</p>}
      {note && <p role="status" className="px-4 py-2 text-sm text-ink bg-warning-soft">{note}</p>}
      <div className="flex-1 overflow-auto px-6 py-5">
        {file.format === 'xlsx' ? (
          <XlsxPreview content={file.content} />
        ) : file.format === 'pptx' ? (
          <SlidesPreview content={file.content} />
        ) : file.format === 'txt' ? (
          <pre className="whitespace-pre-wrap text-sm text-ink font-mono">{text}</pre>
        ) : (
          <div className="text-sm">
            <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]} urlTransform={markdownUrlTransform}>{file.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </aside>
  );
}
