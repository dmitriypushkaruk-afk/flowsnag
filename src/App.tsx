import { useState } from 'react';
import type { EventLog } from './core/types';
import { AnalysisView } from './ui/AnalysisView';
import { ImportScreen } from './ui/ImportScreen';

export function App() {
  const [log, setLog] = useState<EventLog | null>(null);
  return (
    <>
      <nav className="topbar">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); setLog(null); }}>
          <img src="/favicon.svg" alt="" width={22} height={22} /> FlowSnag
        </a>
        <span className="privacy" title="All analysis runs in this browser tab. Nothing is uploaded.">● Runs in your browser · no upload</span>
      </nav>
      {log ? <AnalysisView log={log} onBack={() => setLog(null)} /> : <ImportScreen onLoad={setLog} />}
      <footer className="footer">
        FlowSnag is open source · <a href="https://github.com/dmitriypushkaruk-afk/flowsnag">GitHub</a>
      </footer>
    </>
  );
}
