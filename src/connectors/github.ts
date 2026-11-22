import type { XrayEvent } from '../core/types';

/**
 * GitHub pull requests → xray-log, straight from the browser (GitHub's API allows CORS).
 *
 * - Without a token: REST API, 60 requests/hour per IP. One request lists PRs, then one
 *   timeline request per PR, so we fetch at most (remaining quota - 1) PRs, capped at 50.
 * - With a token (read-only, never leaves the browser): GraphQL, 50 PRs with their timeline
 *   per request, up to 500 PRs.
 */

export const ACT = {
  opened: 'Opened',
  openedDraft: 'Opened as draft',
  ready: 'Ready for review',
  toDraft: 'Converted to draft',
  reviewRequested: 'Review requested',
  changesRequested: 'Changes requested',
  approved: 'Approved',
  merged: 'Merged',
  closed: 'Closed without merge',
  reopened: 'Reopened',
} as const;

type Step = { activity: string; at: string };

export interface PrHistory {
  number: number;
  createdAt: string;
  steps: Step[];
  /** Case attributes for filters. */
  attrs: Record<string, string>;
}

export interface GithubOptions {
  token?: string;
  /** Maximum number of most recent PRs. */
  limit?: number;
  fetch?: typeof fetch;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** Which PRs to read. Demos use `closed` so every case is finished. */
  state?: 'all' | 'closed';
  /** Force the REST API even with a token (used by the demo build script). */
  rest?: boolean;
}

export type GithubErrorKind = 'not-found' | 'rate-limit' | 'auth' | 'network' | 'input';

export class GithubError extends Error {
  readonly kind: GithubErrorKind;
  readonly resetAt?: Date;
  constructor(message: string, kind: GithubErrorKind, resetAt?: Date) {
    super(message);
    this.kind = kind;
    this.resetAt = resetAt;
  }
}

export function parseRepo(input: string): { owner: string; name: string } {
  const s = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  const m = /^([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+)/.exec(s);
  if (!m) throw new GithubError('Enter a repository as owner/repo, for example facebook/react.', 'input');
  return { owner: m[1]!, name: m[2]! };
}

/** Turn PR histories into events. Repeated steps in a row (e.g. 3 reviewers requested at once) count once. */
export function toEvents(prs: PrHistory[]): XrayEvent[] {
  const events: XrayEvent[] = [];
  for (const pr of prs) {
    const caseId = `#${pr.number}`;
    const steps = [...pr.steps].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const startsAsDraft = steps.find((s) => s.activity === ACT.ready || s.activity === ACT.toDraft)?.activity === ACT.ready;
    const all: Step[] = [{ activity: startsAsDraft ? ACT.openedDraft : ACT.opened, at: pr.createdAt }, ...steps];
    let prev = '';
    for (const s of all) {
      if (s.activity === prev) continue;
      prev = s.activity;
      events.push({ caseId, activity: s.activity, timestamp: Date.parse(s.at), attrs: pr.attrs });
    }
  }
  return events;
}

// ---------- REST (no token) ----------

interface RestTimelineItem {
  event: string;
  created_at?: string;
  submitted_at?: string;
  state?: string;
}

function restStep(item: RestTimelineItem): Step | null {
  const at = item.created_at ?? item.submitted_at;
  if (!at) return null;
  switch (item.event) {
    case 'ready_for_review':
      return { activity: ACT.ready, at };
    case 'convert_to_draft':
      return { activity: ACT.toDraft, at };
    case 'review_requested':
      return { activity: ACT.reviewRequested, at };
    case 'reviewed':
      if (item.state === 'approved') return { activity: ACT.approved, at };
      if (item.state === 'changes_requested') return { activity: ACT.changesRequested, at };
      return null;
    case 'merged':
      return { activity: ACT.merged, at };
    case 'closed':
      return { activity: ACT.closed, at };
    case 'reopened':
      return { activity: ACT.reopened, at };
    default:
      return null;
  }
}

/** A merged PR also gets a "closed" event at the same moment; keep only "Merged". */
function dropCloseAfterMerge(steps: Step[]): Step[] {
  const mergedAt = new Set(steps.filter((s) => s.activity === ACT.merged).map((s) => s.at));
  return steps.filter((s) => !(s.activity === ACT.closed && mergedAt.has(s.at)));
}

async function call(f: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await f(url, init);
  } catch {
    throw new GithubError('Could not reach GitHub. Check your connection.', 'network');
  }
  if (res.ok) return res;
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  if ((res.status === 403 || res.status === 429) && remaining === '0') {
    const resetAt = reset ? new Date(Number(reset) * 1000) : undefined;
    throw new GithubError(
      `GitHub's hourly limit is used up${resetAt ? ` until ${resetAt.toLocaleTimeString()}` : ''}. Add a read-only token for 5,000 requests per hour, or open a ready-made demo.`,
      'rate-limit',
      resetAt,
    );
  }
  if (res.status === 401) throw new GithubError('GitHub did not accept the token.', 'auth');
  if (res.status === 404) throw new GithubError('Repository not found. Only public repositories work without sign-in.', 'not-found');
  throw new GithubError(`GitHub answered with error ${res.status}.`, 'network');
}

async function fetchRest(owner: string, name: string, o: GithubOptions): Promise<PrHistory[]> {
  const f = o.fetch ?? fetch.bind(globalThis);
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  const base = `https://api.github.com/repos/${owner}/${name}`;
  const cap = Math.min(o.limit ?? 50, 100);
  const listRes = await call(f, `${base}/pulls?state=${o.state ?? 'all'}&sort=created&direction=desc&per_page=${cap}`, { headers, signal: o.signal });
  const remaining = Number(listRes.headers.get('x-ratelimit-remaining') ?? cap);
  const list = (await listRes.json()) as {
    number: number;
    created_at: string;
    draft?: boolean;
    labels?: { name: string }[];
  }[];
  const take = list.slice(0, Math.max(0, Math.min(cap, remaining)));
  if (take.length === 0 && list.length > 0) {
    throw new GithubError(
      "GitHub's hourly limit is used up. Add a read-only token for 5,000 requests per hour, or open a ready-made demo.",
      'rate-limit',
    );
  }
  const out: PrHistory[] = [];
  let done = 0;
  o.onProgress?.(0, take.length);
  // A few requests at a time: fast, but polite to the API.
  const queue = [...take];
  const worker = async () => {
    for (let pr = queue.shift(); pr; pr = queue.shift()) {
      const res = await call(f, `https://api.github.com/repos/${owner}/${name}/issues/${pr.number}/timeline?per_page=100`, {
        headers,
        signal: o.signal,
      });
      const items = (await res.json()) as RestTimelineItem[];
      out.push({
        number: pr.number,
        createdAt: pr.created_at,
        steps: dropCloseAfterMerge(items.map(restStep).filter((s): s is Step => s !== null)),
        attrs: { label: pr.labels?.[0]?.name ?? '(none)' },
      });
      o.onProgress?.(++done, take.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out.sort((a, b) => b.number - a.number);
}

// ---------- GraphQL (token) ----------

const QUERY = `query($owner:String!,$name:String!,$cursor:String,$n:Int!){
  repository(owner:$owner,name:$name){
    pullRequests(first:$n,after:$cursor,orderBy:{field:CREATED_AT,direction:DESC}){
      pageInfo{hasNextPage endCursor}
      nodes{
        number createdAt
        labels(first:1){nodes{name}}
        timelineItems(first:100,itemTypes:[READY_FOR_REVIEW_EVENT,CONVERT_TO_DRAFT_EVENT,REVIEW_REQUESTED_EVENT,PULL_REQUEST_REVIEW,MERGED_EVENT,CLOSED_EVENT,REOPENED_EVENT]){
          nodes{
            __typename
            ... on ReadyForReviewEvent{createdAt}
            ... on ConvertToDraftEvent{createdAt}
            ... on ReviewRequestedEvent{createdAt}
            ... on PullRequestReview{state submittedAt}
            ... on MergedEvent{createdAt}
            ... on ClosedEvent{createdAt}
            ... on ReopenedEvent{createdAt}
          }
        }
      }
    }
  }
}`;

interface GqlItem {
  __typename: string;
  createdAt?: string;
  submittedAt?: string;
  state?: string;
}

const GQL_TYPES: Record<string, string> = {
  ReadyForReviewEvent: ACT.ready,
  ConvertToDraftEvent: ACT.toDraft,
  ReviewRequestedEvent: ACT.reviewRequested,
  MergedEvent: ACT.merged,
  ClosedEvent: ACT.closed,
  ReopenedEvent: ACT.reopened,
};

function gqlStep(i: GqlItem): Step | null {
  if (i.__typename === 'PullRequestReview') {
    if (!i.submittedAt) return null;
    if (i.state === 'APPROVED') return { activity: ACT.approved, at: i.submittedAt };
    if (i.state === 'CHANGES_REQUESTED') return { activity: ACT.changesRequested, at: i.submittedAt };
    return null;
  }
  const activity = GQL_TYPES[i.__typename];
  return activity && i.createdAt ? { activity, at: i.createdAt } : null;
}

async function fetchGraphql(owner: string, name: string, o: GithubOptions): Promise<PrHistory[]> {
  const f = o.fetch ?? fetch.bind(globalThis);
  const limit = Math.min(o.limit ?? 500, 1000);
  const out: PrHistory[] = [];
  let cursor: string | null = null;
  o.onProgress?.(0, limit);
  while (out.length < limit) {
    const res = await call(f, 'https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `bearer ${o.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { owner, name, cursor, n: Math.min(50, limit - out.length) } }),
      signal: o.signal,
    });
    const body = (await res.json()) as {
      errors?: { type?: string; message: string }[];
      data?: { repository: null | { pullRequests: GqlPage } };
    };
    if (body.errors?.length) {
      const e = body.errors[0]!;
      if (e.type === 'NOT_FOUND') throw new GithubError('Repository not found.', 'not-found');
      if (e.type === 'RATE_LIMITED') throw new GithubError('GitHub rate limit reached. Try again later.', 'rate-limit');
      throw new GithubError(`GitHub: ${e.message}`, 'network');
    }
    const page = body.data?.repository?.pullRequests;
    if (!page) throw new GithubError('Repository not found.', 'not-found');
    for (const n of page.nodes) {
      out.push({
        number: n.number,
        createdAt: n.createdAt,
        steps: dropCloseAfterMerge(n.timelineItems.nodes.map(gqlStep).filter((s): s is Step => s !== null)),
        attrs: { label: n.labels.nodes[0]?.name ?? '(none)' },
      });
    }
    o.onProgress?.(out.length, limit);
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }
  return out;
}

interface GqlPage {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: {
    number: number;
    createdAt: string;
    labels: { nodes: { name: string }[] };
    timelineItems: { nodes: GqlItem[] };
  }[];
}

export async function fetchPullRequests(repo: string, o: GithubOptions = {}): Promise<PrHistory[]> {
  const { owner, name } = parseRepo(repo);
  return o.token && !o.rest ? fetchGraphql(owner, name, o) : fetchRest(owner, name, o);
}

export async function githubLog(repo: string, o: GithubOptions = {}): Promise<XrayEvent[]> {
  return toEvents(await fetchPullRequests(repo, o));
}
