import { useEffect, useState } from 'react';
import { accessibleSites, defaultJql, jiraLog, JiraError, listProjects, type JiraProject, type JiraSite } from '../connectors/jira';
import { jiraClientId, startJiraSignIn } from '../connectors/jiraOAuth';
import type { EventLog } from '../core/types';

/** Card on the start screen. */
export function JiraCard({ error }: { error?: string | null }) {
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);
  const [startError, setStartError] = useState<string | null>(null);
  useEffect(() => {
    void jiraClientId().then(setClientId);
  }, []);

  return (
    <article className="card">
      <h2>Jira Cloud</h2>
      <p>Sign in with Atlassian, pick a project and see how its issues really move between statuses.</p>
      <button
        className="primary"
        disabled={!clientId}
        onClick={() => {
          try {
            if (clientId) startJiraSignIn(clientId);
          } catch (e) {
            setStartError(String((e as Error).message));
          }
        }}
      >
        Connect Jira
      </button>
      <p className="hint">
        {clientId === null
          ? 'Jira sign-in is not set up on this site yet. Meanwhile, export with the CLI (see README) and drop the CSV here.'
          : 'Read-only access. Your browser loads the issues straight from Atlassian; only the sign-in passes our server.'}
      </p>
      {(error || startError) && (
        <p className="error" role="alert">
          {error ?? startError}
        </p>
      )}
    </article>
  );
}

const PERIODS = [30, 90, 180, 365];
const LIMITS = [500, 2000, 5000];

/** Shown after a successful sign-in: choose site, project and period, then load. */
export function JiraPicker({ token, onLoad, onCancel }: { token: string; onLoad: (log: EventLog) => void; onCancel: () => void }) {
  const [sites, setSites] = useState<JiraSite[] | null>(null);
  const [site, setSite] = useState<string>('');
  const [projects, setProjects] = useState<JiraProject[] | null>(null);
  const [project, setProject] = useState('');
  const [days, setDays] = useState(180);
  const [limit, setLimit] = useState(2000);
  const [customJql, setCustomJql] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const auth = site ? ({ kind: 'oauth', cloudId: site, accessToken: token } as const) : null;

  useEffect(() => {
    accessibleSites(token)
      .then((s) => {
        setSites(s);
        if (s[0]) setSite(s[0].id);
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  useEffect(() => {
    if (!site) return;
    setProjects(null);
    setProject('');
    listProjects({ kind: 'oauth', cloudId: site, accessToken: token })
      .then((p) => {
        setProjects(p);
        if (p[0]) setProject(p[0].key);
      })
      .catch((e: Error) => setError(e.message));
  }, [site, token]);

  const jql = customJql ?? (project ? defaultJql(project, days) : '');

  const run = async () => {
    if (!auth || !jql) return;
    setError(null);
    setProgress('Searching issues…');
    try {
      const events = await jiraLog(auth, {
        jql,
        limit,
        onProgress: (phase, done, total) =>
          setProgress(phase === 'issues' ? `Found ${done} issues…` : `Reading history… ${done}${total ? `/${total}` : ''}`),
      });
      if (events.length === 0) throw new JiraError('No issues match this query.', 'jql');
      const siteName = sites?.find((s) => s.id === site)?.name ?? 'Jira';
      onLoad({ name: customJql ? `Jira: ${siteName}` : `Jira: ${project} (${siteName})`, source: 'jira', events });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong while reading Jira.');
    } finally {
      setProgress(null);
    }
  };

  return (
    <main className="mapping jira">
      <h1>Connected to Jira</h1>
      <p className="lead">Choose what to analyse. Issues are loaded by this browser tab directly from Atlassian.</p>
      {sites && sites.length === 0 && <p className="error">This Atlassian account has no Jira sites you can read.</p>}

      <div className="mapping-grid">
        <label>
          Site
          <select value={site} onChange={(e) => setSite(e.target.value)} disabled={!sites}>
            {!sites && <option>Loading…</option>}
            {sites?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Project
          <select value={project} onChange={(e) => setProject(e.target.value)} disabled={!projects || customJql !== null}>
            {!projects && <option>Loading…</option>}
            {projects?.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name} ({p.key})
              </option>
            ))}
          </select>
        </label>
        <label>
          Created in the last
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={customJql !== null}>
            {PERIODS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <label>
          At most
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {LIMITS.map((l) => (
              <option key={l} value={l}>
                {l.toLocaleString('en')} issues
              </option>
            ))}
          </select>
        </label>
      </div>

      {customJql === null ? (
        <button className="link" onClick={() => setCustomJql(jql)}>
          Write JQL instead
        </button>
      ) : (
        <label className="jql">
          JQL
          <textarea value={customJql} onChange={(e) => setCustomJql(e.target.value)} rows={3} spellCheck={false} />
          <button className="link" onClick={() => setCustomJql(null)}>
            Back to project and period
          </button>
        </label>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="row">
        <button onClick={onCancel}>Back</button>
        <button className="primary" disabled={!jql || !!progress} onClick={() => void run()}>
          {progress ?? 'Analyze'}
        </button>
      </div>
    </main>
  );
}
