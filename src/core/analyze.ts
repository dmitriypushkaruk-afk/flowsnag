import { durationStats, formatDuration, formatPercent, percentile } from './stats';
import {
  END,
  START,
  type Analysis,
  type Case,
  type Insight,
  type MapEdge,
  type MapNode,
  type Rework,
  type Variant,
  type XrayEvent,
} from './types';

const SEP = '\u001f';

/** Group events into cases, each sorted by time (stable for equal timestamps). */
export function buildCases(events: XrayEvent[]): Case[] {
  const byCase = new Map<string, XrayEvent[]>();
  for (const e of events) {
    let list = byCase.get(e.caseId);
    if (!list) byCase.set(e.caseId, (list = []));
    list.push(e);
  }
  const cases: Case[] = [];
  for (const [id, list] of byCase) {
    const sorted = list
      .map((e, i) => ({ e, i }))
      .sort((a, b) => a.e.timestamp - b.e.timestamp || a.i - b.i)
      .map((x) => x.e);
    cases.push({
      id,
      events: sorted,
      variant: sorted.map((e) => e.activity).join(SEP),
      start: sorted[0]!.timestamp,
      end: sorted[sorted.length - 1]!.timestamp,
    });
  }
  return cases;
}

interface Dfg {
  nodes: Map<string, MapNode>;
  edges: Map<string, MapEdge>;
}

function edgeKey(from: string, to: string) {
  return from + SEP + to;
}

/** Directly-follows graph with virtual start/end nodes and time statistics. */
function buildDfg(cases: Case[]): Dfg {
  const nodeCount = new Map<string, number>();
  const nodeCases = new Map<string, number>();
  const nodeTimes = new Map<string, number[]>();
  const edgeTimes = new Map<string, { from: string; to: string; times: number[] }>();
  const firsts = new Set<string>();
  const lasts = new Set<string>();

  const addEdge = (from: string, to: string, ms: number) => {
    const k = edgeKey(from, to);
    let e = edgeTimes.get(k);
    if (!e) edgeTimes.set(k, (e = { from, to, times: [] }));
    e.times.push(ms);
  };

  for (const c of cases) {
    const ev = c.events;
    if (ev.length === 0) continue;
    const seen = new Set<string>();
    for (let i = 0; i < ev.length; i++) {
      const a = ev[i]!.activity;
      nodeCount.set(a, (nodeCount.get(a) ?? 0) + 1);
      if (!seen.has(a)) {
        seen.add(a);
        nodeCases.set(a, (nodeCases.get(a) ?? 0) + 1);
      }
      const next = ev[i + 1];
      if (next) {
        const ms = next.timestamp - ev[i]!.timestamp;
        let t = nodeTimes.get(a);
        if (!t) nodeTimes.set(a, (t = []));
        t.push(ms);
        addEdge(a, next.activity, ms);
      }
    }
    firsts.add(ev[0]!.activity);
    lasts.add(ev[ev.length - 1]!.activity);
    addEdge(START, ev[0]!.activity, 0);
    addEdge(ev[ev.length - 1]!.activity, END, 0);
  }

  const nodes = new Map<string, MapNode>();
  for (const [id, count] of nodeCount) {
    const times = nodeTimes.get(id);
    nodes.set(id, {
      id,
      count,
      caseCount: nodeCases.get(id) ?? 0,
      time: times && times.length ? durationStats(times) : null,
      isStart: firsts.has(id),
      isEnd: lasts.has(id),
    });
  }
  const edges = new Map<string, MapEdge>();
  for (const [k, e] of edgeTimes) {
    edges.set(k, { from: e.from, to: e.to, count: e.times.length, time: durationStats(e.times) });
  }
  return { nodes, edges };
}

export interface ProcessMap {
  nodes: MapNode[];
  edges: MapEdge[];
  hiddenActivities: number;
  hiddenEdges: number;
}

/**
 * Simplified map for a detail level in (0, 1].
 * 1. Keep the activities reached by at least (1 - detail) / 2 of the cases.
 * 2. Project cases onto them and rebuild the graph.
 * 3. Keep the paths taken at least that often too, plus the strongest
 *    incoming and outgoing edge of every node so the map stays connected.
 */
export function processMap(cases: Case[], detail: number): ProcessMap {
  const full = buildDfg(cases);
  const all = [...full.nodes.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  // A step stays if enough cases reach it: at 80% detail that is 10% of cases, at 100% every step.
  const minCases = ((1 - detail) / 2) * cases.length;
  const keep = new Set(all.filter((n, i) => i < 2 || n.caseCount >= minCases).map((n) => n.id));

  const projected =
    keep.size === all.length
      ? cases
      : cases
          .map((c) => ({ ...c, events: c.events.filter((e) => keep.has(e.activity)) }))
          .filter((c) => c.events.length > 0);
  const dfg = projected === cases ? full : buildDfg(projected);

  const edges = [...dfg.edges.values()].sort((a, b) => b.count - a.count);
  const keepEdges = new Set(edges.filter((e) => e.count >= minCases).map((e) => edgeKey(e.from, e.to)));
  // Connectivity: strongest out- and in-edge per node (edges are sorted by count).
  const hasOut = new Set<string>();
  const hasIn = new Set<string>();
  for (const e of edges) {
    if (!hasOut.has(e.from)) {
      hasOut.add(e.from);
      keepEdges.add(edgeKey(e.from, e.to));
    }
    if (!hasIn.has(e.to)) {
      hasIn.add(e.to);
      keepEdges.add(edgeKey(e.from, e.to));
    }
  }
  const keptEdges = edges.filter((e) => keepEdges.has(edgeKey(e.from, e.to)));
  return {
    nodes: [...dfg.nodes.values()],
    edges: keptEdges,
    hiddenActivities: all.length - keep.size,
    hiddenEdges: edges.length - keptEdges.length,
  };
}

export function variants(cases: Case[]): Variant[] {
  const groups = new Map<string, Case[]>();
  for (const c of cases) {
    let g = groups.get(c.variant);
    if (!g) groups.set(c.variant, (g = []));
    g.push(c);
  }
  return [...groups.entries()]
    .map(([key, cs]) => ({
      key,
      activities: cs[0]!.events.map((e) => e.activity),
      caseCount: cs.length,
      share: cs.length / cases.length,
      medianCycleMs: percentile(
        cs.map((c) => c.end - c.start).sort((a, b) => a - b),
        50,
      ),
    }))
    .sort((a, b) => b.caseCount - a.caseCount || a.activities.length - b.activities.length);
}

/** A return: the case goes back to a step that, in this case, came before the current one. */
export function rework(cases: Case[]): { pairs: Rework[]; caseShare: number } {
  const pairCases = new Map<string, { from: string; to: string; cases: Set<string> }>();
  let withRework = 0;
  for (const c of cases) {
    // Position of each activity's first visit: going to an earlier-first-visited step is a return.
    const first = new Map<string, number>();
    let any = false;
    for (let i = 0; i < c.events.length; i++) {
      const a = c.events[i]!.activity;
      const prev = c.events[i - 1]?.activity;
      if (prev !== undefined && prev !== a && first.has(a) && first.get(a)! < first.get(prev)!) {
        any = true;
        const k = edgeKey(prev, a);
        let p = pairCases.get(k);
        if (!p) pairCases.set(k, (p = { from: prev, to: a, cases: new Set() }));
        p.cases.add(c.id);
      }
      if (!first.has(a)) first.set(a, i);
    }
    if (any) withRework++;
  }
  const pairs = [...pairCases.values()]
    .map((p) => ({ from: p.from, to: p.to, caseCount: p.cases.size, share: p.cases.size / cases.length }))
    .sort((a, b) => b.caseCount - a.caseCount);
  return { pairs, caseShare: cases.length ? withRework / cases.length : 0 };
}

function histogram(values: number[], bins = 12) {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const top = Math.max(percentile(sorted, 95), 1);
  const width = top / bins;
  const out = Array.from({ length: bins }, (_, i) => ({
    fromMs: i * width,
    toMs: i === bins - 1 ? sorted[sorted.length - 1]! : (i + 1) * width,
    count: 0,
  }));
  for (const v of sorted) out[Math.min(bins - 1, Math.floor(v / width))]!.count++;
  return out;
}

function insights(cases: Case[], nodes: MapNode[], rw: Rework[], reworkShare: number, vs: Variant[]): Insight[] {
  const out: Insight[] = [];
  const n = cases.length;

  // 1. Where time goes: the activity with the most total waiting time.
  const timed = nodes.filter((x) => x.time && x.time.count > 0);
  const totalWait = timed.reduce((s, x) => s + x.time!.meanMs * x.time!.count, 0);
  const slowest = [...timed].sort((a, b) => b.time!.meanMs * b.time!.count - a.time!.meanMs * a.time!.count)[0];
  if (slowest && totalWait > 0) {
    const share = (slowest.time!.meanMs * slowest.time!.count) / totalWait;
    out.push({
      kind: 'slowest-step',
      title: `Most time is spent in “${slowest.id}”`,
      detail: `${formatPercent(share)} of all waiting time · median ${formatDuration(slowest.time!.medianMs)}, P90 ${formatDuration(slowest.time!.p90Ms)}`,
      target: { node: slowest.id },
    });
  }

  // 2. Rework: the most common return.
  const top = rw[0];
  if (top) {
    out.push({
      kind: 'rework',
      title: `${formatPercent(top.share)} of cases go back from “${top.from}” to “${top.to}”`,
      detail: `${top.caseCount} of ${n} cases. In total ${formatPercent(reworkShare)} of cases have at least one return.`,
      target: { edge: [top.from, top.to] },
    });
  }

  // 3. Skips: the most bypassed of the steps that most cases pass through.
  const firstActs = new Map<string, number>();
  const lastActs = new Map<string, number>();
  for (const c of cases) {
    const f = c.events[0]!.activity;
    const l = c.events[c.events.length - 1]!.activity;
    firstActs.set(f, (firstActs.get(f) ?? 0) + 1);
    lastActs.set(l, (lastActs.get(l) ?? 0) + 1);
  }
  const skipCandidate = nodes
    .filter((x) => (firstActs.get(x.id) ?? 0) < n * 0.5 && (lastActs.get(x.id) ?? 0) < n * 0.5)
    .map((x) => ({ x, presence: x.caseCount / n }))
    .filter((c) => c.presence >= 0.5 && c.presence <= 0.97)
    .sort((a, b) => a.presence - b.presence)[0];
  if (skipCandidate) {
    out.push({
      kind: 'skip',
      title: `${formatPercent(1 - skipCandidate.presence)} of cases skip “${skipCandidate.x.id}”`,
      detail: `${n - skipCandidate.x.caseCount} of ${n} cases never pass through this step.`,
      target: { node: skipCandidate.x.id },
    });
  }

  // Fallback: how standard the process is.
  if (out.length < 3 && vs.length > 0) {
    const top5 = vs.slice(0, 5).reduce((s, v) => s + v.share, 0);
    out.push({
      kind: 'variants',
      title: `The top ${Math.min(5, vs.length)} paths cover ${formatPercent(top5)} of cases`,
      detail: `${vs.length} different paths in total. The most common one is taken by ${formatPercent(vs[0]!.share)} of cases.`,
      target: {},
    });
  }
  return out.slice(0, 3);
}

export function analyze(events: XrayEvent[], detail = 0.8): Analysis & { map: ProcessMap; cases: Case[] } {
  const cases = buildCases(events);
  const map = processMap(cases, detail);
  const full = buildDfg(cases);
  const vs = variants(cases);
  const rw = rework(cases);
  const cycles = cases.map((c) => c.end - c.start);
  const nodes = [...full.nodes.values()];
  let from = Infinity;
  let to = -Infinity;
  for (const c of cases) {
    if (c.start < from) from = c.start;
    if (c.end > to) to = c.end;
  }
  return {
    caseCount: cases.length,
    eventCount: events.length,
    activityCount: nodes.length,
    period: { from, to },
    cycle: durationStats(cycles),
    cycleHistogram: histogram(cycles),
    nodes,
    edges: [...full.edges.values()],
    variants: vs,
    rework: rw.pairs,
    reworkCaseShare: rw.caseShare,
    insights: insights(cases, nodes, rw.pairs, rw.caseShare, vs),
    map,
    cases,
  };
}
