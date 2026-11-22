import { useState } from 'react';
import { formatDuration, formatPercent } from '../core/stats';
import type { EventLog, Insight } from '../core/types';
import { useAnalysis } from '../core/useAnalysis';
import { ProcessMap, type Highlight } from './ProcessMap';

interface Props {
  log: EventLog;
  onBack: () => void;
}

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function AnalysisView({ log, onBack }: Props) {
  const [detail, setDetail] = useState(0.8);
  const [variant, setVariant] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const { result: a, error, busy } = useAnalysis(log.events, detail, variant);

  if (error) {
    return (
      <main className="analysis">
        <p className="error">The analysis failed: {error}</p>
        <button onClick={onBack}>Back</button>
      </main>
    );
  }
  if (!a) return <main className="analysis loading">Analyzing {log.events.length.toLocaleString('en')} events…</main>;

  const pick = (i: Insight) => setHighlight(i.target.node || i.target.edge ? i.target : null);
  const maxBin = Math.max(1, ...a.cycleHistogram.map((b) => b.count));

  return (
    <main className="analysis" aria-busy={busy}>
      <header className="analysis-head">
        <button className="link" onClick={onBack}>
          ← New analysis
        </button>
        <h1>{log.name}</h1>
        <dl className="kpis">
          <div>
            <dt>Cases</dt>
            <dd>{a.caseCount.toLocaleString('en')}</dd>
          </div>
          <div>
            <dt>Events</dt>
            <dd>{a.eventCount.toLocaleString('en')}</dd>
          </div>
          <div>
            <dt>Period</dt>
            <dd>
              {fmtDate(a.period.from)} – {fmtDate(a.period.to)}
            </dd>
          </div>
          <div>
            <dt>Cycle time</dt>
            <dd>
              median {formatDuration(a.cycle.medianMs)} · P90 {formatDuration(a.cycle.p90Ms)}
            </dd>
          </div>
        </dl>
      </header>

      <section className="insights" aria-label="Key findings">
        {a.insights.map((i, n) => (
          <button
            key={n}
            className={`insight insight-${i.kind}`}
            onMouseEnter={() => pick(i)}
            onFocus={() => pick(i)}
            onClick={() => pick(i)}
          >
            <strong>{i.title}</strong>
            <span>{i.detail}</span>
          </button>
        ))}
      </section>

      <section className="workspace">
        <div className="map-panel">
          <div className="map-toolbar">
            <label>
              Detail <strong>{Math.round(detail * 100)}%</strong>
              <input
                type="range"
                min={0.3}
                max={1}
                step={0.05}
                value={detail}
                onChange={(e) => setDetail(Number(e.target.value))}
                aria-label="Map detail"
              />
            </label>
            {(a.map.hiddenActivities > 0 || a.map.hiddenEdges > 0) && (
              <span className="hint">
                Hidden: {a.map.hiddenActivities} rare steps, {a.map.hiddenEdges} rare paths
              </span>
            )}
            {variant && (
              <button className="chip" onClick={() => setVariant(null)}>
                Showing one path ✕
              </button>
            )}
          </div>
          <div className="map-scroll">
            <ProcessMap map={a.map} highlight={highlight} onSelectNode={(id) => setHighlight({ node: id })} />
          </div>
          <p className="legend">
            Box colour: median time spent in the step (darker is longer). Arrow width: how many cases took that path.
            Label: number of cases · median time.
          </p>
        </div>

        <aside className="side">
          <section>
            <h2>Paths</h2>
            <ol className="variants">
              {a.variants.slice(0, 8).map((v) => (
                <li key={v.key}>
                  <button className={variant === v.key ? 'variant on' : 'variant'} onClick={() => setVariant(variant === v.key ? null : v.key)}>
                    <span className="share" style={{ ['--w' as string]: `${v.share * 100}%` }}>
                      {formatPercent(v.share)}
                    </span>
                    <span className="steps">{v.activities.join(' → ')}</span>
                    <span className="hint">
                      {v.caseCount} cases · median {formatDuration(v.medianCycleMs)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {a.variants.length > 8 && <p className="hint">and {a.variants.length - 8} rarer paths</p>}
          </section>

          <section>
            <h2>Returns</h2>
            {a.rework.length === 0 ? (
              <p className="hint">No case goes back to a step it already passed.</p>
            ) : (
              <ul className="rework">
                {a.rework.slice(0, 5).map((r) => (
                  <li key={r.from + r.to}>
                    <button className="link" onClick={() => setHighlight({ edge: [r.from, r.to] })}>
                      {r.from} → {r.to}
                    </button>
                    <span>{formatPercent(r.share)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>Cycle time</h2>
            <div className="histogram" role="img" aria-label="Cycle time distribution">
              {a.cycleHistogram.map((b, i) => (
                <div key={i} className="bar" style={{ height: `${(b.count / maxBin) * 100}%` }} title={`${formatDuration(b.fromMs)}–${formatDuration(b.toMs)}: ${b.count} cases`} />
              ))}
            </div>
            <div className="histogram-axis">
              <span>0</span>
              <span>{formatDuration(a.cycleHistogram[a.cycleHistogram.length - 1]?.fromMs ?? 0)}+</span>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
