import { describe, expect, it } from 'vitest';
import { anonymizeResources, applyFilter, isActive, RESOURCE, summarizeAttributes } from '../filters';
import type { XrayEvent } from '../types';

const D = 86_400_000;
const LOG: XrayEvent[] = [
  { caseId: 'A', activity: 'Open', timestamp: 0, resource: 'anna', attrs: { type: 'Bug' } },
  { caseId: 'A', activity: 'Done', timestamp: 2 * D, resource: 'bob', attrs: { type: 'Bug' } },
  { caseId: 'B', activity: 'Open', timestamp: 5 * D, resource: 'bob', attrs: { type: 'Story' } },
  { caseId: 'B', activity: 'Done', timestamp: 9 * D, resource: 'bob', attrs: { type: 'Story' } },
  { caseId: 'C', activity: 'Open', timestamp: 10 * D, attrs: { type: 'Bug', id: 'x' } },
];

describe('filters', () => {
  it('summarises case-level attribute values', () => {
    const s = summarizeAttributes(LOG);
    expect(s.map((a) => a.key)).toEqual(['type', RESOURCE]);
    expect(s[0]!.values).toEqual([
      { value: 'Bug', caseCount: 2 },
      { value: 'Story', caseCount: 1 },
    ]);
  });

  it('keeps whole cases matching all conditions', () => {
    const bugs = applyFilter(LOG, { attrs: { type: ['Bug'] } });
    expect(new Set(bugs.map((e) => e.caseId))).toEqual(new Set(['A', 'C']));
    // A case touched by anna keeps all of its events, including bob's.
    const anna = applyFilter(LOG, { attrs: { [RESOURCE]: ['anna'] } });
    expect(anna).toHaveLength(2);
    expect(applyFilter(LOG, { attrs: { type: ['Bug'], [RESOURCE]: ['bob'] } }).map((e) => e.caseId)).toEqual(['A', 'A']);
  });

  it('filters by the period in which cases started', () => {
    const r = applyFilter(LOG, { attrs: {}, from: 1 * D, to: 9 * D });
    expect(new Set(r.map((e) => e.caseId))).toEqual(new Set(['B']));
  });

  it('knows when nothing is filtered', () => {
    expect(isActive({ attrs: { type: [] } })).toBe(false);
    expect(applyFilter(LOG, { attrs: {} })).toBe(LOG);
  });

  it('anonymises resources in order of first appearance', () => {
    const r = anonymizeResources(LOG);
    expect(r.map((e) => e.resource)).toEqual(['Person 1', 'Person 2', 'Person 2', 'Person 2', undefined]);
    expect(LOG[0]!.resource).toBe('anna'); // input untouched
  });
});
