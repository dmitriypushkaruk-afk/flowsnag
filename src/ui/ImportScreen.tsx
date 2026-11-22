import { useRef, useState } from 'react';
import { GithubError, githubLog } from '../connectors/github';
import { looksLikeXes, parseXes } from '../core/xes';
import { DATE_FORMATS, guessMapping, mapTable, parseCsv, type ColumnMapping, type RawTable } from '../core/csv';
import type { EventLog } from '../core/types';
import { softwareTeamDemo } from '../demo/synthetic';

interface Props {
  onLoad: (log: EventLog) => void;
}

export function ImportScreen({ onLoad }: Props) {
  const [table, setTable] = useState<{ name: string; table: RawTable } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const readText = (name: string, text: string) => {
    if (looksLikeXes(text)) {
      const r = parseXes(text);
      if (r.events.length === 0) {
        setCsvError(`“${name}” looks like XES but has no events with a name and a timestamp.`);
        return;
      }
      onLoad({ name, source: 'xes', events: r.events });
      return;
    }
    const t = parseCsv(text);
    if (t.headers.length < 3 || t.rows.length === 0) {
      setCsvError(`“${name}” needs a header row and at least three columns: case, activity and time.`);
      return;
    }
    setCsvError(null);
    setTable({ name, table: t });
  };

  const readFile = async (file: File) => {
    try {
      const text = file.name.toLowerCase().endsWith('.gz')
        ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
        : await file.text();
      readText(file.name.replace(/\.gz$/i, ''), text);
    } catch {
      setCsvError(`Could not read “${file.name}”.`);
    }
  };

  if (table) {
    return (
      <MappingStep
        name={table.name}
        table={table.table}
        onCancel={() => setTable(null)}
        onDone={(events) => onLoad({ name: table.name, source: 'csv', events })}
      />
    );
  }

  return (
    <main className="import">
      <section className="hero">
        <h1>See how your process really flows</h1>
        <p className="lead">
          Drop an event log, connect a GitHub repository or open a demo. FlowSnag draws the real process map, shows where
          work waits and where it goes back. <strong>Your data never leaves this browser.</strong>
        </p>
      </section>

      <section className="cards">
        <article className="card">
          <h2>Try a demo</h2>
          <p>A software team’s board: 400 issues over six months. Synthetic data, made to look real.</p>
          <button className="primary" onClick={() => onLoad({ name: 'Demo: software team board', source: 'demo', events: softwareTeamDemo() })}>
            Open demo
          </button>
        </article>

        <article
          className={dragging ? 'card drop dragging' : 'card drop'}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) void readFile(f);
          }}
        >
          <h2>Your own data</h2>
          <p>
            CSV with one row per step: <code>case_id, activity, timestamp</code>; extra columns become filters. XES
            event logs (also <code>.xes.gz</code>) work too. You can paste from Excel.
          </p>
          <div className="row">
            <button onClick={() => fileInput.current?.click()}>Choose file</button>
            <button
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (text.trim()) readText('Pasted data', text);
                } catch {
                  setCsvError('The browser did not allow reading the clipboard. Press Ctrl+V / ⌘V on this page instead.');
                }
              }}
            >
              Paste
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.txt,.xes,.gz,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFile(f);
            }}
          />
          <PasteListener onPaste={(text) => readText('Pasted data', text)} />
          {csvError && (
            <p className="error" role="alert">
              {csvError}
            </p>
          )}
        </article>

        <GithubCard onLoad={onLoad} />
      </section>
    </main>
  );
}

function PasteListener({ onPaste }: { onPaste: (text: string) => void }) {
  return (
    <textarea
      className="paste-target"
      aria-label="Paste data here"
      placeholder="…or paste a table here"
      onPaste={(e) => {
        const text = e.clipboardData.getData('text');
        if (text.trim()) {
          e.preventDefault();
          onPaste(text);
        }
      }}
    />
  );
}

function GithubCard({ onLoad }: Props) {
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Each run gets its own controller; a new run cancels the old one, and updates from a
  // cancelled or finished run are ignored, so the button can never stay stuck.
  const current = useRef<AbortController | null>(null);

  const run = async () => {
    current.current?.abort();
    const ctl = new AbortController();
    current.current = ctl;
    const live = () => current.current === ctl && !ctl.signal.aborted;
    setError(null);
    setProgress('Connecting to GitHub…');
    try {
      const events = await githubLog(repo, {
        token: token.trim() || undefined,
        signal: ctl.signal,
        onProgress: (done, total) => {
          if (live()) setProgress(`Reading pull requests… ${done}/${total}`);
        },
      });
      if (!live()) return;
      if (events.length === 0) throw new GithubError('This repository has no pull requests yet.', 'input');
      onLoad({ name: `GitHub: ${repo.trim()} pull requests`, source: 'github', events });
    } catch (e) {
      if (!live()) return;
      if (e instanceof GithubError && e.kind === 'rate-limit') setShowToken(true);
      setError(e instanceof GithubError ? e.message : 'Something went wrong while reading GitHub.');
    } finally {
      if (current.current === ctl) {
        current.current = null;
        setProgress(null);
      }
    }
  };

  return (
    <article className="card">
      <h2>GitHub pull requests</h2>
      <p>See how PRs in any public repository move from opened to merged.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo, e.g. vitejs/vite" aria-label="Repository" required />
        {showToken ? (
          <input
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setError(null);
            }}
            type="password"
            placeholder="Read-only token (optional)"
            aria-label="GitHub token"
            autoComplete="off"
          />
        ) : (
          <button type="button" className="link" onClick={() => setShowToken(true)}>
            Add a token for up to 500 PRs
          </button>
        )}
        <button className="primary" type="submit" disabled={!!progress}>
          {progress ?? 'Analyze'}
        </button>
      </form>
      <p className="hint">
        Without a token GitHub allows 60 requests per hour, enough for about 50 recent PRs. A token stays in this tab and
        goes only to api.github.com.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}

function MappingStep({
  name,
  table,
  onCancel,
  onDone,
}: {
  name: string;
  table: RawTable;
  onCancel: () => void;
  onDone: (events: ReturnType<typeof mapTable>['events']) => void;
}) {
  const [m, setM] = useState<ColumnMapping>(() => guessMapping(table));
  const ready = m.caseId >= 0 && m.activity >= 0 && m.timestamp >= 0 && new Set([m.caseId, m.activity, m.timestamp]).size === 3;
  const result = ready ? mapTable(table, m) : null;
  const set = (k: keyof ColumnMapping) => (e: React.ChangeEvent<HTMLSelectElement>) =>
    setM({ ...m, [k]: k === 'dateFormat' ? e.target.value : Number(e.target.value) });

  const column = (label: string, k: 'caseId' | 'activity' | 'timestamp' | 'resource', optional = false) => (
    <label>
      {label}
      <select value={m[k]} onChange={set(k)}>
        {optional && <option value={-1}>(none)</option>}
        {!optional && m[k] < 0 && <option value={-1}>Choose a column</option>}
        {table.headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <main className="mapping">
      <h1>Which column is which?</h1>
      <p className="lead">
        {name}: {table.rows.length.toLocaleString('en')} rows. We guessed the columns; check them before you continue.
      </p>
      <div className="mapping-grid">
        {column('Case ID', 'caseId')}
        {column('Activity / status', 'activity')}
        {column('Timestamp', 'timestamp')}
        {column('Resource (optional)', 'resource', true)}
        <label>
          Date format
          <select value={m.dateFormat} onChange={set('dateFormat')}>
            {DATE_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="preview">
        <table>
          <thead>
            <tr>
              {table.headers.map((h, i) => (
                <th key={i} className={[m.caseId, m.activity, m.timestamp].includes(i) ? 'mapped' : ''}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.slice(0, 5).map((r, i) => (
              <tr key={i}>
                {table.headers.map((_, j) => (
                  <td key={j}>{r[j]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result && result.errors.length > 0 && (
        <div className="error" role="alert">
          <strong>
            {result.errors.length.toLocaleString('en')} {result.errors.length === 1 ? 'row' : 'rows'} will be skipped.
          </strong>
          <ul>
            {result.errors.slice(0, 5).map((e) => (
              <li key={e.line}>
                Line {e.line}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="row">
        <button onClick={onCancel}>Back</button>
        <button className="primary" disabled={!result || result.events.length === 0} onClick={() => result && onDone(result.events)}>
          {result ? `Analyze ${result.events.length.toLocaleString('en')} events` : 'Choose the columns'}
        </button>
      </div>
    </main>
  );
}
