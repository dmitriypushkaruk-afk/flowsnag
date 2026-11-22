import type { XrayEvent } from '../core/types';

/**
 * Jira → xray-log. Same code for the browser (OAuth 3LO via api.atlassian.com) and the CLI
 * (API token on *.atlassian.net, or a personal access token on Data Center).
 * See specs/001-mvp/jira-api.md. Only type imports here, so Node can run it with type stripping.
 *
 * Mapping (jira-api.md §4):
 *  - case = issue key; an event per status the issue *entered*, at the change time;
 *  - the first event is the initial status at `created` (from the first change's `fromString`);
 *  - resource = who made the change, "Automation" for app/bot accounts;
 *  - attributes for filters: type, priority, project, and whether the issue is open.
 */

export type JiraAuth =
  | { kind: 'oauth'; cloudId: string; accessToken: string }
  | { kind: 'basic'; site: string; email: string; apiToken: string }
  | { kind: 'datacenter'; baseUrl: string; token: string };

export interface JiraOptions {
  jql: string;
  /** Stop after this many issues (newest first is up to the JQL's ORDER BY). */
  limit?: number;
  fetch?: typeof fetch;
  onProgress?: (phase: 'issues' | 'history', done: number, total?: number) => void;
  signal?: AbortSignal;
  /** Wait function, replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
}

export type JiraErrorKind = 'auth' | 'forbidden' | 'jql' | 'rate-limit' | 'network';

export class JiraError extends Error {
  readonly kind: JiraErrorKind;
  constructor(message: string, kind: JiraErrorKind) {
    super(message);
    this.kind = kind;
  }
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    created: string;
    resolutiondate?: string | null;
    status?: { name: string; statusCategory?: { key: string } };
    issuetype?: { name: string };
    priority?: { name: string } | null;
    project?: { key: string };
  };
}

export interface JiraHistory {
  id: string;
  created: string;
  author?: { displayName?: string; accountType?: string } | null;
  items: { field: string; fieldId?: string; fromString?: string | null; toString?: string | null }[];
}

export const ISSUE_FIELDS = ['created', 'resolutiondate', 'status', 'issuetype', 'priority', 'project'];

/** Jira sends "+0200"; not every JS engine parses an offset without a colon. */
export function parseJiraTime(s: string): number {
  return Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
}

function isAutomation(author: JiraHistory['author']): boolean {
  if (!author) return true;
  return author.accountType === 'app' || /automation|bot\b/i.test(author.displayName ?? '');
}

export function issueToEvents(issue: JiraIssue, histories: JiraHistory[]): XrayEvent[] {
  const changes = histories
    .flatMap((h) =>
      h.items
        .filter((it) => it.field === 'status' || it.fieldId === 'status')
        .map((it) => ({ h, it, t: parseJiraTime(h.created) })),
    )
    .filter((c) => !Number.isNaN(c.t))
    .sort((a, b) => a.t - b.t || Number(a.h.id) - Number(b.h.id));

  const f = issue.fields;
  const attrs: Record<string, string> = {
    type: f.issuetype?.name ?? 'Unknown',
    priority: f.priority?.name ?? 'None',
    project: f.project?.key ?? issue.key.split('-')[0] ?? '',
    state: f.status?.statusCategory?.key === 'done' ? 'Done' : 'Open',
  };
  const initial = changes[0]?.it.fromString ?? f.status?.name ?? 'Created';
  const created = parseJiraTime(f.created);
  const events: XrayEvent[] = [];
  if (!Number.isNaN(created)) events.push({ caseId: issue.key, activity: initial, timestamp: created, attrs });
  for (const { h, it, t } of changes) {
    if (!it.toString) continue;
    events.push({
      caseId: issue.key,
      activity: it.toString,
      timestamp: t,
      resource: isAutomation(h.author) ? 'Automation' : (h.author?.displayName ?? 'Unknown'),
      attrs,
    });
  }
  return events;
}

// ---------- HTTP ----------

interface Client {
  base: string;
  headers: Record<string, string>;
  api: 2 | 3;
}

function client(auth: JiraAuth): Client {
  switch (auth.kind) {
    case 'oauth':
      return {
        base: `https://api.atlassian.com/ex/jira/${encodeURIComponent(auth.cloudId)}`,
        headers: { Authorization: `Bearer ${auth.accessToken}`, Accept: 'application/json' },
        api: 3,
      };
    case 'basic': {
      const site = auth.site.replace(/^https?:\/\//, '').replace(/\/+$/, '');
      return {
        base: `https://${site}`,
        headers: { Authorization: `Basic ${btoa(`${auth.email}:${auth.apiToken}`)}`, Accept: 'application/json' },
        api: 3,
      };
    }
    case 'datacenter':
      return {
        base: auth.baseUrl.replace(/\/+$/, ''),
        headers: { Authorization: `Bearer ${auth.token}`, Accept: 'application/json' },
        api: 2,
      };
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function request<T>(c: Client, path: string, o: JiraOptions, body?: unknown): Promise<T> {
  const f = o.fetch ?? fetch.bind(globalThis);
  const sleep = o.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await f(c.base + path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { ...c.headers, 'Content-Type': 'application/json' } : c.headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: o.signal,
      });
    } catch {
      throw new JiraError('Could not reach Jira. Check the site address and your connection.', 'network');
    }
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status === 503) && attempt < 5) {
      // Respect Retry-After; otherwise exponential backoff with jitter.
      const retry = Number(res.headers.get('retry-after'));
      await sleep(retry > 0 ? retry * 1000 : 2 ** attempt * 1000 + Math.random() * 500);
      continue;
    }
    if (res.status === 429) throw new JiraError('Jira is rate limiting requests. Try again in a few minutes.', 'rate-limit');
    if (res.status === 401) throw new JiraError('Jira did not accept the sign-in. Connect again.', 'auth');
    if (res.status === 403) throw new JiraError('Your Jira account may not read this data.', 'forbidden');
    if (res.status === 400) {
      const msg = await res
        .json()
        .then((b: { errorMessages?: string[] }) => b.errorMessages?.[0])
        .catch(() => undefined);
      throw new JiraError(msg ? `Jira: ${msg}` : 'Jira did not accept the query.', 'jql');
    }
    throw new JiraError(`Jira answered with error ${res.status}.`, 'network');
  }
}

// ---------- Cloud (API v3) ----------

async function searchCloud(c: Client, o: JiraOptions): Promise<JiraIssue[]> {
  const limit = o.limit ?? 2000;
  const out: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  do {
    const page = await request<{ issues: JiraIssue[]; nextPageToken?: string; isLast?: boolean }>(c, '/rest/api/3/search/jql', o, {
      jql: o.jql,
      fields: ISSUE_FIELDS,
      maxResults: Math.min(100, limit - out.length),
      nextPageToken,
    });
    out.push(...page.issues);
    o.onProgress?.('issues', out.length);
    nextPageToken = page.isLast === false || (page.isLast === undefined && page.nextPageToken) ? page.nextPageToken : undefined;
  } while (nextPageToken && out.length < limit);
  return out.slice(0, limit);
}

/** Status history for many issues: bulk endpoint, falling back to one request per issue. */
async function changelogsCloud(c: Client, issues: JiraIssue[], o: JiraOptions): Promise<Map<string, JiraHistory[]>> {
  const byId = new Map<string, Map<string, JiraHistory>>();
  const add = (issueId: string, h: JiraHistory) => {
    let m = byId.get(issueId);
    if (!m) byId.set(issueId, (m = new Map()));
    m.set(h.id, h); // de-duplicate: the bulk endpoint can repeat histories across pages (JRACLOUD-94906)
  };
  let done = 0;
  try {
    for (let i = 0; i < issues.length; i += 1000) {
      const chunk = issues.slice(i, i + 1000);
      let nextPageToken: string | undefined;
      do {
        const page = await request<{
          issueChangeLogs: { issueId: string; changeHistories: JiraHistory[] }[];
          nextPageToken?: string;
        }>(c, '/rest/api/3/changelog/bulkfetch', o, {
          issueIdsOrKeys: chunk.map((x) => x.id),
          fieldIds: ['status'],
          maxResults: 1000,
          nextPageToken,
        });
        for (const l of page.issueChangeLogs) for (const h of l.changeHistories) add(l.issueId, h);
        nextPageToken = page.nextPageToken;
      } while (nextPageToken);
      done += chunk.length;
      o.onProgress?.('history', done, issues.length);
    }
  } catch (e) {
    if (!(e instanceof JiraError) || (e.kind !== 'forbidden' && e.kind !== 'network')) throw e;
    // Bulk endpoint unavailable for this app or site: one issue at a time, 6 in parallel.
    byId.clear();
    done = 0;
    const queue = [...issues];
    const worker = async () => {
      for (let issue = queue.shift(); issue; issue = queue.shift()) {
        for (let startAt = 0; ; ) {
          const page = await request<{ values: JiraHistory[]; isLast?: boolean; total?: number; maxResults: number }>(
            c,
            `/rest/api/3/issue/${issue.id}/changelog?startAt=${startAt}&maxResults=100`,
            o,
          );
          for (const h of page.values) add(issue.id, h);
          startAt += page.values.length;
          if (page.isLast !== false || page.values.length === 0) break;
        }
        o.onProgress?.('history', ++done, issues.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }
  return new Map([...byId].map(([id, m]) => [id, [...m.values()]]));
}

// ---------- Data Center (API v2) ----------

async function searchDataCenter(c: Client, o: JiraOptions): Promise<{ issue: JiraIssue; histories: JiraHistory[] }[]> {
  const limit = o.limit ?? 2000;
  const out: { issue: JiraIssue; histories: JiraHistory[] }[] = [];
  for (let startAt = 0; out.length < limit; ) {
    const q = new URLSearchParams({
      jql: o.jql,
      startAt: String(startAt),
      maxResults: String(Math.min(100, limit - out.length)),
      fields: ISSUE_FIELDS.join(','),
      expand: 'changelog',
    });
    const page = await request<{ issues: (JiraIssue & { changelog?: { histories: JiraHistory[] } })[]; total: number }>(
      c,
      `/rest/api/2/search?${q}`,
      o,
    );
    for (const i of page.issues) out.push({ issue: i, histories: i.changelog?.histories ?? [] });
    o.onProgress?.('issues', out.length, Math.min(page.total, limit));
    startAt += page.issues.length;
    if (page.issues.length === 0 || startAt >= page.total) break;
  }
  return out;
}

export async function jiraLog(auth: JiraAuth, o: JiraOptions): Promise<XrayEvent[]> {
  const c = client(auth);
  if (c.api === 2) {
    return (await searchDataCenter(c, o)).flatMap(({ issue, histories }) => issueToEvents(issue, histories));
  }
  const issues = await searchCloud(c, o);
  const histories = await changelogsCloud(c, issues, o);
  return issues.flatMap((i) => issueToEvents(i, histories.get(i.id) ?? []));
}

// ---------- helpers for the browser flow ----------

export interface JiraSite {
  id: string;
  name: string;
  url: string;
}

export async function accessibleSites(accessToken: string, f: typeof fetch = fetch.bind(globalThis)): Promise<JiraSite[]> {
  const res = await f('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (res.status === 401) throw new JiraError('The Jira sign-in expired. Connect again.', 'auth');
  if (!res.ok) throw new JiraError(`Atlassian answered with error ${res.status}.`, 'network');
  return (await res.json()) as JiraSite[];
}

export interface JiraProject {
  key: string;
  name: string;
}

export async function listProjects(auth: JiraAuth, o: Pick<JiraOptions, 'fetch' | 'signal'> = {}): Promise<JiraProject[]> {
  const c = client(auth);
  const out: JiraProject[] = [];
  for (let startAt = 0; startAt < 500; ) {
    const page = await request<{ values: JiraProject[]; isLast: boolean }>(
      c,
      `/rest/api/3/project/search?startAt=${startAt}&maxResults=50&orderBy=name`,
      { jql: '', ...o },
    );
    out.push(...page.values.map((p) => ({ key: p.key, name: p.name })));
    startAt += page.values.length;
    if (page.isLast || page.values.length === 0) break;
  }
  return out;
}

export function defaultJql(projectKey: string, days: number): string {
  const key = /^[A-Z][A-Z0-9_]+$/.test(projectKey) ? projectKey : `"${projectKey.replace(/"/g, '\\"')}"`;
  return `project = ${key} AND created >= -${days}d ORDER BY created ASC`;
}
