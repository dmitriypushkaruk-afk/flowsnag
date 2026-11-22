/// <reference lib="webworker" />
import { analyze, buildCases } from './analyze';
import { applyFilter, type Filter } from './filters';
import type { XrayEvent } from './types';

export interface AnalyzeRequest {
  id: number;
  events: XrayEvent[];
  detail: number;
  /** Only keep cases with this variant key. */
  variant?: string | null;
  filter?: Filter;
}

self.onmessage = (msg: MessageEvent<AnalyzeRequest>) => {
  const { id, events, detail, variant, filter } = msg.data;
  try {
    let input = filter ? applyFilter(events, filter) : events;
    if (input.length === 0) {
      (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, empty: true });
      return;
    }
    if (variant) {
      const keep = new Set(buildCases(input).filter((c) => c.variant === variant).map((c) => c.id));
      input = input.filter((e) => keep.has(e.caseId));
    }
    const { cases: _cases, ...result } = analyze(input, detail);
    void _cases;
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, result });
  } catch (e) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, error: String(e) });
  }
};
