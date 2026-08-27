import { describe, it, expect } from 'vitest';
import {
  LEGAL_DOCUMENTS,
  publishedDocuments,
  gateApplies,
  pendingAcceptances,
  needsAcceptance,
  acceptanceRows,
  type LegalDocument,
} from '../../lib/legal';

// SQEM-264 — the decisions here are legal, not cosmetic, so they are pinned rather than trusted.
// Two of these tests exist because getting them wrong fails *silently*: an unpublished document that
// still gates locks everyone out of the product, and a version bump that does not re-gate looks
// exactly like a version bump that works.

const doc = (over: Partial<LegalDocument> = {}): LegalDocument => ({
  id: 'terms', label: 'Terms and Conditions', url: 'https://example.test/terms', version: '1.0', ...over,
});

describe('legal — nothing published means nothing blocks', () => {
  it('no real document is published without a URL that could resolve', () => {
    // **The safety property of this whole feature**, and it outlived the one it replaced.
    //
    // Until 2026-08-25 this asserted that both documents were unpublished — correct while the texts
    // did not exist, and useless the moment they did. What actually matters is the pairing: a version
    // without a working URL shows *every signed-in user* a blocking screen whose only link goes
    // nowhere. That is the single failure mode here that hits the entire population at once.
    for (const d of LEGAL_DOCUMENTS) {
      if (d.version !== null) {
        expect(d.url, `${d.id} is published as ${d.version} but has no URL`).toMatch(/^https:\/\/\S+$/);
      }
    }
  });

  it('the published set is exactly what the gate will ask for', () => {
    // A second pair of eyes on the same line: if someone adds a third document, this fails until they
    // have thought about whether the gate should really block on it.
    expect(publishedDocuments().map(d => d.id).sort()).toEqual(['privacy', 'terms']);
  });

  it('a null version produces no pending acceptance, even with no records at all', () => {
    const docs = [doc({ version: null }), doc({ id: 'privacy', version: null })];
    expect(pendingAcceptances([], docs)).toEqual([]);
    expect(needsAcceptance([], docs)).toBe(false);
  });

  it('publishedDocuments drops the unpublished ones', () => {
    const docs = [doc({ version: '1.0' }), doc({ id: 'privacy', version: null })];
    expect(publishedDocuments(docs).map(d => d.id)).toEqual(['terms']);
  });
});

describe('legal — what a person still owes', () => {
  it('an untouched account owes every published document', () => {
    const docs = [doc(), doc({ id: 'privacy' })];
    expect(pendingAcceptances([], docs).map(d => d.id)).toEqual(['terms', 'privacy']);
  });

  it('accepting one document does not settle the other', () => {
    const docs = [doc(), doc({ id: 'privacy' })];
    const accepted = [{ document: 'terms', version: '1.0' }];
    expect(pendingAcceptances(accepted, docs).map(d => d.id)).toEqual(['privacy']);
  });

  it('a version bump re-opens a document that was already accepted', () => {
    // The point of versioning. If this ever returns [], amending the terms silently changes nothing
    // and the record claims agreement to a text the person never saw.
    const accepted = [{ document: 'terms', version: '1.0' }];
    expect(pendingAcceptances(accepted, [doc({ version: '2.0' })]).map(d => d.id)).toEqual(['terms']);
  });

  it('an older acceptance does not satisfy a newer version by being "some" acceptance', () => {
    const accepted = [
      { document: 'terms', version: '1.0' },
      { document: 'terms', version: '1.1' },
    ];
    expect(needsAcceptance(accepted, [doc({ version: '2.0' })])).toBe(true);
    expect(needsAcceptance(accepted, [doc({ version: '1.1' })])).toBe(false);
  });
});

describe('legal — the rows that get written', () => {
  it('writes one row per published document, carrying the version', () => {
    const docs = [doc(), doc({ id: 'privacy', version: '3.2' })];
    expect(acceptanceRows('user-1', docs)).toEqual([
      { user_id: 'user-1', document: 'terms', version: '1.0' },
      { user_id: 'user-1', document: 'privacy', version: '3.2' },
    ]);
  });

  it('never writes a row for an unpublished document', () => {
    // A row with a null version would violate the table's NOT NULL and fail the whole insert —
    // taking the published document's row down with it.
    expect(acceptanceRows('user-1', [doc({ version: null })])).toEqual([]);
  });
});

describe('legal — who the gate applies to (SQEM-284)', () => {
  it('never gates a self-hosted instance, even with documents published', () => {
    // The whole point. Our documents cover app.sqemes.com and say so; the operator of a self-hosted
    // instance is the controller, not us. Gating their users behind our contract puts a wall in
    // front of somebody else's product — and this component wraps the entire authenticated app.
    expect(gateApplies({ selfHosted: true, docs: [doc({ version: '1.1' })] })).toBe(false);
  });

  it('gates Cloud once a document is published', () => {
    expect(gateApplies({ selfHosted: false, docs: [doc({ version: '1.1' })] })).toBe(true);
  });

  it('does not gate Cloud while nothing is published', () => {
    expect(gateApplies({ selfHosted: false, docs: [doc({ version: null })] })).toBe(false);
  });

  it('keeps the two exemptions independent', () => {
    // ⚠️ This is the regression. Before SQEM-284 the self-host case had no guard of its own — it was
    // riding on "nothing is published yet", which stopped being true the moment SQEM-264 set the
    // first version. Nothing failed, no test went red; self-hosters simply started being asked to
    // accept our Cloud terms, and shipped that way through three releases.
    //
    // So: self-host must be false regardless of what the documents say, and the published check must
    // still do its own job on Cloud. One condition standing in for the other is how this happened.
    expect(gateApplies({ selfHosted: true, docs: [doc({ version: null })] })).toBe(false);
    expect(gateApplies({ selfHosted: true, docs: LEGAL_DOCUMENTS })).toBe(false);
    expect(gateApplies({ selfHosted: false, docs: LEGAL_DOCUMENTS })).toBe(true);
  });
});
