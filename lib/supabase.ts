import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check .env.local');
}

// ---------------------------------------------------------------------------
// ByteString workaround
// ---------------------------------------------------------------------------
// Chrome's native fetch() throws "headers is not a valid ByteString" when any
// header value contains characters with code points > 0xFF. We fix this at two
// levels:
//
// 1. Headers.prototype.set / .append — sanitize values so explicit .set()
//    calls (e.g., SDK's fetchWithAuth) are always safe.
//
// 2. globalThis.fetch — when headers are passed as a plain object or array,
//    Chrome validates them via internal C++ code that BYPASSES our .set patch.
//    So we intercept fetch, manually iterate the plain-object headers through
//    new Headers() + .set() (which IS our patched version), and pass the
//    resulting clean Headers instance to native fetch.
//
// Scope: the fetch patch only activates for requests to our Supabase project
// URL (SDK calls + manual Edge function fetches). All other origins pass
// through to native fetch untouched, limiting the blast radius of the patch.
//
// Observability: in development, a console.warn fires whenever strip() actually
// removes a character, so we can identify the real source if it ever fires.
// ---------------------------------------------------------------------------
const _latin1 = /[^\x00-\xFF]/g;
const strip = (v: string) => {
  const cleaned = v.replace(_latin1, '');
  if (import.meta.env.DEV && cleaned !== v) {
    console.warn('[supabase] ByteString patch stripped non-Latin1 chars from header value. Raw value:', JSON.stringify(v));
  }
  return cleaned;
};

const _origSet = Headers.prototype.set;
Headers.prototype.set = function (name: string, value: string) {
  return _origSet.call(this, name, strip(value));
};

const _origAppend = Headers.prototype.append;
Headers.prototype.append = function (name: string, value: string) {
  return _origAppend.call(this, name, strip(value));
};

const _nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = function (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Only sanitize headers for calls to the Supabase project (all SDK calls and
  // manual Edge function fetches go here). Other origins are unaffected.
  const url =
    typeof input === 'string' ? input
    : input instanceof URL ? input.href
    : (input as Request).url;

  if (url.startsWith(supabaseUrl) && init?.headers && !(init.headers instanceof Headers)) {
    // Build a Headers object using our patched .set() so values get sanitized.
    // Do NOT pass the plain object to `new Headers(obj)` — Chrome's constructor
    // uses internal C++ validation that bypasses our .set() patch.
    const clean = new Headers();
    const entries: [string, string][] = Array.isArray(init.headers)
      ? init.headers
      : Object.entries(init.headers as Record<string, string>);
    for (const [k, v] of entries) {
      clean.set(k, v); // goes through our patched .set → strip()
    }
    return _nativeFetch(input, { ...init, headers: clean });
  }
  return _nativeFetch(input, init);
} as typeof fetch;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
