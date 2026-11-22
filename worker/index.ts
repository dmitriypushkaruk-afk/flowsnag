/**
 * The only server code in FlowSnag (ADR 0002). It answers two routes and nothing else:
 *
 *   GET  /api/jira/config  → { clientId }  (public OAuth client id, or null when Jira is not set up)
 *   POST /api/jira/token   → exchanges an OAuth authorization code for an access token
 *
 * Atlassian's OAuth 2.0 (3LO) needs a client secret for that exchange and has no PKCE, so the
 * browser cannot do it alone. This Worker adds the secret, forwards the exchange to Atlassian and
 * returns the access token. It stores nothing, logs nothing and never sees issues: the browser
 * then talks to api.atlassian.com directly. Every other path is served from the static assets.
 */

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  JIRA_CLIENT_ID?: string;
  JIRA_CLIENT_SECRET?: string;
  /** Override for tests. */
  ATLASSIAN_TOKEN_URL?: string;
}

const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: NO_STORE });
}

async function token(request: Request, env: Env, fetcher: typeof fetch): Promise<Response> {
  if (!env.JIRA_CLIENT_ID || !env.JIRA_CLIENT_SECRET) return json({ error: 'not_configured' }, 501);
  const self = new URL(request.url).origin;
  // Only our own pages may ask (blocks other sites from using our client secret).
  if (request.headers.get('Origin') !== self) return json({ error: 'forbidden_origin' }, 403);
  let body: { code?: unknown; redirectUri?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const { code, redirectUri } = body;
  if (typeof code !== 'string' || code.length === 0 || code.length > 4096) return json({ error: 'bad_code' }, 400);
  if (typeof redirectUri !== 'string' || new URL(redirectUri, self).origin !== self) return json({ error: 'bad_redirect' }, 400);

  const res = await fetcher(env.ATLASSIAN_TOKEN_URL ?? 'https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: env.JIRA_CLIENT_ID,
      client_secret: env.JIRA_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) return json({ error: 'exchange_failed' }, 400);
  const t = (await res.json()) as { access_token?: string; expires_in?: number; scope?: string };
  if (!t.access_token) return json({ error: 'exchange_failed' }, 400);
  // Pass on only what the browser needs. No refresh token is requested or returned.
  return json({ accessToken: t.access_token, expiresIn: t.expires_in ?? 3600, scope: t.scope ?? '' });
}

export async function handle(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/jira/config' && request.method === 'GET') {
    return json({ clientId: env.JIRA_CLIENT_ID && env.JIRA_CLIENT_SECRET ? env.JIRA_CLIENT_ID : null });
  }
  if (url.pathname === '/api/jira/token') {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    return token(request, env, fetcher);
  }
  if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
  return env.ASSETS.fetch(request);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
