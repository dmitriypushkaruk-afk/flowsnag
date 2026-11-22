import type { XrayEvent } from './types';

/**
 * Minimal XES (IEEE 1849) reader. No DOM needed, so it runs in a Web Worker and in Node.
 * Reads traces with their events: concept:name, time:timestamp, org:resource,
 * lifecycle:transition, and simple trace attributes (used as filters).
 */

export interface XesResult {
  events: XrayEvent[];
  skipped: number;
  traces: number;
}

const TAG = /<(\/?)(trace|event|string|date|int|float|boolean|id|list|container|values)\b([^>]*?)(\/?)>/g;
const ATTR = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

function unescape(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
    switch (e.toLowerCase()) {
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'amp':
        return '&';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
    }
    return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(ATTR)) out[m[1]!] = unescape(m[3] ?? m[4] ?? '');
  return out;
}

export function looksLikeXes(text: string): boolean {
  return /<log[\s>]/.test(text.slice(0, 4000)) && /xes|<trace/i.test(text.slice(0, 20000));
}

export function parseXes(text: string): XesResult {
  interface RawEvent {
    name?: string;
    time?: string;
    resource?: string;
    lifecycle?: string;
  }
  const events: XrayEvent[] = [];
  let skipped = 0;
  let traces = 0;
  let inTrace = false;
  let traceId = '';
  let traceAttrs: Record<string, string> = {};
  let traceEvents: RawEvent[] = [];
  let current: RawEvent | null = null;
  /** Depth inside nested attribute containers (lists), whose children we ignore. */
  let nested = 0;
  const lifecycles = new Set<string>();
  const pending: { caseId: string; attrs: Record<string, string>; events: RawEvent[] }[] = [];

  for (const m of text.matchAll(TAG)) {
    const [, close, tag, rawAttrs = '', selfClose] = m;
    if (tag === 'trace') {
      if (!close) {
        inTrace = true;
        traces++;
        traceId = '';
        traceAttrs = {};
        traceEvents = [];
      } else {
        pending.push({ caseId: traceId || `trace ${traces}`, attrs: traceAttrs, events: traceEvents });
        inTrace = false;
      }
      continue;
    }
    if (tag === 'event') {
      if (!inTrace) continue;
      if (!close) current = {};
      else if (current) {
        traceEvents.push(current);
        current = null;
      }
      continue;
    }
    // Attribute element.
    if (close) {
      if (nested > 0) nested--;
      continue;
    }
    const a = attrs(rawAttrs);
    const isContainer = !selfClose;
    if (nested > 0) {
      if (isContainer) nested++;
      continue;
    }
    if (isContainer) nested++;
    const key = a.key;
    const value = a.value ?? '';
    if (!key || !inTrace) continue;
    if (current) {
      if (key === 'concept:name') current.name = value;
      else if (key === 'time:timestamp') current.time = value;
      else if (key === 'org:resource') current.resource = value;
      else if (key === 'lifecycle:transition') {
        current.lifecycle = value.toLowerCase();
        lifecycles.add(current.lifecycle);
      }
    } else if (key === 'concept:name') {
      traceId = value;
    } else if (value !== '' && value.length <= 80) {
      traceAttrs[key] = value;
    }
  }

  // With start/complete pairs, keep the moment a step completes (the usual choice for maps).
  const onlyComplete = lifecycles.has('complete') && lifecycles.size > 1;
  for (const t of pending) {
    for (const e of t.events) {
      if (onlyComplete && e.lifecycle !== 'complete') continue;
      const ts = e.time ? Date.parse(e.time) : NaN;
      if (!e.name || Number.isNaN(ts)) {
        skipped++;
        continue;
      }
      const ev: XrayEvent = { caseId: t.caseId, activity: e.name, timestamp: ts };
      if (e.resource) ev.resource = e.resource;
      if (Object.keys(t.attrs).length) ev.attrs = t.attrs;
      events.push(ev);
    }
  }
  return { events, skipped, traces };
}
