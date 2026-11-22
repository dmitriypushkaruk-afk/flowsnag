import { useMemo, useRef, useState } from 'react';
import { anonymizeResources, isActive, NO_FILTER, summarizeAttributes, type Filter } from '../core/filters';
import { formatDuration, formatPercent } from '../core/stats';
import type { EventLog, Insight } from '../core/types';
import { useAnalysis } from '../core/useAnalysis';
import { exportPng, exportSvg } from './exportMap';
import { FilterPanel } from './FilterPanel';
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
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [showNames, setShowNames] = useState(false);
  const mapRef = useRef<SVGSVGElement>(null);

  const hasResources = useMemo(() => log.events.some((e) => e.resource), [log.events]);
  // Anonymised by default (FR-13). Switching resets resource filters, whose values change.
  const events = useMemo(() => (showNames ? log.events : anonymizeResources(log.events)), [log.events, showNames]);
  const summary = useMemo(() => summarizeAttributes(events), [events]);
  const fullPeriod = useMemo(() => {
    let from = Infinity;
    let to = -Infinity;
    for (const e of log.events) {
      if (e.timestamp < from) from = e.timestamp;
      if (e.timestamp > to) to = e.timestamp;
    }
    return { from, to };
  }, [log.events]);
  const totalCases = useMemo(() => new Set(log.events.map((e) => e.caseId)).size, [log.events]);
  const { result: a, error, busy, empty } = useAnalysis(events, detail, variant, filter);

  if (error) {
    return (
      <main className="analysis">
        <p className="error">The analysis failed: {error}</p>
        <button onClick={onBack}>Back</button>
      </main>
    );
  }
  if (!a) return <main className="analysis loading">Analyzing {log.events.length.toLocaleString('en')} events…</main>;

  const changeFilter = (f: Filter) => {
    setVariant(null);
    setHighlight(null);
    setFilter(f);
  };
  const exportInfo = () => ({
    title: log.name,
    subtitle: `${a.caseCount.toLocaleString('en')} cases · ${fmtDate(a.period.from)} – ${fmtDate(a.period.to)} · median cycle ${formatDuration(a.cycle.medianMs)}${
      isActive(filter) ? ' · filtered' : ''
    }`,
  });
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
            <dd>
              {a.caseCount.toLocaleString('en')}
              {a.caseCount !== totalCases && <span className="hint"> of {totalCases.toLocaleString('en')}</span>}
            </dd>
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
            <span className="spacer" />
            <button onClick={() => mapRef.current && exportSvg(mapRef.current, exportInfo())}>SVG</button>
            <button onClick={() => mapRef.current && void exportPng(mapRef.current, exportInfo())}>PNG</button>
          </div>
          {empty && (
            <p className="error" role="status">
              No cases match these filters. The map still shows the previous result.
            </p>
          )}
          <div className="map-scroll">
            <ProcessMap ref={mapRef} map={a.map} highlight={highlight} onSelectNode={(id) => setHighlight({ node: id })} />
          </div>
          <p className="legend">
            Box colour: median time spent in the step (darker is longer). Arrow width: how many cases took that path.
            Label: number of cases · median time.
          </p>
        </div>

        <aside className="side">
          <FilterPanel
            summary={summary}
            period={fullPeriod}
            filter={filter}
            onChange={changeFilter}
            showNames={showNames}
            onShowNames={(v) => {
              setShowNames(v);
              const { Resource: _drop, ...rest } = filter.attrs;
              void _drop;
              changeFilter({ ...filter, attrs: rest });
            }}
            hasResources={hasResources}
          />
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
