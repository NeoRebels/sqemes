import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Document, Packer, Paragraph } from 'docx';
import { officeAttachment, utf8ToBase64 } from '../../lib/officeAttachment';
import { CHAT_ACCEPT_STRING, ACCEPT_STRING, FILE_ACCEPT_STRING } from '../../lib/uploadTypes';
import { en, de } from './i18nText';

// SQEM-658 — a chat attachment read in the browser and sent as text.

const decode = (dataUrl: string) => new TextDecoder().decode(Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0)));

describe('SQEM-658 — Office attachments in the chat', () => {
  it('a Word file becomes a text attachment labelled DOCX, umlauts intact', async () => {
    const doc = new Document({ sections: [{ children: [new Paragraph('Größe: 12 €')] }] });
    const blob = new Blob([new Uint8Array(await Packer.toBuffer(doc))]);
    const a = await officeAttachment(blob, 'Brief.docx');
    expect(a.label).toBe('DOCX');
    expect(a.truncated).toBe(false);
    expect(a.dataUrl.startsWith('data:text/plain;base64,')).toBe(true);
    expect(decode(a.dataUrl)).toBe("File: Brief.docx (Word document) — converted to text by sqemes (sqemes reader 2); this text is the file's content.\n\nGröße: 12 €");
  });

  it('base64 of long UTF-8 text does not overflow the stack', () => {
    const long = 'ä'.repeat(200_000);
    expect(decode(`data:text/plain;base64,${utf8ToBase64(long)}`)).toBe(long);
  });

  it('the composer accepts the three formats; the prompt launch modal keeps its list', () => {
    for (const ext of ['.docx', '.xlsx', '.pptx']) expect(CHAT_ACCEPT_STRING).toContain(ext);
    expect(ACCEPT_STRING).not.toContain('.docx');
  });

  it('the chat page uses it, labels the chip and names old formats', () => {
    const chat = readFileSync('pages/Chat.tsx', 'utf8');
    expect(chat).toMatch(/if \(officeKindOf\(file\.name\)\) \{/);
    expect(chat).toMatch(/isLegacyOfficeName\(file\.name\)\) \{ showToast\(txt\.chat_attach_legacy_office\(\)/);
    expect(chat).toMatch(/if \(officeKindOf\(f\.name\)\) \{ await attachOffice\(blob, f\.name\); continue; \}/);
    expect(chat.match(/att\.label \?\? fileTypeLabel\(att\.mimeType\)/g)).toHaveLength(3);
    expect(chat).toMatch(/accept=\{CHAT_ACCEPT_STRING\}/);
    expect(readFileSync('components/WorkspaceFilePickerModal.tsx', 'utf8')).toMatch(/officeKindOf\(f\.name\) !== null/);
  });

  it('both languages', () => {
    for (const k of ['chat_attach_truncated', 'chat_attach_office_failed', 'chat_attach_legacy_office'] as const) {
      expect(en[k], k).toBeTruthy();
      expect(de[k], k).toBeTruthy();
    }
  });
});

describe('SQEM-658 — Office files can be uploaded in the app, not only over MCP', () => {
  it('a real Office file keeps its type on the row and is stored as octet-stream; a fake one is not', async () => {
    const { classifySkillFile, OCTET_STREAM } = await import('../../supabase/functions/_shared/skillFile');
    const doc = new Document({ sections: [{ children: [new Paragraph('x')] }] });
    const bytes = new Uint8Array(await Packer.toBuffer(doc));
    expect(classifySkillFile('Preise.docx', bytes)).toEqual({
      rowMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storageMime: OCTET_STREAM, isText: false,
    });
    expect(classifySkillFile('fake.docx', new TextEncoder().encode('just text')).isText).toBe(true);
  });
  it('the Files page and the upload modal accept them; the app upload path classifies them', () => {
    for (const ext of ['.docx', '.xlsx', '.pptx']) expect(FILE_ACCEPT_STRING).toContain(ext);
    const files = readFileSync('lib/api/files.ts', 'utf8');
    expect(files).toMatch(/\} else if \(officeKindOf\(file\.name\)\) \{[\s\S]{0,600}classifySkillFile\(file\.name, bytes\)/);
    expect(readFileSync('pages/Chat.tsx', 'utf8')).toMatch(/!SUPPORTED_MIME_TYPES\.has\(file\.type\) && !officeKindOf\(file\.name\)/);
  });
});

describe('SQEM-658 — files up to 15 MB: read in the browser at upload, stored by the server', () => {
  const read = (p: string) => readFileSync(p, 'utf8');
  it('the upload reads an Office file and hands the text to store-file-text, never failing the upload', () => {
    const files = read('lib/api/files.ts');
    expect(files).toMatch(/if \(officeKindOf\(file\.name\)\) void storeOfficeText\(fileId, file, file\.name\)\.catch\(\(\) => undefined\);/);
    expect(files).toMatch(/functionCallUrl\('store-file-text'\)/);
    expect(read('pages/Files.tsx')).toMatch(/void prepareOfficeTexts\(workspace\.id\);/);
  });
  it('⛔ store-file-text: admins and editors only, only Office files, only the current reader output, overwrites', () => {
    const fn = read('supabase/functions/store-file-text/index.ts');
    expect(fn).toMatch(/return data\?\.role === 'admin' \|\| data\?\.role === 'editor';/);
    expect(fn).toMatch(/if \(!file \|\| !\(await canWrite\(file\.workspace_id\)\)\) return json\(\{ error: txt\.srv_not_found/);
    expect(fn).toMatch(/if \(!officeKindOf\(file\.name\)\) return json/);
    expect(fn).toMatch(/!text\.includes\(OFFICE_READER_MARKER\)/);
    expect(fn).toMatch(/\{ onConflict: 'file_id' \}\);/);
    expect(fn).toMatch(/if \(!\(await canWrite\(body\.workspaceId\)\)\) return json\(\{ files: \[\] \}\);/);
    expect(read('supabase/config.toml')).toMatch(/\[functions\.store-file-text\]\nverify_jwt = false/);
  });
  it('an MCP upload says when the file reads as text', async () => {
    const { officeUploadNote, OFFICE_SERVER_READ_MAX_BYTES } = await import('../../supabase/functions/_shared/officeText');
    expect(officeUploadNote('a.pdf', 10)).toBeUndefined();
    expect(officeUploadNote('Preise.xlsx', 1000)).toMatch(/^Readable as text/);
    expect(officeUploadNote('stock.xlsx', OFFICE_SERVER_READ_MAX_BYTES + 1)).toMatch(/prepared the next time an admin or editor opens Files/);
    const actions = read('supabase/functions/_shared/libraryActions.ts');
    expect(actions.match(/officeUploadNote\(inserted\.name, sizeBytes\)/g)).toHaveLength(2);
  });
});

describe('SQEM-658 — one size limit for upload and reading', () => {
  it('the bucket limit in the migrations equals MAX_FILE_SIZE_BYTES; readers use the same constant', async () => {
    const { readdirSync } = await import('node:fs');
    const { MAX_FILE_SIZE_BYTES } = await import('../../supabase/functions/_shared/skillFile');
    // The newest statement that sets the workspace-files bucket's limit decides (insert or update).
    const dir = 'supabase/migrations';
    const found: number[] = [];
    for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      const sql = readFileSync(`${dir}/${f}`, 'utf8');
      for (const st of sql.split(';')) {
        if (!/storage\.buckets/.test(st) || !/'workspace-files'/.test(st)) continue;
        const num = st.match(/file_size_limit\s*=\s*(\d+)/) ?? st.match(/\b(\d{7,9})\b/);
        if (num) found.push(Number(num[1]));
      }
    }
    expect(found.length).toBeGreaterThan(0);
    const n = found[found.length - 1];
    expect(n).toBe(MAX_FILE_SIZE_BYTES);
    expect(readFileSync('lib/uploadTypes.ts', 'utf8')).toMatch(/export \{ MAX_FILE_SIZE_MB, MAX_FILE_SIZE_BYTES \} from '..\/supabase\/functions\/_shared\/skillFile'/);
    expect(readFileSync('lib/api/files.ts', 'utf8')).toMatch(/x\.sizeBytes <= MAX_FILE_SIZE_BYTES/);
  });
});
