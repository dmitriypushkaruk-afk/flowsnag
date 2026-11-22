/**
 * Browser side of Jira OAuth 2.0 (3LO). The access token lives only in memory (React state):
 * never in localStorage, never sent anywhere except api.atlassian.com.
 */

const STATE_KEY = 'flowsnag.jira.state';
export const JIRA_SCOPE = 'read:jira-work';

export async function jiraClientId(f: typeof fetch = fetch.bind(globalThis)): Promise<string | null> {
  try {
    const res = await f('/api/jira/config');
    if (!res.ok) return null;
    const body = (await res.json()) as { clientId?: string | null };
    return body.clientId || null;
  } catch {
    return null;
  }
}

function redirectUri(): string {
  return `${window.location.origin}/`;
}

export function authorizeUrl(clientId: string, state: string, redirect = redirectUri()): string {
  const q = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: clientId,
    scope: JIRA_SCOPE,
    redirect_uri: redirect,
    state,
    response_type: 'code',
    prompt: 'consent',
  });
  return `https://auth.atlassian.com/authorize?${q}`;
}

export function startJiraSignIn(clientId: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    sessionStorage.setItem(STATE_KEY, state);
  } catch {
    // Without session storage we cannot check the state on return; refuse rather than skip the check.
    throw new Error('This browser blocks session storage, which the Jira sign-in needs.');
  }
  window.location.assign(authorizeUrl(clientId, state));
}

export type Callback = { code: string } | { error: string } | null;

/** Read and clear an OAuth callback from the current URL. */
export function takeJiraCallback(): Callback {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (!code && !error) return null;
  let expected: string | null = null;
  try {
    expected = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* handled below */
  }
  window.history.replaceState(null, '', '/');
  if (error) return { error: error === 'access_denied' ? 'You did not allow access to Jira.' : `Jira sign-in failed (${error}).` };
  if (!state || !expected || state !== expected) return { error: 'The Jira sign-in could not be verified. Please try again.' };
  return { code: code! };
}

export async function exchangeCode(code: string, f: typeof fetch = fetch.bind(globalThis)): Promise<string> {
  const res = await f('/api/jira/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirectUri: redirectUri() }),
  });
  const body = (await res.json().catch(() => ({}))) as { accessToken?: string };
  if (!res.ok || !body.accessToken) throw new Error('Jira sign-in did not complete. Please try again.');
  return body.accessToken;
}
