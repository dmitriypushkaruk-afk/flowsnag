import { expect, test, type Page } from '@playwright/test';

/** FR-14: the app must not send anything to any host except itself and the source system's API. */
function watchRequests(page: Page) {
  const outside: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.origin !== 'http://localhost:4173' && url.hostname !== 'api.github.com' && url.protocol !== 'blob:' && url.protocol !== 'data:') {
      outside.push(r.url());
    }
  });
  return outside;
}

test('demo shows three findings and a map, with no outside requests', async ({ page }) => {
  const outside = watchRequests(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open demo' }).click();
  await expect(page.locator('.insight')).toHaveCount(3);
  await expect(page.locator('.insight').first()).toContainText('Code Review');
  expect(await page.locator('.map .node').count()).toBeGreaterThanOrEqual(4);
  expect(outside).toEqual([]);
});

test('filters narrow the cases', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open demo' }).click();
  const cases = page.locator('.kpis dd').first();
  await expect(cases).toHaveText('400');
  await page.locator('.filters summary', { hasText: 'type' }).click();
  await page.getByRole('checkbox', { name: /^Bug/ }).check();
  await expect(cases).toContainText('of 400');
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(cases).toHaveText('400');
});

test('exports the map as SVG and PNG', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open demo' }).click();
  await expect(page.locator('.map .node').first()).toBeVisible();

  const [svg] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'SVG' }).click()]);
  expect(svg.suggestedFilename()).toBe('demo-software-team-board-map.svg');
  const text = await (await svg.createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
  expect(text).toContain('Code Review');
  expect(text).toContain('Made with FlowSnag');
  expect(text).not.toContain('var(--');

  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PNG' }).click()]);
  expect(png.suggestedFilename()).toBe('demo-software-team-board-map.png');
  const bytes = Buffer.concat(await (await png.createReadStream()).toArray());
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
});

test('CSV import with column mapping and a broken row', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'jira.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Issue key;Status;Changed;Assignee\nA-1;Open;02.03.2026 09:14;anna\nA-1;Review;03.03.2026 10:00;bob\nA-1;Done;05.03.2026 10:00;bob\nA-2;Open;02.03.2026 09:14;anna\nA-2;Done;bad;anna\n',
    ),
  });
  await expect(page.getByRole('heading', { name: 'Which column is which?' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Line 6');
  await page.getByRole('button', { name: 'Analyze 4 events' }).click();
  await expect(page.locator('.map .node')).toHaveCount(3);
  // Resources are anonymised by default.
  await page.locator('.filters summary', { hasText: 'Resource' }).click();
  await expect(page.locator('.filters')).toContainText('Person 1');
  await expect(page.locator('.filters')).not.toContainText('anna');
});

test('XES import', async ({ page }) => {
  await page.goto('/');
  const ev = (name: string, t: string) =>
    `<event><string key="concept:name" value="${name}"/><date key="time:timestamp" value="${t}"/></event>`;
  const xes = `<?xml version="1.0"?><log xes.version="1.0">
    <trace><string key="concept:name" value="1"/>${ev('Register', '2026-01-01T09:00:00Z')}${ev('Check', '2026-01-02T09:00:00Z')}${ev('Pay', '2026-01-05T09:00:00Z')}</trace>
    <trace><string key="concept:name" value="2"/>${ev('Register', '2026-01-03T09:00:00Z')}${ev('Pay', '2026-01-04T09:00:00Z')}</trace>
  </log>`;
  await page.locator('input[type=file]').setInputFiles({ name: 'log.xes', mimeType: 'application/xml', buffer: Buffer.from(xes) });
  await expect(page.getByRole('heading', { name: 'log.xes' })).toBeVisible();
  await expect(page.locator('.map .node')).toHaveCount(3);
});

test('GitHub repository (API mocked)', async ({ page }) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-ratelimit-remaining' };
  await page.route('https://api.github.com/**', (route) => {
    const url = route.request().url();
    if (url.includes('/pulls?')) {
      return route.fulfill({
        json: [
          { number: 2, created_at: '2026-01-01T10:00:00Z' },
          { number: 1, created_at: '2026-01-01T09:00:00Z' },
        ],
        headers: { ...cors, 'x-ratelimit-remaining': '59' },
      });
    }
    return route.fulfill({
      json: [
        { event: 'review_requested', created_at: '2026-01-02T10:00:00Z' },
        { event: 'reviewed', state: 'approved', submitted_at: '2026-01-03T10:00:00Z' },
        { event: 'merged', created_at: '2026-01-03T12:00:00Z' },
      ],
      headers: cors,
    });
  });
  await page.goto('/');
  await page.getByLabel('Repository').fill('someone/repo');
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByRole('heading', { name: 'GitHub: someone/repo pull requests' })).toBeVisible();
  await expect(page.locator('.map .node')).toHaveCount(4);
});

test('after hitting the rate limit, a token can be added and works', async ({ page }) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-ratelimit-remaining, x-ratelimit-reset' };
  let timeline = 0;
  await page.route('https://api.github.com/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/graphql')) {
      expect(route.request().headers().authorization).toBe('bearer ghp_test');
      return route.fulfill({
        headers: cors,
        json: {
          data: { repository: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
            { number: 3, createdAt: '2026-01-01T00:00:00Z', labels: { nodes: [] }, timelineItems: { nodes: [{ __typename: 'MergedEvent', createdAt: '2026-01-02T00:00:00Z' }] } },
          ] } } },
        },
      });
    }
    if (url.includes('/pulls?')) {
      return route.fulfill({
        json: Array.from({ length: 50 }, (_, i) => ({ number: i + 1, created_at: '2026-01-01T10:00:00Z' })),
        headers: { ...cors, 'x-ratelimit-remaining': '50' },
      });
    }
    // Timelines: limit runs out after a few, the rest are slow.
    if (++timeline > 5) return route.fulfill({ status: 403, json: { message: 'API rate limit exceeded' }, headers: { ...cors, 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' } });
    await new Promise((r) => setTimeout(r, 50));
    return route.fulfill({ json: [], headers: cors });
  });
  await page.goto('/');
  await page.getByLabel('Repository').fill('big/repo');
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByRole('alert')).toContainText('hourly limit');
  // The token field opens by itself and the button is usable again.
  await page.getByLabel('GitHub token').fill('ghp_test');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByRole('heading', { name: 'GitHub: big/repo pull requests' })).toBeVisible();
});
