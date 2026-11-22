# FlowSnag

**See how your process really flows.** FlowSnag turns an event log (Jira, GitHub pull requests or any CSV) into a process map: which steps work really goes through, where it waits, and where it goes back. Everything runs in your browser; your data is never uploaded.

> Status: early MVP, work in progress.

## What it shows

* **Three findings first:** where most time is spent, the most common return, the most skipped step.
* **Process map** (directly-follows graph): box colour = median time in the step, arrow width = number of cases, detail slider to hide rare paths.
* **Paths** (variants) with their share and cycle time; click one to see only those cases.
* **Returns** (rework) and the **cycle time** distribution.
* **Filters** by any extra column and by the period in which cases started.
* **Export** the map as SVG or PNG with a legend, ready for a retro or a report.
* **Resources are anonymised** ("Person 1…N") unless you choose to show names. FlowSnag never ranks people.

## Data sources

| Source | How |
|---|---|
| CSV / paste from Excel | one row per step: `case_id, activity, timestamp`, optional `resource` and any other columns. Columns and date format are guessed and can be changed. |
| GitHub pull requests | enter `owner/repo`. Without a token about 50 recent PRs (GitHub's 60 requests/hour); with a read-only token up to 500. The token stays in the tab and goes only to `api.github.com`. |
| XES | standard process mining event logs (`.xes`, `.xes.gz`); with start/complete pairs the complete events are used. |
| Demo | synthetic software team board, 400 issues. |
| Jira Cloud | **Connect Jira** (Atlassian sign-in, read-only), pick a site, project and period, or write JQL. Issues load straight from `api.atlassian.com`; only the sign-in code passes our server ([ADR 0002](docs/adr/0002-jira-token-worker.md)). |
| Jira via CLI (Cloud or Data Center) | `JIRA_EMAIL=… JIRA_API_TOKEN=… npm run jira -- --site acme.atlassian.net --jql "project = ABC AND created >= -180d"` or `JIRA_PAT=… npm run jira -- --dc https://jira.example.com --jql "…"`, then drop the CSV on the page. Names are anonymised unless `--names`. |

### The `xray-log` format

```csv
case_id,activity,timestamp,resource,case_type
INV-1001,Received,2026-03-02T09:14:00Z,system,invoice
INV-1001,Checked,2026-03-02T11:40:00Z,o.koval,invoice
INV-1001,Approved,2026-03-04T16:05:00Z,m.schmidt,invoice
```

Timestamps without a time zone are read as UTC.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run e2e        # browser tests (Playwright), after npm run build
npm run build      # type check + production build into dist/
```

Code map: `src/core` (format, CSV, analysis; no UI), `src/connectors` (GitHub), `src/ui` (React), `src/demo` (demo data), `specs/` (spec, plan, tasks), `docs/adr` (decisions).

Pre-built GitHub demos: run the **Build GitHub demo data** action, or locally `GITHUB_TOKEN=... npm run demo:github -- vitejs/vite 100`.

## Deploy (Cloudflare Workers, static assets)

Cloudflare dashboard → Workers & Pages → Create → Import a repository → this repository. Build command `npm run build`, deploy command `npx wrangler deploy`, path `/`. `wrangler.jsonc` tells Cloudflare to serve `dist/` as static assets (no Worker code) with a single-page-app fallback. Node version comes from `.nvmrc` (22). Every push to `main` then deploys; other branches get preview URLs. Add the custom domain under the Worker's *Settings → Domains & Routes*.

`public/_headers` (copied to `dist/`) sets a Content Security Policy: the page may only connect to itself and `api.github.com`. Add a source system's API there when a new connector needs it.

## Jira sign-in setup (once, by the site owner)

1. [developer.atlassian.com/console/myapps](https://developer.atlassian.com/console/myapps/) → Create → OAuth 2.0 integration, name "FlowSnag".
2. Permissions → Jira API → add the classic scope **`read:jira-work`**.
3. Authorization → callback URL **`https://flowsnag.app/`** (add the `*.workers.dev` URL too if you test there).
4. Distribution → Sharing: enable, fill in the vendor and personal-data details, so any Jira site can connect.
5. Settings → copy Client ID and Secret. In Cloudflare: Worker *flowsnag* → Settings → Variables and Secrets → add **secrets** `JIRA_CLIENT_ID` and `JIRA_CLIENT_SECRET`. Redeploy is not needed.

Until this is done the "Connect Jira" button is disabled and points to the CLI.

## License

MIT
