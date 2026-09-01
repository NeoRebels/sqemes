import { describe, it, expect } from 'vitest';
import { isMultiSeat, accessAppliesTo } from '../../lib/templateAccessScope';

const ws = (plan: 'Solo' | 'Team' | 'Business', isManaged = false) => ({ plan, isManaged } as any);

describe('isMultiSeat', () => {
  it('Solo is not', () => expect(isMultiSeat(ws('Solo'))).toBe(false));
  it('Team and Business are', () => {
    expect(isMultiSeat(ws('Team'))).toBe(true);
    expect(isMultiSeat(ws('Business'))).toBe(true);
  });

  // There is no `Enterprise` tier; a managed workspace is what that arrangement looks like in the
  // data, and it lifts seat limits entirely.
  it('a managed Solo workspace counts as multi-seat', () => {
    expect(isMultiSeat(ws('Solo', true))).toBe(true);
  });

  // The workspace is null for a moment on first render. Treating that as multi-seat would flash the
  // control on for Solo users; treating it as Solo merely delays it by a tick.
  it('no workspace yet is not multi-seat', () => expect(isMultiSeat(null)).toBe(false));
});

describe('accessAppliesTo', () => {
  it('hides access on Solo when the template has no rules', () => {
    expect(accessAppliesTo(ws('Solo'), false)).toBe(false);
  });

  it('shows it on Team even with no rules — the reported bug', () => {
    expect(accessAppliesTo(ws('Team'), false)).toBe(true);
  });

  // ⛔ The one that matters most. A workspace downgraded from Team to Solo keeps its restricted
  // templates: `template_access` rows survive the plan change untouched. Hiding the control would
  // leave the owner looking at a template restricted against them, with nothing on screen saying so
  // and no way to lift it — hiding an *answer*, not a question.
  it('shows it on Solo when rules already exist (the downgrade case)', () => {
    expect(accessAppliesTo(ws('Solo'), true)).toBe(true);
  });
});
