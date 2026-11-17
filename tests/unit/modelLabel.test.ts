import { describe, it, expect } from 'vitest';
import { modelLabel, modelMenuWidth } from '../../lib/enabledModels';
import { AVAILABLE_MODELS } from '../../constants';

// SQEM-698 — one label for a reply's model, live or reloaded; a model menu that fits a phone.
describe('modelLabel', () => {
  const known = AVAILABLE_MODELS[0];
  it('an id from the fixed list becomes its name', () => {
    expect(modelLabel(known.id)).toBe(known.name);
  });
  it('a name stays a name, so a live reply reads the same as a reloaded one', () => {
    expect(modelLabel(known.name)).toBe(known.name);
  });
  it("a workspace's own model (OpenRouter) is named from its list", () => {
    expect(modelLabel('acme/model-x', [{ id: 'acme/model-x', name: 'Model X' }])).toBe('Model X');
  });
  it('a retired model keeps its id', () => {
    expect(modelLabel('gemini-3.7-flash')).toBe('gemini-3.7-flash');
  });
});

describe('modelMenuWidth', () => {
  it('384 px where it fits, the screen minus 16 px where it does not', () => {
    expect(modelMenuWidth(1440)).toBe(384);
    expect(modelMenuWidth(400)).toBe(384);
    expect(modelMenuWidth(390)).toBe(374);
    expect(modelMenuWidth(320)).toBe(304);
  });
});
