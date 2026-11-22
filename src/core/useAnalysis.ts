import { useEffect, useRef, useState } from 'react';
import type { analyze } from './analyze';
import type { Filter } from './filters';
import type { XrayEvent } from './types';

export type AnalysisResult = Omit<ReturnType<typeof analyze>, 'cases'>;

/** Runs the analysis in a Web Worker so big logs never freeze the page. */
export function useAnalysis(events: XrayEvent[], detail: number, variant: string | null, filter: Filter) {
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  /** True when the filter leaves no cases; the last result stays on screen. */
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    return () => w.terminate();
  }, []);

  useEffect(() => {
    const w = worker.current;
    if (!w) return;
    const id = ++seq.current;
    setBusy(true);
    const onMessage = (m: MessageEvent<{ id: number; result?: AnalysisResult; error?: string; empty?: boolean }>) => {
      if (m.data.id !== seq.current) return;
      setBusy(false);
      setEmpty(!!m.data.empty);
      if (m.data.empty) return;
      if (m.data.error) setError(m.data.error);
      else {
        setError(null);
        setResult(m.data.result!);
      }
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, events, detail, variant, filter });
    return () => w.removeEventListener('message', onMessage);
  }, [events, detail, variant, filter]);

  return { result, error, busy, empty };
}
