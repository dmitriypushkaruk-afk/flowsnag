import { expect, test } from '@playwright/test';

/** Full Jira flow with Atlassian and our token Worker mocked. */
test('connect Jira, pick a project, see the map', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    const h = new URL(r.url()).hostname;
    if (h !== 'localhost' && h !== 'api.atlassian.com' && h !== 'auth.atlassian.com') outside.push(r.url());
  });
  const cors = { 'access-control-allow-origin': '*' };
  await page.route('**/api/jira/config', (r) => r.fulfill({ json: { clientId: 'test-client' } }));
  // Atlassian's consent screen: send the browser straight back with a code and the same state.
  await page.route('https://auth.atlassian.com/authorize**', (r) => {
    const u = new URL(r.request().url());
    expect(u.searchParams.get('client_id')).toBe('test-client');
    expect(u.searchParams.get('scope')).toBe('read:jira-work');
    const back = `${u.searchParams.get('redirect_uri')}?code=the-code&state=${u.searchParams.get('state')}`;
    return r.fulfill({ status: 302, headers: { location: back } });
  });
  await page.route('**/api/jira/token', async (r) => {
    expect(r.request().postDataJSON()).toEqual({ code: 'the-code', redirectUri: 'http://localhost:4173/' });
    return r.fulfill({ json: { accessToken: 'at-123', expiresIn: 3600 } });
  });
  await page.route('https://api.atlassian.com/**', (r) => {
    const url = r.request().url();
    expect(r.request().headers().authorization).toBe('Bearer at-123');
    if (url.endsWith('/oauth/token/accessible-resources')) {
      return r.fulfill({ headers: cors, json: [{ id: 'cloud-1', name: 'acme', url: 'https://acme.atlassian.net' }] });
    }
    if (url.includes('/project/search')) {
      return r.fulfill({ headers: cors, json: { values: [{ key: 'ABC', name: 'Alpha' }], isLast: true } });
    }
    if (url.endsWith('/rest/api/3/search/jql')) {
      expect(r.request().postDataJSON().jql).toBe('project = ABC AND created >= -180d ORDER BY created ASC');
      const issue = (id: string, key: string) => ({
        id,
        key,
        fields: { created: '2026-10-01T09:00:00.000+0000', status: { name: 'Done', statusCategory: { key: 'done' } }, issuetype: { name: 'Story' }, project: { key: 'ABC' } },
      });
      return r.fulfill({ headers: cors, json: { issues: [issue('1', 'ABC-1'), issue('2', 'ABC-2')], isLast: true } });
    }
    if (url.endsWith('/changelog/bulkfetch')) {
      const h = (id: string, day: number, from: string, to: string) => ({
        id,
        created: `2026-10-0${day}T09:00:00.000+0000`,
        author: { displayName: 'Olena' },
        items: [{ field: 'status', fromString: from, toString: to }],
      });
      return r.fulfill({
        headers: cors,
        json: {
          issueChangeLogs: [
            { issueId: '1', changeHistories: [h('1', 2, 'To Do', 'In Progress'), h('2', 4, 'In Progress', 'Done')] },
            { issueId: '2', changeHistories: [h('3', 3, 'To Do', 'In Progress'), h('4', 5, 'In Progress', 'Done')] },
          ],
        },
      });
    }
    return r.fulfill({ status: 404, headers: cors, json: {} });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Connect Jira' }).click();
  await expect(page.getByRole('heading', { name: 'Connected to Jira' })).toBeVisible();
  await expect(page).toHaveURL('http://localhost:4173/'); // code removed from the address bar
  await expect(page.getByLabel('Project')).toHaveValue('ABC');
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByRole('heading', { name: 'Jira: ABC (acme)' })).toBeVisible();
  await expect(page.locator('.map .node')).toHaveCount(3);
  expect(outside).toEqual([]);
});

test('a callback with a wrong state is rejected', async ({ page }) => {
  await page.route('**/api/jira/config', (r) => r.fulfill({ json: { clientId: 'test-client' } }));
  await page.goto('/?code=stolen&state=nope');
  await expect(page.getByRole('alert')).toContainText('could not be verified');
  await expect(page).toHaveURL('http://localhost:4173/');
});

test('without server config the button explains the CLI', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Connect Jira' })).toBeDisabled();
  await expect(page.getByText('not set up on this site yet')).toBeVisible();
});
