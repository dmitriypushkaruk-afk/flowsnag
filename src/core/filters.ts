import type { XrayEvent } from './types';

/** Pseudo-attribute for the event's resource (person, team, system). */
export const RESOURCE = 'Resource';

export interface Filter {
  /** attribute → allowed values. An empty or missing list means "no filter". */
  attrs: Record<string, string[]>;
  /** Keep cases that started in [from, to] (epoch ms, inclusive). */
  from?: number;
  to?: number;
}

export const NO_FILTER: Filter = { attrs: {} };

export interface AttributeSummary {
  key: string;
  values: { value: string; caseCount: number }[];
}

const MAX_VALUES = 60;

/**
 * Case-level values of every attribute. A case has a value when any of its events carries it.
 * Attributes with a single value or too many values (IDs, free text) are left out.
 */
export function summarizeAttributes(events: XrayEvent[]): AttributeSummary[] {
  const perKey = new Map<string, Map<string, Set<string>>>();
  const add = (key: string, value: string, caseId: string) => {
    let values = perKey.get(key);
    if (!values) perKey.set(key, (values = new Map()));
    if (values.size > MAX_VALUES && !values.has(value)) return;
    let cases = values.get(value);
    if (!cases) values.set(value, (cases = new Set()));
    cases.add(caseId);
  };
  for (const e of events) {
    if (e.resource) add(RESOURCE, e.resource, e.caseId);
    if (e.attrs) for (const [k, v] of Object.entries(e.attrs)) if (v !== '') add(k, v, e.caseId);
  }
  const out: AttributeSummary[] = [];
  for (const [key, values] of perKey) {
    if (values.size < 2 || values.size > MAX_VALUES) continue;
    out.push({
      key,
      values: [...values.entries()]
        .map(([value, cases]) => ({ value, caseCount: cases.size }))
        .sort((a, b) => b.caseCount - a.caseCount || a.value.localeCompare(b.value)),
    });
  }
  return out.sort((a, b) => (a.key === RESOURCE ? 1 : b.key === RESOURCE ? -1 : a.key.localeCompare(b.key)));
}

export function isActive(f: Filter): boolean {
  return f.from !== undefined || f.to !== undefined || Object.values(f.attrs).some((v) => v.length > 0);
}

/** Keep whole cases that match every condition. Events of a kept case are never dropped. */
export function applyFilter(events: XrayEvent[], f: Filter): XrayEvent[] {
  if (!isActive(f)) return events;
  const conditions = Object.entries(f.attrs)
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => ({ key: k, allowed: new Set(v), hit: new Set<string>() }));
  const start = new Map<string, number>();
  for (const e of events) {
    const s = start.get(e.caseId);
    if (s === undefined || e.timestamp < s) start.set(e.caseId, e.timestamp);
    for (const c of conditions) {
      const v = c.key === RESOURCE ? e.resource : e.attrs?.[c.key];
      if (v !== undefined && c.allowed.has(v)) c.hit.add(e.caseId);
    }
  }
  const keep = new Set<string>();
  for (const [caseId, s] of start) {
    if (f.from !== undefined && s < f.from) continue;
    if (f.to !== undefined && s > f.to) continue;
    if (conditions.every((c) => c.hit.has(caseId))) keep.add(caseId);
  }
  return events.filter((e) => keep.has(e.caseId));
}

/**
 * Replace resource names with "Person 1…N", numbered by first appearance in time.
 * Applied by default (spec FR-13): the map is about the process, not about people.
 */
export function anonymizeResources(events: XrayEvent[]): XrayEvent[] {
  if (!events.some((e) => e.resource)) return events;
  const order = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const names = new Map<string, string>();
  for (const e of order) if (e.resource && !names.has(e.resource)) names.set(e.resource, `Person ${names.size + 1}`);
  return events.map((e) => (e.resource ? { ...e, resource: names.get(e.resource)! } : e));
}
