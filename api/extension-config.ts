// SQEM-063 — public runtime config discovery for the Chrome extension.
//
// Lets one published extension point at ANY Sqemes instance (Cloud or self-hosted): the user
// enters just the instance URL, and the extension fetches the rest from here. All three values are
// public by design — the anon key is a *publishable* key, and the URLs are already visible in the
// served app — so this endpoint is intentionally unauthenticated + CORS-open.
//
// SQEM-309 — it also carries the **model list** now, and that is the point of the file being `.ts`.
//
// ⛔ The extension used to ship its own copy. Measured on 2026-09-01: **5 of 25 ids in common** — it
// had drifted a whole generation behind (`gpt-5.2`, `o3`, `gemini-2.5-*`) while the app moved on. A
// retired id does not fail at build time; it fails at the provider, in front of the person, with an
// error that is not ours.
//
// Updating the copy would have fixed today. **The next model change would have split them again**,
// unnoticed, because nothing compares the two. So the list travels through the channel the extension
// already asks about — and it is per instance, which is the honest answer for self-host too: which
// models exist depends on which keys that instance has.
//
// ⚠️ **Text models only.** The extension's enhance is text; it kept a second hard-coded list of image
// ids purely to filter them out. Serving them pre-filtered removes that list as well.
//
// Served at /.well-known/sqemes-extension-config (see vercel.json rewrite).
// ⛔ **The `.js` extension is required and is not a typo.** Vercel *transpiles* these functions, it
// does not bundle them: the specifier written here survives into the emitted file, and Node's ESM
// loader never appends an extension. `from '../constants'` produced a 500 on production —
// `ERR_MODULE_NOT_FOUND: /var/task/constants` — while the build, `tsc` and lint all stayed green,
// because the rule is a runtime resolution rule and none of the three evaluates it.
// `api/marketplace-submit.js` already imported its sibling as `./_marketplaceToken.js`; this file
// was the only one in `api/` that left the extension off.
import { AVAILABLE_MODELS } from '../constants.js';

// Mirrors `lib/authoringAI.ts`. ⚠️ Two copies of this rule is one too many, but the alternative —
// importing from `lib/` into a serverless function — drags the browser modules in behind it.
const IMAGE_MODEL_PATTERNS = ['image', 'dall-e', 'aurora'];
const isImageModel = (id: string) => IMAGE_MODEL_PATTERNS.some(p => id.toLowerCase().includes(p));

type Req = { method?: string; headers: Record<string, string | string[] | undefined> };
type Res = {
  setHeader: (k: string, v: string) => void;
  status: (c: number) => { end: () => void; json: (b: unknown) => void };
};

export default function handler(req: Req, res: Res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    return res.status(200).end();
  }

  // .trim() — guard against a trailing newline in the Vercel env var (bit us before).
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || '').trim();
  const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  // The app origin the extension watches for the sign-in cookie/sync flow = wherever this endpoint
  // is served, so it self-describes each instance with no extra config.
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const appOrigin = host ? `https://${host}` : '';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=300');
  // Only what a client needs to render a picker. The descriptions, specs and the reasoning around
  // them stay in `constants.ts`, where they are read by people rather than parsed.
  const models = AVAILABLE_MODELS
    .filter(m => !isImageModel(m.id))
    .map(m => ({ id: m.id, name: m.name, provider: m.provider }));

  return res.status(200).json({ supabaseUrl, supabaseAnonKey, appOrigin, models });
}
