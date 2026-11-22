/// <reference lib="webworker" />
import { analyze, buildCases } from './analyze';
import type { XrayEvent } from './types';

export interface AnalyzeRequest {
  id: number;
  events: XrayEvent[];
  detail: number;
  /** Only keep cases with this variant key. */
  variant?: string | null;
}

self.onmessage = (msg: MessageEvent<AnalyzeRequest>) => {
  const { id, events, detail, variant } = msg.data;
  try {
    let input = events;
    if (variant) {
      const keep = new Set(buildCases(events).filter((c) => c.variant === variant).map((c) => c.id));
      input = events.filter((e) => keep.has(e.caseId));
    }
    const { cases: _cases, ...result } = analyze(input, detail);
    void _cases;
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, result });
  } catch (e) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, error: String(e) });
  }
};
