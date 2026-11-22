import { describe, expect, it } from 'vitest';
import { analyze, buildCases, processMap, rework, variants } from '../analyze';
import { percentile } from '../stats';
import { END, START, type XrayEvent } from '../types';
import { softwareTeamDemo } from '../../demo/synthetic';

const H = 3_600_000;
const ev = (caseId: string, activity: string, hours: number): XrayEvent => ({ caseId, activity, timestamp: hours * H });

// A: Open → Review → Done            (review 2h)
// B: Open → Review → Open → Review → Done (rework)
// C: Open → Done                      (skips review)
const LOG = [
  ev('A', 'Open', 0), ev('A', 'Review', 1), ev('A', 'Done', 3),
  ev('B', 'Review', 2), ev('B', 'Open', 0), ev('B', 'Open', 4), ev('B', 'Review', 5), ev('B', 'Done', 9),
  ev('C', 'Open', 0), ev('C', 'Done', 10),
];
// Note: B's events are shuffled on purpose and contain Review at 2h, Open at 4h.

describe('analysis', () => {
  it('sorts events inside a case by time', () => {
    const b = buildCases(LOG).find((c) => c.id === 'B')!;
    expect(b.events.map((e) => e.activity)).toEqual(['Open', 'Review', 'Open', 'Review', 'Done']);
  });

  it('builds the directly-follows graph with counts and times', () => {
    const a = analyze(LOG, 1);
    const edge = (f: string, t: string) => a.edges.find((e) => e.from === f && e.to === t);
    expect(edge('Open', 'Review')?.count).toBe(3);
    expect(edge('Review', 'Open')?.count).toBe(1);
    expect(edge('Open', 'Done')?.count).toBe(1);
    expect(edge(START, 'Open')?.count).toBe(3);
    expect(edge('Done', END)?.count).toBe(3);
    // Time in Review: A 2h, B 2h and 4h.
    const review = a.nodes.find((n) => n.id === 'Review')!;
    expect(review.time?.medianMs).toBe(2 * H);
    expect(review.caseCount).toBe(2);
  });

  it('finds variants, rework and cycle time', () => {
    const cases = buildCases(LOG);
    const vs = variants(cases);
    expect(vs).toHaveLength(3);
    const rw = rework(cases);
    expect(rw.pairs[0]).toMatchObject({ from: 'Review', to: 'Open', caseCount: 1 });
    expect(rw.caseShare).toBeCloseTo(1 / 3);
    const a = analyze(LOG);
    expect(a.cycle.medianMs).toBe(9 * H);
  });

  it('percentile matches numpy (linear interpolation)', () => {
    // numpy.percentile([1,2,3,4], 90) == 3.7
    expect(percentile([1, 2, 3, 4], 90)).toBeCloseTo(3.7);
    expect(percentile([5], 50)).toBe(5);
  });

  it('gives three insights on the demo, pointing at the map', () => {
    const a = analyze(softwareTeamDemo());
    expect(a.insights).toHaveLength(3);
    expect(a.insights[0]!.title).toContain('Code Review');
    expect(a.insights.map((i) => i.kind)).toEqual(['slowest-step', 'rework', 'skip']);
    expect(a.insights[1]!.title).toMatch(/from “(Code Review|QA)” to “In Progress”/);
    expect(a.insights[2]!.title).toContain('Code Review');
  });

  it('keeps the map readable at 80% detail', () => {
    const cases = buildCases(softwareTeamDemo());
    const m = processMap(cases, 0.8);
    expect(m.nodes.length).toBeLessThanOrEqual(15);
    // Every kept node has a way in and a way out.
    for (const n of m.nodes) {
      expect(m.edges.some((e) => e.to === n.id)).toBe(true);
      expect(m.edges.some((e) => e.from === n.id)).toBe(true);
    }
    expect(processMap(cases, 1).hiddenEdges).toBe(0);
  });

  it('is deterministic', () => {
    expect(softwareTeamDemo()).toEqual(softwareTeamDemo());
  });
});
