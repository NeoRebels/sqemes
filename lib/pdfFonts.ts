/**
 * SQEM-597 — the two extra PDF fonts (Open Sans, Lato; SIL Open Font License 1.1, from @fontsource,
 * latin subset — covers German umlauts, ß and €). Imported only by `bundledPdfFont()` in
 * lib/fileExport.ts, so these URLs — and the files behind them — load only when a PDF uses the font.
 */
import osR from '@fontsource/open-sans/files/open-sans-latin-400-normal.woff?url';
import osB from '@fontsource/open-sans/files/open-sans-latin-700-normal.woff?url';
import osI from '@fontsource/open-sans/files/open-sans-latin-400-italic.woff?url';
import osBI from '@fontsource/open-sans/files/open-sans-latin-700-italic.woff?url';
import laR from '@fontsource/lato/files/lato-latin-400-normal.woff?url';
import laB from '@fontsource/lato/files/lato-latin-700-normal.woff?url';
import laI from '@fontsource/lato/files/lato-latin-400-italic.woff?url';
import laBI from '@fontsource/lato/files/lato-latin-700-italic.woff?url';

export const PDF_FONT_URLS = {
  'Open Sans': { normal: osR, bold: osB, italics: osI, bolditalics: osBI },
  Lato: { normal: laR, bold: laB, italics: laI, bolditalics: laBI },
} as const;
