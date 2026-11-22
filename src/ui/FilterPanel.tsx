import { type AttributeSummary, type Filter, isActive, RESOURCE } from '../core/filters';

interface Props {
  summary: AttributeSummary[];
  /** Full period of the log, epoch ms. */
  period: { from: number; to: number };
  filter: Filter;
  onChange: (f: Filter) => void;
  showNames: boolean;
  onShowNames: (v: boolean) => void;
  hasResources: boolean;
}

const DAY = 86_400_000;
const toInput = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fromInput = (s: string) => (s ? Date.parse(`${s}T00:00:00Z`) : undefined);

export function FilterPanel({ summary, period, filter, onChange, showNames, onShowNames, hasResources }: Props) {
  const toggle = (key: string, value: string) => {
    const current = filter.attrs[key] ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    onChange({ ...filter, attrs: { ...filter.attrs, [key]: next } });
  };

  return (
    <section className="filters" aria-label="Filters">
      <div className="filters-head">
        <h2>Filters</h2>
        {isActive(filter) && (
          <button className="link" onClick={() => onChange({ attrs: {} })}>
            Clear all
          </button>
        )}
      </div>

      <fieldset className="period">
        <legend>Cases started</legend>
        <label>
          from
          <input
            type="date"
            min={toInput(period.from)}
            max={toInput(period.to)}
            value={filter.from !== undefined ? toInput(filter.from) : ''}
            onChange={(e) => onChange({ ...filter, from: fromInput(e.target.value) })}
          />
        </label>
        <label>
          to
          <input
            type="date"
            min={toInput(period.from)}
            max={toInput(period.to)}
            value={filter.to !== undefined ? toInput(filter.to) : ''}
            onChange={(e) => {
              const d = fromInput(e.target.value);
              onChange({ ...filter, to: d === undefined ? undefined : d + DAY - 1 });
            }}
          />
        </label>
      </fieldset>

      {summary.map((a) => {
        const selected = filter.attrs[a.key] ?? [];
        return (
          <details key={a.key} open={selected.length > 0}>
            <summary>
              {a.key === RESOURCE ? 'Resource' : a.key}
              {selected.length > 0 && <span className="count">{selected.length}</span>}
            </summary>
            <ul>
              {a.values.slice(0, 30).map((v) => (
                <li key={v.value}>
                  <label>
                    <input type="checkbox" checked={selected.includes(v.value)} onChange={() => toggle(a.key, v.value)} />
                    <span className="value">{v.value}</span>
                    <span className="hint">{v.caseCount}</span>
                  </label>
                </li>
              ))}
            </ul>
          </details>
        );
      })}

      {summary.length === 0 && <p className="hint">This log has no extra columns to filter by.</p>}

      {hasResources && (
        <label className="names">
          <input type="checkbox" checked={showNames} onChange={(e) => onShowNames(e.target.checked)} />
          Show real resource names
          <span className="hint">Off by default: FlowSnag looks at the process, not at people.</span>
        </label>
      )}
    </section>
  );
}
