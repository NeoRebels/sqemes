import { defaultUrlTransform } from 'react-markdown';

/**
 * SQEM-196 — URL sanitizer for model-supplied markdown.
 *
 * SECURITY-RELEVANT. Read this before changing it.
 *
 * SQEM-019 closed an XSS hole by relying on react-markdown's `defaultUrlTransform`,
 * which allows only `http`, `https`, `ircs`, `mailto`, `xmpp` and relative URLs and
 * rewrites everything else to `''`. That was correct and must stay.
 *
 * It also broke image generation. Generated images are emitted by the edge functions as
 * markdown data URIs — `![Generated Image](data:image/png;base64,…)` (`chat-message`,
 * `execute-step`). `defaultUrlTransform` rewrote that `src` to `''`, and Chrome neither
 * fetches nor fires `error` on `<img src="">`, so the browser fell back to rendering the
 * bare alt text: "Generated Image", nothing else. That is the whole bug — it looked like a
 * broken feature and was a one-line sanitizer decision. Provider-independent, because
 * Gemini (`inlineData`) and OpenAI (`b64_json`) both arrive as data URIs; only the third
 * path (`![Generated Image](<https url>)`) ever rendered.
 *
 * **Two schemes have to pass, not one.** Chat does not render the data URI directly:
 * `inlineImagesToBlobUrls()` in `pages/Chat.tsx` rewrites every generated image to a
 * `blob:` URL before rendering (on all paths — fresh result, session load, realtime). So
 * react-markdown sees `blob:` in Chat and `data:` in `EditorTestPanel`, which renders the
 * raw content. `defaultUrlTransform` strips both, and allowing only one leaves the other
 * broken — that mistake cost a round trip on this very ticket.
 *
 * The exception is deliberately the narrowest one that works:
 *
 *   - only for `src`, never `href` — a `data:` link is still an attack vector
 *   - only on `img` elements
 *   - only base64 **raster** images. `image/svg+xml` is excluded on purpose: SVG can carry
 *     script, and we have no reason to accept it — no provider emits it.
 *   - `blob:` only in the exact shape `URL.createObjectURL` produces. A fabricated blob URL
 *     resolves to nothing anyway: blob URLs are only valid in the origin that created them.
 *
 * Everything else, including any `javascript:` URL, still goes through
 * `defaultUrlTransform` untouched.
 *
 * NOTE: the CSP must allow both schemes too — `img-src` in `vercel.json` carries
 * `data: blob:`. Sanitizer and CSP are independent gates; SQEM-019/111 closed both at once,
 * which is why this broke in two places for one symptom.
 */
const ALLOWED_IMAGE_DATA_URI = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const ALLOWED_IMAGE_BLOB_URL = /^blob:https?:\/\/[^/\s]+\/[0-9a-f-]+$/i;

export function markdownUrlTransform(
  url: string,
  key: string,
  node: { tagName?: string } | null | undefined,
): string {
  if (key === 'src' && node?.tagName === 'img') {
    if (ALLOWED_IMAGE_DATA_URI.test(url) || ALLOWED_IMAGE_BLOB_URL.test(url)) return url;
  }
  return defaultUrlTransform(url);
}
