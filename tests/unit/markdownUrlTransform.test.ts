import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { markdownUrlTransform } from '../../lib/markdownUrlTransform';

// SQEM-196 — the sanitizer exception that lets generated images render.
// SECURITY-RELEVANT: SQEM-019 closed an XSS hole here, so every "still blocked" case
// below is a regression guard, not a nice-to-have. If one of them starts failing, the
// exception has been widened too far.

const img = { tagName: 'img' };
const anchor = { tagName: 'a' };

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

describe('markdownUrlTransform — the exception', () => {
  it('lets a base64 PNG through as an image src', () => {
    expect(markdownUrlTransform(PNG, 'src', img)).toBe(PNG);
  });

  it.each(['png', 'jpeg', 'jpg', 'gif', 'webp'])('allows %s', (type) => {
    const url = `data:image/${type};base64,iVBORw0KGg==`;
    expect(markdownUrlTransform(url, 'src', img)).toBe(url);
  });

  it('still allows ordinary https images', () => {
    const url = 'https://example.com/a.png';
    expect(markdownUrlTransform(url, 'src', img)).toBe(url);
  });

  // Chat rewrites every generated image to a blob: URL before rendering
  // (inlineImagesToBlobUrls in pages/Chat.tsx), so this is the scheme that actually
  // reaches the renderer there. Allowing only data: fixed the test panel and left Chat
  // broken — that is what this block guards against.
  it('lets a blob: URL through as an image src', () => {
    const url = 'blob:https://app.sqemes.com/0e4b1f2a-3c5d-4e6f-8a9b-0c1d2e3f4a5b';
    expect(markdownUrlTransform(url, 'src', img)).toBe(url);
  });

  it('accepts a blob: URL on an http origin too (local dev)', () => {
    const url = 'blob:http://localhost:3000/0e4b1f2a-3c5d-4e6f-8a9b-0c1d2e3f4a5b';
    expect(markdownUrlTransform(url, 'src', img)).toBe(url);
  });
});

describe('markdownUrlTransform — what stays blocked', () => {
  it('blocks javascript: on a link', () => {
    expect(markdownUrlTransform('javascript:alert(1)', 'href', anchor)).toBe('');
  });

  it('blocks javascript: on an image src too', () => {
    expect(markdownUrlTransform('javascript:alert(1)', 'src', img)).toBe('');
  });

  it('blocks a data: URI on a link — the exception is images only', () => {
    expect(markdownUrlTransform(PNG, 'href', anchor)).toBe('');
  });

  it('blocks svg+xml — SVG can carry script and no provider emits it', () => {
    const svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    expect(markdownUrlTransform(svg, 'src', img)).toBe('');
  });

  it('blocks a non-image data: URI', () => {
    expect(markdownUrlTransform('data:text/html;base64,PGgxPmhpPC9oMT4=', 'src', img)).toBe('');
  });

  it('blocks a data: image that is not base64-encoded', () => {
    expect(markdownUrlTransform('data:image/png,<script>', 'src', img)).toBe('');
  });

  it('rejects a payload with characters outside the base64 alphabet', () => {
    expect(markdownUrlTransform('data:image/png;base64,abc<script>', 'src', img)).toBe('');
  });

  it('does not apply the exception to a non-img element', () => {
    expect(markdownUrlTransform(PNG, 'src', { tagName: 'iframe' })).toBe('');
  });

  it('blocks a blob: URL on a link', () => {
    const url = 'blob:https://app.sqemes.com/0e4b1f2a-3c5d-4e6f-8a9b-0c1d2e3f4a5b';
    expect(markdownUrlTransform(url, 'href', anchor)).toBe('');
  });

  it('blocks a blob: URL that is not the shape createObjectURL produces', () => {
    expect(markdownUrlTransform('blob:javascript:alert(1)', 'src', img)).toBe('');
    expect(markdownUrlTransform('blob:https://evil.test/../../etc', 'src', img)).toBe('');
  });

  it('survives a missing node without throwing', () => {
    expect(markdownUrlTransform(PNG, 'src', undefined)).toBe('');
    expect(markdownUrlTransform(PNG, 'src', null)).toBe('');
  });
});

// The bug as the customer saw it, reproduced through the real renderer — and the fix.
// This is what makes the regression impossible to reintroduce silently: it asserts the
// rendered markup, not just the helper in isolation.
describe('markdownUrlTransform — rendered through react-markdown', () => {
  const markdown = `![Generated Image](${PNG})`;

  it('reproduces the bug: without the transform the image renders with no src at all', () => {
    const html = renderToStaticMarkup(createElement(ReactMarkdown, null, markdown));
    // `<img alt="Generated Image"/>` — the sanitizer emptied the URL and React then drops
    // the attribute entirely. An <img> without src never fetches and never fires `error`,
    // so nothing can catch it: the browser just paints the alt text. That is exactly what
    // the customer reported seeing, and nothing else.
    expect(html).toContain('alt="Generated Image"');
    expect(html).not.toContain('data:image/png');
    expect(html).not.toContain('src=');
  });

  it('fixes it: with the transform the data URI survives into the src', () => {
    const html = renderToStaticMarkup(
      createElement(ReactMarkdown, { urlTransform: markdownUrlTransform }, markdown),
    );
    expect(html).toContain(`src="${PNG}"`);
    expect(html).toContain('alt="Generated Image"');
  });

  it('the Chat path renders too: a blob: URL survives into the src', () => {
    // What Chat actually feeds the renderer, after inlineImagesToBlobUrls has run.
    const blobUrl = 'blob:https://app.sqemes.com/0e4b1f2a-3c5d-4e6f-8a9b-0c1d2e3f4a5b';
    const html = renderToStaticMarkup(
      createElement(ReactMarkdown, { urlTransform: markdownUrlTransform }, `![Generated Image](${blobUrl})`),
    );
    expect(html).toContain(`src="${blobUrl}"`);
  });

  it('a javascript: link is still neutralised when rendered', () => {
    const html = renderToStaticMarkup(
      createElement(ReactMarkdown, { urlTransform: markdownUrlTransform }, '[click](javascript:alert(1))'),
    );
    expect(html).not.toContain('javascript:');
  });
});
