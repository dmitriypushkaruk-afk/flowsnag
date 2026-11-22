import Papa from 'papaparse';
import type { XrayEvent } from './types';

export interface RawTable {
  headers: string[];
  rows: string[][];
}

export type DateFormat = 'auto' | 'iso' | 'dmy' | 'mdy' | 'epoch-s' | 'epoch-ms';

export const DATE_FORMATS: { id: DateFormat; label: string }[] = [
  { id: 'auto', label: 'Detect automatically' },
  { id: 'iso', label: 'ISO 8601 (2026-03-02T09:14:00Z / 2026-03-02 09:14)' },
  { id: 'dmy', label: 'Day first (02.03.2026 09:14 / 02/03/2026)' },
  { id: 'mdy', label: 'Month first (03/02/2026 9:14 AM)' },
  { id: 'epoch-s', label: 'Unix seconds' },
  { id: 'epoch-ms', label: 'Unix milliseconds' },
];

export interface ColumnMapping {
  caseId: number;
  activity: number;
  timestamp: number;
  /** -1 when not mapped. */
  resource: number;
  dateFormat: DateFormat;
}

export interface RowError {
  /** 1-based line number in the file, counting the header as line 1. */
  line: number;
  message: string;
}

export interface MappedLog {
  events: XrayEvent[];
  errors: RowError[];
  /** Date format actually used (resolved when `auto`). */
  dateFormat: Exclude<DateFormat, 'auto'>;
}

export function parseCsv(text: string): RawTable {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ''), {
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', ';', '\t', '|'],
  });
  const [headers = [], ...rows] = res.data;
  return { headers: headers.map((h) => h.trim()), rows };
}

const CASE_HINTS = ['case_id', 'caseid', 'case', 'case:concept:name', 'issue', 'issue_key', 'key', 'ticket', 'id', 'pr', 'number'];
const ACTIVITY_HINTS = ['activity', 'concept:name', 'status', 'to_status', 'step', 'event', 'state', 'action', 'task'];
const TIME_HINTS = ['timestamp', 'time:timestamp', 'time', 'date', 'datetime', 'created', 'changed', 'start_time', 'end_time'];
const RESOURCE_HINTS = ['resource', 'org:resource', 'user', 'assignee', 'author', 'actor', 'performer', 'owner'];

function findColumn(headers: string[], hints: string[], taken: Set<number>): number {
  const norm = headers.map((h) => h.toLowerCase().replace(/[\s-]+/g, '_'));
  for (const hint of hints) {
    const i = norm.findIndex((h, idx) => !taken.has(idx) && h === hint);
    if (i >= 0) return i;
  }
  for (const hint of hints) {
    const i = norm.findIndex((h, idx) => !taken.has(idx) && h.includes(hint));
    if (i >= 0) return i;
  }
  return -1;
}

/** Guess which columns hold case, activity, time and resource. */
export function guessMapping(table: RawTable): ColumnMapping {
  const taken = new Set<number>();
  const pick = (hints: string[], fallback: number) => {
    let i = findColumn(table.headers, hints, taken);
    if (i < 0 && fallback >= 0 && fallback < table.headers.length && !taken.has(fallback)) i = fallback;
    if (i >= 0) taken.add(i);
    return i;
  };
  // Time first: its values are the easiest to recognise.
  let timestamp = findColumn(table.headers, TIME_HINTS, taken);
  if (timestamp < 0) {
    timestamp = table.headers.findIndex((_, i) => {
      const sample = table.rows.slice(0, 20).map((r) => r[i] ?? '');
      return sample.length > 0 && sample.every((v) => detectFormat([v]) !== null);
    });
  }
  if (timestamp >= 0) taken.add(timestamp);
  const caseId = pick(CASE_HINTS, 0);
  const activity = pick(ACTIVITY_HINTS, 1);
  const resource = findColumn(table.headers, RESOURCE_HINTS, taken);
  return { caseId, activity, timestamp, resource, dateFormat: 'auto' };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const SLASH_RE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i;

function parseIso(v: string): number {
  let s = v.trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z';
  // Without an offset we read the time as UTC, so results don't depend on the viewer's zone.
  else if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += 'Z';
  return Date.parse(s);
}

function parseSlash(v: string, dayFirst: boolean): number {
  const m = SLASH_RE.exec(v.trim());
  if (!m) return NaN;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const day = dayFirst ? a : b;
  const month = dayFirst ? b : a;
  if (day < 1 || day > 31 || month < 1 || month > 12) return NaN;
  let hour = Number(m[4] ?? 0);
  const ampm = m[7]?.toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  return Date.UTC(Number(m[3]), month - 1, day, hour, Number(m[5] ?? 0), Number(m[6] ?? 0));
}

export function parseTimestamp(v: string, format: Exclude<DateFormat, 'auto'>): number {
  const s = v.trim();
  if (!s) return NaN;
  switch (format) {
    case 'iso':
      return ISO_RE.test(s) ? parseIso(s) : NaN;
    case 'dmy':
      return parseSlash(s, true);
    case 'mdy':
      return parseSlash(s, false);
    case 'epoch-s':
      return /^\d+(\.\d+)?$/.test(s) ? Number(s) * 1000 : NaN;
    case 'epoch-ms':
      return /^\d+$/.test(s) ? Number(s) : NaN;
  }
}

/**
 * Pick the date format that reads the most samples (a few broken rows must not block detection).
 * On a tie we prefer ISO, then day-first (EU), then month-first.
 */
export function detectFormat(samples: string[]): Exclude<DateFormat, 'auto'> | null {
  const values = samples.map((s) => s.trim()).filter(Boolean);
  if (values.length === 0) return null;
  const order: Exclude<DateFormat, 'auto'>[] = ['iso', 'dmy', 'mdy', 'epoch-ms', 'epoch-s'];
  const looksEpoch: Record<string, RegExp> = { 'epoch-ms': /^\d{12,13}$/, 'epoch-s': /^\d{9,10}(\.\d+)?$/ };
  let best: Exclude<DateFormat, 'auto'> | null = null;
  let bestHits = 0;
  for (const f of order) {
    const re = looksEpoch[f];
    const hits = values.filter((v) => (re ? re.test(v) : !Number.isNaN(parseTimestamp(v, f)))).length;
    if (hits > bestHits) {
      best = f;
      bestHits = hits;
    }
  }
  return bestHits >= Math.ceil(values.length / 2) ? best : null;
}

/** Turn a raw table into events. Bad rows are reported, not fatal. */
export function mapTable(table: RawTable, m: ColumnMapping): MappedLog {
  const errors: RowError[] = [];
  const sample = table.rows.slice(0, 200).map((r) => r[m.timestamp] ?? '');
  const dateFormat = m.dateFormat === 'auto' ? (detectFormat(sample) ?? 'iso') : m.dateFormat;
  const attrCols = table.headers
    .map((h, i) => ({ h, i }))
    .filter(({ i }) => i !== m.caseId && i !== m.activity && i !== m.timestamp && i !== m.resource);

  const events: XrayEvent[] = [];
  table.rows.forEach((row, idx) => {
    const line = idx + 2;
    const caseId = (row[m.caseId] ?? '').trim();
    const activity = (row[m.activity] ?? '').trim();
    const rawTime = row[m.timestamp] ?? '';
    if (!caseId) return void errors.push({ line, message: 'Case ID is empty' });
    if (!activity) return void errors.push({ line, message: 'Activity is empty' });
    const timestamp = parseTimestamp(rawTime, dateFormat);
    if (Number.isNaN(timestamp)) return void errors.push({ line, message: `Cannot read date “${rawTime}”` });
    const e: XrayEvent = { caseId, activity, timestamp };
    if (m.resource >= 0 && row[m.resource]) e.resource = row[m.resource]!.trim();
    if (attrCols.length) {
      const attrs: Record<string, string> = {};
      for (const { h, i } of attrCols) if (row[i]) attrs[h] = row[i]!;
      e.attrs = attrs;
    }
    events.push(e);
  });
  return { events, errors, dateFormat };
}

/** Serialise events back to the xray-log CSV format. */
export function toXrayCsv(events: XrayEvent[]): string {
  const attrKeys = [...new Set(events.flatMap((e) => Object.keys(e.attrs ?? {})))];
  const rows = events.map((e) => [
    e.caseId,
    e.activity,
    new Date(e.timestamp).toISOString(),
    e.resource ?? '',
    ...attrKeys.map((k) => e.attrs?.[k] ?? ''),
  ]);
  return Papa.unparse({ fields: ['case_id', 'activity', 'timestamp', 'resource', ...attrKeys], data: rows });
}
