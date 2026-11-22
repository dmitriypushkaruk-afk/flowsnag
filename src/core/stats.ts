import type { DurationStats } from './types';

/** Percentile with linear interpolation (same as numpy's default), p in [0, 100]. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (rank - lo);
}

export function durationStats(values: number[]): DurationStats {
  if (values.length === 0) return { count: 0, medianMs: 0, p90Ms: 0, meanMs: 0 };
  const sorted = [...values].sort((x, y) => x - y);
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    count: sorted.length,
    medianMs: percentile(sorted, 50),
    p90Ms: percentile(sorted, 90),
    meanMs: sum / sorted.length,
  };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Human-friendly duration: "45 min", "5.2 h", "3.4 days". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0';
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))} min`;
  if (ms < DAY) return `${round1(ms / HOUR)} h`;
  const days = ms / DAY;
  return `${days < 10 ? round1(days) : Math.round(days)} ${days === 1 ? 'day' : 'days'}`;
}

export function formatPercent(share: number): string {
  const p = share * 100;
  if (p > 0 && p < 1) return '<1%';
  return `${Math.round(p)}%`;
}

function round1(v: number): string {
  return (Math.round(v * 10) / 10).toString();
}
