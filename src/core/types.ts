/** One row of an xray-log: "case X reached activity Y at time T". */
export interface XrayEvent {
  caseId: string;
  activity: string;
  /** Unix epoch milliseconds. */
  timestamp: number;
  resource?: string;
  /** Any other columns, used for filters. */
  attrs?: Record<string, string>;
}

export interface EventLog {
  name: string;
  source: 'csv' | 'xes' | 'github' | 'jira' | 'demo';
  events: XrayEvent[];
}

export interface Case {
  id: string;
  events: XrayEvent[];
  /** Activities in order, joined into one key. */
  variant: string;
  start: number;
  end: number;
}

export interface DurationStats {
  count: number;
  medianMs: number;
  p90Ms: number;
  meanMs: number;
}

export interface MapNode {
  id: string;
  /** Number of times a case reached this activity. */
  count: number;
  /** Cases that touched this activity at least once. */
  caseCount: number;
  /** Time spent in this activity until the next one (only where a next event exists). */
  time: DurationStats | null;
  isStart: boolean;
  isEnd: boolean;
}

export interface MapEdge {
  from: string;
  to: string;
  count: number;
  time: DurationStats;
}

export interface Variant {
  key: string;
  activities: string[];
  caseCount: number;
  share: number;
  medianCycleMs: number;
}

export interface Rework {
  from: string;
  to: string;
  caseCount: number;
  share: number;
}

export interface Insight {
  kind: 'slowest-step' | 'rework' | 'skip' | 'variants';
  title: string;
  detail: string;
  /** Map element the insight points to. */
  target: { node?: string; edge?: [string, string] };
}

export interface Analysis {
  caseCount: number;
  eventCount: number;
  activityCount: number;
  period: { from: number; to: number };
  cycle: DurationStats;
  cycleHistogram: { fromMs: number; toMs: number; count: number }[];
  nodes: MapNode[];
  edges: MapEdge[];
  variants: Variant[];
  rework: Rework[];
  reworkCaseShare: number;
  insights: Insight[];
}

/** Virtual start/end nodes on the map. */
export const START = '▶ Start';
export const END = '■ End';
