import { describe, expect, it } from 'vitest';
import { handle, type Env } from './index';

const ORIGIN = 'https://flowsnag.app';
const assets = { fetch: async () => new Response('asset') };
const env: Env = { ASSETS: assets, JIRA_CLIENT_ID: 'cid', JIRA_CLIENT_SECRET: 'secret' };

const post = (body: unknown, origin = ORIGIN) =>
  new Request(`${ORIGIN}/api/jira/token`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('token worker', () => {
  it('serves the public client id, or null when not configured', async () => {
    expect(await (await handle(new Request(`${ORIGIN}/api/jira/config`), env)).json()).toEqual({ clientId: 'cid' });
    expect(await (await handle(new Request(`${ORIGIN}/api/jira/config`), { ASSETS: assets })).json()).toEqual({ clientId: null });
  });

  it('exchanges a code and returns only the access token', async () => {
    let sent: Record<string, string> = {};
    const fake = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return Response.json({ access_token: 'tok', refresh_token: 'never-forward', expires_in: 3600, scope: 'read:jira-work' });
    }) as unknown as typeof fetch;
    const res = await handle(post({ code: 'abc', redirectUri: `${ORIGIN}/` }), env, fake);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ accessToken: 'tok', expiresIn: 3600, scope: 'read:jira-work' });
    expect(sent).toMatchObject({ grant_type: 'authorization_code', client_id: 'cid', client_secret: 'secret', code: 'abc' });
  });

  it('refuses other origins and foreign redirect URIs', async () => {
    const never = (async () => {
      throw new Error('must not call Atlassian');
    }) as unknown as typeof fetch;
    expect((await handle(post({ code: 'abc', redirectUri: `${ORIGIN}/` }, 'https://evil.example'), env, never)).status).toBe(403);
    expect((await handle(post({ code: 'abc', redirectUri: 'https://evil.example/' }), env, never)).status).toBe(400);
    expect((await handle(post({ redirectUri: `${ORIGIN}/` }), env, never)).status).toBe(400);
    expect((await handle(new Request(`${ORIGIN}/api/jira/token`), env, never)).status).toBe(405);
  });

  it('reports a failed exchange without details', async () => {
    const fake = (async () => Response.json({ error: 'invalid_grant' }, { status: 403 })) as unknown as typeof fetch;
    const res = await handle(post({ code: 'old', redirectUri: `${ORIGIN}/` }), env, fake);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'exchange_failed' });
  });

  it('passes everything else to the static assets', async () => {
    expect(await (await handle(new Request(`${ORIGIN}/`), env)).text()).toBe('asset');
    expect((await handle(new Request(`${ORIGIN}/api/other`), env)).status).toBe(404);
  });
});
