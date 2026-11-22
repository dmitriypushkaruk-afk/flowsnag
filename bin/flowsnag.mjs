#!/usr/bin/env node
// FlowSnag CLI: export Jira status history as an xray-log CSV, then drop the file on the FlowSnag page.
// Runs on your machine; the token never leaves it. Needs Node 22.18+ (runs the TypeScript connector directly).
//
//   Jira Cloud (API token from https://id.atlassian.com/manage-profile/security/api-tokens):
//     JIRA_EMAIL=you@example.com JIRA_API_TOKEN=... npx flowsnag jira --site your.atlassian.net --jql "project = ABC AND created >= -180d"
//   Jira Data Center / Server (personal access token):
//     JIRA_PAT=... npx flowsnag jira --dc https://jira.example.com --jql "project = ABC"
//
// Options: --out file.csv (default jira-<timestamp>.csv), --limit N (default 5000), --names (keep real names).
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { jiraLog } from '../src/connectors/jira.ts';
import { anonymizeResources } from '../src/core/filters.ts';
import { toXrayCsv } from '../src/core/csv.ts';

const [command, ...rest] = process.argv.slice(2);
if (command !== 'jira') {
  console.log('Usage: flowsnag jira (--site <name>.atlassian.net | --dc <url>) --jql "<query>" [--out file.csv] [--limit 5000] [--names]');
  process.exit(command ? 1 : 0);
}
const { values } = parseArgs({
  args: rest,
  options: {
    site: { type: 'string' },
    dc: { type: 'string' },
    jql: { type: 'string' },
    out: { type: 'string' },
    limit: { type: 'string', default: '5000' },
    names: { type: 'boolean', default: false },
  },
});
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
if (!values.jql) fail('Missing --jql, for example --jql "project = ABC AND created >= -180d ORDER BY created ASC"');

let auth;
if (values.dc) {
  if (!process.env.JIRA_PAT) fail('Set JIRA_PAT to a personal access token for Jira Data Center.');
  auth = { kind: 'datacenter', baseUrl: values.dc, token: process.env.JIRA_PAT };
} else if (values.site) {
  if (!process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) fail('Set JIRA_EMAIL and JIRA_API_TOKEN for Jira Cloud.');
  auth = { kind: 'basic', site: values.site, email: process.env.JIRA_EMAIL, apiToken: process.env.JIRA_API_TOKEN };
} else {
  fail('Give --site <name>.atlassian.net (Cloud) or --dc <url> (Data Center).');
}

try {
  let events = await jiraLog(auth, {
    jql: values.jql,
    limit: Number(values.limit),
    onProgress: (phase, done, total) => process.stderr.write(`\r${phase === 'issues' ? 'Issues' : 'History'}: ${done}${total ? `/${total}` : ''}   `),
  });
  // Same default as the app: people become "Person 1…N" unless --names is given.
  if (!values.names) events = anonymizeResources(events);
  const out = values.out ?? `jira-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  writeFileSync(out, toXrayCsv(events));
  const cases = new Set(events.map((e) => e.caseId)).size;
  console.error(`\nWrote ${events.length} events from ${cases} issues to ${out}`);
} catch (e) {
  fail(`\n${e.message ?? e}`);
}
