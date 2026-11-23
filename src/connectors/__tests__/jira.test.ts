import { describe, expect, it } from 'vitest';
import { defaultJql, issueToEvents, jiraLog, JiraError, parseJiraTime, type JiraHistory, type JiraIssue } from '../jira';

const issue = (id: string, key: string, created = '2026-10-01T09:00:00.000+0200', status = 'Done'): JiraIssue => ({
  id,
  key,
  fields: {
    created,
    status: { name: status, statusCategory: { key: status === 'Done' ? 'done' : 'indeterminate' } },
    issuetype: { name: 'Bug' },
    priority: { name: 'High' },
    project: { key: 'ABC' },
  },
});
const change = (id: string, created: string, from: string, to: string, author: JiraHistory['author'] = { displayName: 'Olena K.', accountType: 'atlassian' }): JiraHistory => ({
  id,
  created,
  author,
  items: [{ field: 'status', fieldId: 'status', fromString: from, toString: to }],
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('jira mapping', () => {
  it('parses Jira offsets without a colon', () => {
    expect(parseJiraTime('2026-10-01T09:00:00.000+0200')).toBe(Date.UTC(2026, 9, 1, 7));
  });

  it('accepts epoch times, as the bulk changelog endpoint sends them', () => {
    const ms = Date.UTC(2026, 9, 1, 7);
    expect(parseJiraTime(ms)).toBe(ms);
    expect(parseJiraTime(ms / 1000)).toBe(ms);
    expect(parseJiraTime(String(ms))).toBe(ms);
    expect(parseJiraTime(undefined)).toBeNaN();
    expect(parseJiraTime({})).toBeNaN();
  });

  it('starts with the initial status at creation, then each status entered', () => {
    const ev = issueToEvents(issue('1', 'ABC-1'), [
      change('11', '2026-10-02T09:00:00.000+0200', 'In Progress', 'Review'),
      change('10', '2026-10-01T10:00:00.000+0200', 'To Do', 'In Progress'),
      { id: '12', created: '2026-10-02T10:00:00.000+0200', author: null, items: [{ field: 'assignee', toString: 'x' }] },
      change('13', '2026-10-03T09:00:00.000+0200', 'Review', 'Done', { displayName: 'Automation for Jira', accountType: 'app' }),
    ]);
    expect(ev.map((e) => [e.activity, e.resource])).toEqual([
      ['To Do', undefined],
      ['In Progress', 'Olena K.'],
      ['Review', 'Olena K.'],
      ['Done', 'Automation'],
    ]);
    expect(ev[0]!.attrs).toEqual({ type: 'Bug', priority: 'High', project: 'ABC', state: 'Done' });
  });

  it('uses the current status when an issue never moved', () => {
    expect(issueToEvents(issue('2', 'ABC-2', undefined, 'To Do'), []).map((e) => e.activity)).toEqual(['To Do']);
  });

  it('builds a safe default JQL', () => {
    expect(defaultJql('ABC', 90)).toBe('project = ABC AND created >= -90d ORDER BY created ASC');
    expect(defaultJql('my "proj"', 30)).toBe('project = "my \\"proj\\"" AND created >= -30d ORDER BY created ASC');
  });
});

describe('jira cloud fetch', () => {
  it('pages the search, bulk-fetches history and removes duplicates', async () => {
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.endsWith('/search/jql')) {
        return body.nextPageToken
          ? json({ issues: [issue('2', 'ABC-2')], isLast: true })
          : json({ issues: [issue('1', 'ABC-1')], nextPageToken: 'p2', isLast: false });
      }
      if (url.endsWith('/changelog/bulkfetch')) {
        const h = change('10', '2026-10-01T10:00:00.000+0200', 'To Do', 'Done');
        return body.nextPageToken
          ? json({ issueChangeLogs: [{ issueId: '1', changeHistories: [h] }] }) // duplicate of page 1
          : json({ issueChangeLogs: [{ issueId: '1', changeHistories: [h] }, { issueId: '2', changeHistories: [] }], nextPageToken: 'c2' });
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;

    const ev = await jiraLog({ kind: 'oauth', cloudId: 'cid', accessToken: 't' }, { jql: 'project = ABC', fetch: fake });
    expect(calls[0]!.url).toBe('https://api.atlassian.com/ex/jira/cid/rest/api/3/search/jql');
    expect(calls[0]!.body).toMatchObject({ jql: 'project = ABC', maxResults: 100 });
    expect(ev.filter((e) => e.caseId === 'ABC-1').map((e) => e.activity)).toEqual(['To Do', 'Done']);
    expect(ev.filter((e) => e.caseId === 'ABC-2').map((e) => e.activity)).toEqual(['Done']);
  });

  it('reads bulk changelogs with numeric times and ids (real Cloud payload shape)', async () => {
    const t = Date.UTC(2026, 9, 2, 8);
    const fake = (async (url: string) => {
      if (url.endsWith('/search/jql')) return json({ issues: [issue('1', 'ABC-1')], isLast: true });
      if (url.endsWith('/changelog/bulkfetch')) {
        return json({
          issueChangeLogs: [
            {
              issueId: 1,
              changeHistories: [
                { id: 10, created: t, author: { accountId: 'x', accountType: 'atlassian', displayName: 'Ä Ö' }, items: [{ field: 'status', fieldId: 'status', from: '1', fromString: 'Zu erledigen', to: '3', toString: 'In Arbeit' }] },
                { id: 11, created: t + 3600_000, author: null },
              ],
            },
          ],
        });
      }
      throw new Error(url);
    }) as unknown as typeof fetch;
    const ev = await jiraLog({ kind: 'oauth', cloudId: 'cid', accessToken: 't' }, { jql: 'x', fetch: fake });
    expect(ev.map((e) => [e.activity, e.timestamp])).toEqual([
      ['Zu erledigen', Date.parse('2026-10-01T09:00:00.000+02:00')],
      ['In Arbeit', t],
    ]);
  });

  it('falls back to one changelog request per issue when bulk is not allowed', async () => {
    const fake = (async (url: string) => {
      if (url.endsWith('/search/jql')) return json({ issues: [issue('1', 'ABC-1')], isLast: true });
      if (url.endsWith('/changelog/bulkfetch')) return json({}, 403);
      if (url.includes('/issue/1/changelog')) return json({ values: [change('10', '2026-10-01T10:00:00.000+0200', 'To Do', 'Done')], isLast: true, maxResults: 100 });
      throw new Error(url);
    }) as unknown as typeof fetch;
    const ev = await jiraLog({ kind: 'basic', site: 'x.atlassian.net', email: 'a@b.c', apiToken: 't' }, { jql: 'x', fetch: fake });
    expect(ev.map((e) => e.activity)).toEqual(['To Do', 'Done']);
  });

  it('waits on 429 and explains bad JQL', async () => {
    let n = 0;
    const waits: number[] = [];
    const fake = (async (url: string) => {
      if (url.endsWith('/search/jql')) {
        if (n++ === 0) return json({}, 429, { 'retry-after': '2' });
        return json({ errorMessages: ["Field 'foo' does not exist"] }, 400);
      }
      throw new Error(url);
    }) as unknown as typeof fetch;
    const err = await jiraLog({ kind: 'oauth', cloudId: 'c', accessToken: 't' }, { jql: 'foo = 1', fetch: fake, sleep: async (ms) => void waits.push(ms) }).catch((e) => e);
    expect(waits).toEqual([2000]);
    expect(err).toBeInstanceOf(JiraError);
    expect(err).toMatchObject({ kind: 'jql', message: "Jira: Field 'foo' does not exist" });
  });
});

describe('jira data center', () => {
  it('reads issues with changelog from API v2', async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      return json({
        total: 1,
        issues: [{ ...issue('1', 'DC-1'), changelog: { histories: [change('5', '2026-10-01T10:00:00.000+0200', 'Open', 'Closed')] } }],
      });
    }) as unknown as typeof fetch;
    const ev = await jiraLog({ kind: 'datacenter', baseUrl: 'https://jira.corp.local/', token: 'pat' }, { jql: 'project = DC', fetch: fake });
    expect(urls[0]).toContain('https://jira.corp.local/rest/api/2/search?jql=project+%3D+DC');
    expect(urls[0]).toContain('expand=changelog');
    expect(ev.map((e) => e.activity)).toEqual(['Open', 'Closed']);
  });
});
