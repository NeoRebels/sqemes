import { describe, it, expect } from 'vitest';
import { normalizeSkillPath, matchSkillPath, isResourcePath } from '../../supabase/functions/_shared/skillPaths';

/** SQEM-499 — paths inside a skill, as SKILL.md writes them. */
const files = [
  { id: 'a', name: 'diagram-design/references/animation.md' },
  { id: 'b', name: 'diagram-design/SKILL.md' },
  { id: 'c', name: 'references/style.md' },
  { id: 'd', name: 'x/notes.md' },
  { id: 'e', name: 'y/notes.md' },
];

describe('normalizeSkillPath', () => {
  it('strips ./ and leading slashes', () => {
    expect(normalizeSkillPath('./references/a.md')).toBe('references/a.md');
    expect(normalizeSkillPath('/references/a.md')).toBe('references/a.md');
  });
  it('⛔ refuses .. so a path cannot climb out of the skill', () => {
    expect(normalizeSkillPath('../other/x.md')).toBeNull();
    expect(normalizeSkillPath('references/../../x.md')).toBeNull();
    expect(normalizeSkillPath('')).toBeNull();
  });
});

describe('matchSkillPath', () => {
  it('an exact name wins', () => {
    expect(matchSkillPath(files, 'references/style.md')).toEqual({ kind: 'found', id: 'c', name: 'references/style.md' });
  });
  it('the path as SKILL.md writes it finds a file stored with the skill folder in front', () => {
    expect(matchSkillPath(files, 'references/animation.md')).toEqual({ kind: 'found', id: 'a', name: 'diagram-design/references/animation.md' });
  });
  it('⛔ several matches are reported, never guessed', () => {
    expect(matchSkillPath(files, 'notes.md')).toEqual({ kind: 'ambiguous', candidates: ['x/notes.md', 'y/notes.md'] });
  });
  it('a partial name is not a match (only whole path segments)', () => {
    expect(matchSkillPath(files, 'nimation.md')).toEqual({ kind: 'none' });
  });
  it('no match, and a climbing path, are none', () => {
    expect(matchSkillPath(files, 'missing.md')).toEqual({ kind: 'none' });
    expect(matchSkillPath(files, '../SKILL.md')).toEqual({ kind: 'none' });
  });
});

describe('isResourcePath', () => {
  it('assets/ and scripts/ are resources, with or without the skill folder in front', () => {
    expect(isResourcePath('assets/logo.png')).toBe(true);
    expect(isResourcePath('diagram-design/assets/template.html')).toBe(true);
    expect(isResourcePath('skill/scripts/run.py')).toBe(true);
  });
  it('everything else stays context — including a FILE called assets', () => {
    expect(isResourcePath('references/a.md')).toBe(false);
    expect(isResourcePath('SKILL.md')).toBe(false);
    expect(isResourcePath('docs/assets')).toBe(false);
    expect(isResourcePath('assets.md')).toBe(false);
  });
});
