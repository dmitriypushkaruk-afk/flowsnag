import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { takeJiraCallback } from './connectors/jiraOAuth';
import './styles.css';

// Read (and clear from the address bar) a Jira sign-in callback exactly once.
const jiraCallback = takeJiraCallback();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App jiraCallback={jiraCallback} />
  </StrictMode>,
);
