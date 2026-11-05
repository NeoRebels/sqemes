import { describe, it, expect } from 'vitest';
import * as refusal from '../../supabase/functions/_shared/connectorRefusal';

/**
 * SQEM-466/584 — the line under an answer that had to do without a connector.
 * SQEM-652 — the provider-side label parsing is gone: every provider calls connectors through sqemes,
 * and a connector that cannot list its tools is left out before the request and named here.
 */
describe('the notice for a connector that was left out', () => {
  it('⛔ names the connector and says what to do', () => {
    const n = refusal.connectorRefusedNotice(['Plaud']);
    expect(n).toMatch(/Plaud/);
    expect(n).toMatch(/Settings → Connectors/);
    // Never a bare internal label — it means nothing to a person.
    expect(n).not.toMatch(/c_[0-9a-f]{8}/);
  });

  it('says nothing when nothing was dropped', () => {
    expect(refusal.connectorRefusedNotice([])).toBe('');
  });

  it('SQEM-652 — the provider refusal parsers are gone', () => {
    expect(Object.keys(refusal)).toEqual(['connectorRefusedNotice']);
  });
});
