// Builds a ready-made GitHub demo (public/demo/*.csv) so visitors don't spend their API quota.
// Usage: GITHUB_TOKEN=... node scripts/build-github-demo.mjs vitejs/vite 100
//   or, where `gh` is signed in: USE_GH=1 node scripts/build-github-demo.mjs vitejs/vite 100
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { githubLog } from '../src/connectors/github.ts';

const [repo = 'vitejs/vite', limitArg = '100'] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;

/** fetch() look-alike that goes through the GitHub CLI. */
function ghFetch(url) {
  const path = url.replace('https://api.github.com/', '');
  const body = execFileSync('gh', ['api', path], { maxBuffer: 64 * 1024 * 1024 }).toString();
  return Promise.resolve(
    new Response(body, { status: 200, headers: { 'x-ratelimit-remaining': '5000', 'content-type': 'application/json' } }),
  );
}

const events = await githubLog(repo, {
  token,
  rest: true,
  state: 'closed',
  limit: Number(limitArg),
  fetch: process.env.USE_GH ? ghFetch : undefined,
  onProgress: (d, t) => process.stdout.write(`\r${d}/${t} PRs`),
});
const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const lines = ['case_id,activity,timestamp,label'];
for (const e of events) lines.push([e.caseId, e.activity, new Date(e.timestamp).toISOString(), e.attrs?.label ?? ''].map(esc).join(','));
mkdirSync('public/demo', { recursive: true });
const file = `public/demo/github-${repo.replace('/', '-')}.csv`;
writeFileSync(file, lines.join('\n') + '\n');
console.log(`\nWrote ${events.length} events to ${file}`);
