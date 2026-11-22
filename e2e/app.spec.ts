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
