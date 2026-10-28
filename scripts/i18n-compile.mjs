// SQEM-599 — compiles messages/*.json into supabase/functions/_shared/i18n/ (committed output).
import { compile } from '@inlang/paraglide-js';
import { i18nOptions } from '../i18n.config.mjs';

await compile(i18nOptions);
