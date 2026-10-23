import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMediaFile, isImageType } from '../../lib/uploadTypes';

/**
 * SQEM-562 — the Files page filter is "All · Media · Documents". Media = images, video and audio, by
 * type OR extension: video, audio and SVG arrive via skill import/MCP, where the row type comes from
 * the bytes (an .mp4 is `application/octet-stream`, an .svg is text).
 */
describe('isMediaFile', () => {
  it('counts images, video and audio as media — by type or by extension', () => {
    expect(isMediaFile('logo.png', 'image/png')).toBe(true);
    expect(isMediaFile('assets/icon.svg', 'text/plain')).toBe(true);
    expect(isMediaFile('assets/intro.mp4', 'application/octet-stream')).toBe(true);
    expect(isMediaFile('jingle.MP3', 'application/octet-stream')).toBe(true);
    expect(isMediaFile('clip', 'video/webm')).toBe(true);
    expect(isMediaFile('voice', 'audio/ogg')).toBe(true);
  });

  it('everything else is a document', () => {
    expect(isMediaFile('price-list.pdf', 'application/pdf')).toBe(false);
    expect(isMediaFile('references/x.md', 'text/markdown')).toBe(false);
    expect(isMediaFile('bundle.zip', 'application/octet-stream')).toBe(false);
    expect(isMediaFile('font.ttf', 'application/octet-stream')).toBe(false);
    expect(isMediaFile('mp4', 'text/plain')).toBe(false); // a name, not an extension
  });

  it('the preview stays for real images only', () => {
    expect(isImageType('text/plain')).toBe(false); // an .svg is media, but gets no thumbnail
  });
});

describe('the Files page uses it', () => {
  const src = readFileSync(resolve(__dirname, '../../pages/Files.tsx'), 'utf8');
  it('tabs are All · Media · Documents, both sides of the filter by isMediaFile', () => {
    expect(src).toMatch(/\{ value: 'media', label: 'Media' \}/);
    expect(src).not.toMatch(/label: 'Images'/);
    expect(src).toMatch(/typeFilter === 'media' && isMediaFile\(f\.name, f\.mimeType\)/);
    expect(src).toMatch(/typeFilter === 'documents' && !isMediaFile\(f\.name, f\.mimeType\)/);
  });
});
