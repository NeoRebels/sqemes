import { describe, it, expect } from 'vitest';
import { inferTextMime, fileTypeLabel, isImageType, isTextType } from '../../lib/uploadTypes';

// SQEM-184 — extension→mime + type labels driving upload/storage handling.
describe('inferTextMime', () => {
  it('maps known text/code extensions (case-insensitive)', () => {
    expect(inferTextMime('notes.md')).toBe('text/markdown');
    expect(inferTextMime('SCRIPT.TS')).toBe('text/typescript');
    expect(inferTextMime('data.json')).toBe('application/json');
  });
  it('returns null for unknown or extensionless files', () => {
    expect(inferTextMime('photo.png')).toBeNull();
    expect(inferTextMime('README')).toBeNull();
  });
});

describe('fileTypeLabel', () => {
  it('labels known mime types', () => {
    expect(fileTypeLabel('application/pdf')).toBe('PDF');
    expect(fileTypeLabel('image/jpeg')).toBe('JPG');
    expect(fileTypeLabel('text/typescript')).toBe('TS');
  });
  it('defaults to FILE for anything unknown', () => {
    expect(fileTypeLabel('application/x-unknown')).toBe('FILE');
  });
});

describe('isImageType / isTextType', () => {
  it('checks the mime prefix', () => {
    expect(isImageType('image/png')).toBe(true);
    expect(isImageType('text/plain')).toBe(false);
    expect(isTextType('text/markdown')).toBe(true);
    expect(isTextType('application/pdf')).toBe(false);
  });
});
