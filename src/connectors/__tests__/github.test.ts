import { describe, expect, it } from 'vitest';
import { ACT, GithubError, githubLog, parseRepo, toEvents } from '../github';

const json = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('github connector', () => {
  it('parses repository input', () => {
    expect(parseRepo('facebook/react')).toEqual({ owner: 'facebook', name: 'react' });
    expect(parseRepo('https://github.com/vitejs/vite/pulls')).toEqual({ owner: 'vitejs', name: 'vite' });
    expect(() => parseRepo('nonsense')).toThrow(GithubError);
  });

  it('turns PR timelines into events (REST, no token)', async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string) => {
      calls.push(url);
      if (url.includes('/pulls?')) {
        return json([{ number: 7, created_at: '2026-01-01T10:00:00Z', labels: [{ name: 'bug' }] }], { 'x-ratelimit-remaining': '59' });
      }
      return json([
        { event: 'ready_for_review', created_at: '2026-01-01T11:00:00Z' },
        { event: 'review_requested', created_at: '2026-01-01T11:00:01Z' },
        { event: 'review_requested', created_at: '2026-01-01T11:00:02Z' },
        { event: 'commented', created_at: '2026-01-01T12:00:00Z' },
        { event: 'reviewed', state: 'changes_requested', submitted_at: '2026-01-02T09:00:00Z' },
        { event: 'reviewed', state: 'approved', submitted_at: '2026-01-03T09:00:00Z' },
        { event: 'merged', created_at: '2026-01-03T10:00:00Z' },
        { event: 'closed', created_at: '2026-01-03T10:00:00Z' },
      ]);
    }) as typeof fetch;
    const events = await githubLog('o/r', { fetch: fakeFetch });
    expect(calls).toHaveLength(2);
    expect(events.map((e) => e.activity)).toEqual([
      ACT.openedDraft, ACT.ready, ACT.reviewRequested, ACT.changesRequested, ACT.approved, ACT.merged,
    ]);
    expect(events[0]).toMatchObject({ caseId: '#7', attrs: { label: 'bug' } });
  });

  it('explains an exhausted rate limit', async () => {
    const fakeFetch = (async () =>
      json({ message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }, 403)) as unknown as typeof fetch;
    await expect(githubLog('o/r', { fetch: fakeFetch })).rejects.toMatchObject({ kind: 'rate-limit' });
  });

  it('reports a missing repository', async () => {
    const fakeFetch = (async () => json({ message: 'Not Found' }, {}, 404)) as unknown as typeof fetch;
    await expect(githubLog('o/missing', { fetch: fakeFetch })).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('collapses repeated steps', () => {
    const ev = toEvents([
      { number: 1, createdAt: '2026-01-01T00:00:00Z', attrs: {}, steps: [
        { activity: ACT.reviewRequested, at: '2026-01-01T01:00:00Z' },
        { activity: ACT.reviewRequested, at: '2026-01-01T01:00:00Z' },
      ] },
    ]);
    expect(ev.map((e) => e.activity)).toEqual([ACT.opened, ACT.reviewRequested]);
  });
});

describe('github connector after a failure', () => {
  it('stops the other workers and reports no progress after the error', async () => {
    let timelineCalls = 0;
    const progress: number[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      if (url.includes('/pulls?')) {
        return json(
          Array.from({ length: 20 }, (_, i) => ({ number: i + 1, created_at: '2026-01-01T10:00:00Z' })),
          { 'x-ratelimit-remaining': '59' },
        );
      }
      timelineCalls++;
      if (timelineCalls === 3) return json({ message: 'limit' }, { 'x-ratelimit-remaining': '0' }, 403);
      // Slow responses that honour cancellation, like the real fetch.
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 20);
        init.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
      return json([]);
    }) as unknown as typeof fetch;
    await expect(githubLog('o/r', { fetch: fakeFetch, onProgress: (d) => progress.push(d) })).rejects.toMatchObject({ kind: 'rate-limit' });
    const after = progress.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(progress.length).toBe(after);
    expect(timelineCalls).toBeLessThan(8);
  });

  it('uses GraphQL with the token, whatever happened before', async () => {
    const urls: string[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      urls.push(url);
      expect((init.headers as Record<string, string>).Authorization).toBe('bearer tok');
      return json({
        data: { repository: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
          { number: 1, createdAt: '2026-01-01T00:00:00Z', labels: { nodes: [] }, timelineItems: { nodes: [{ __typename: 'MergedEvent', createdAt: '2026-01-02T00:00:00Z' }] } },
        ] } } },
      });
    }) as unknown as typeof fetch;
    const ev = await githubLog('o/r', { token: 'tok', fetch: fakeFetch });
    expect(urls).toEqual(['https://api.github.com/graphql']);
    expect(ev.map((e) => e.activity)).toEqual([ACT.opened, ACT.merged]);
  });
});
