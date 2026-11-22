import { useEffect, useState } from 'react';
import { exchangeCode, type Callback } from './connectors/jiraOAuth';
import type { EventLog } from './core/types';
import { AnalysisView } from './ui/AnalysisView';
import { ImportScreen } from './ui/ImportScreen';
import { JiraPicker } from './ui/JiraConnect';

export function App({ jiraCallback }: { jiraCallback: Callback }) {
  const [log, setLog] = useState<EventLog | null>(null);
  const [jiraToken, setJiraToken] = useState<string | null>(null);
  const [jiraBusy, setJiraBusy] = useState(!!jiraCallback && 'code' in jiraCallback);
  const [jiraError, setJiraError] = useState<string | null>(jiraCallback && 'error' in jiraCallback ? jiraCallback.error : null);

  useEffect(() => {
    if (!jiraCallback || !('code' in jiraCallback)) return;
    exchangeCode(jiraCallback.code)
      .then(setJiraToken)
      .catch((e: Error) => setJiraError(e.message))
      .finally(() => setJiraBusy(false));
  }, [jiraCallback]);

  const reset = () => {
    setLog(null);
  };

  let screen;
  if (log) screen = <AnalysisView log={log} onBack={reset} />;
  else if (jiraBusy) screen = <main className="analysis loading">Finishing the Jira sign-in…</main>;
  else if (jiraToken) screen = <JiraPicker token={jiraToken} onLoad={setLog} onCancel={() => setJiraToken(null)} />;
  else screen = <ImportScreen onLoad={setLog} jiraError={jiraError} />;

  return (
    <>
      <nav className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            reset();
          }}
        >
          <img src="/favicon.svg" alt="" width={22} height={22} /> FlowSnag
        </a>
        <span className="privacy" title="All analysis runs in this browser tab. Nothing is uploaded.">
          ● Runs in your browser · no upload
        </span>
      </nav>
      {screen}
      <footer className="footer">
        FlowSnag is open source · <a href="https://github.com/dmitriypushkaruk-afk/flowsnag">GitHub</a>
      </footer>
    </>
  );
}
