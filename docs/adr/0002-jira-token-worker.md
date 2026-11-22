# ADR 0002: One tiny Worker for the Jira OAuth token exchange

*Status: accepted · 22.11.2026 · amends ADR 0001 ("no backend")*

## Context
Jira Cloud's REST API allows browser calls (CORS) on `api.atlassian.com` with an OAuth 2.0 (3LO) access token. Getting that token needs the authorization code to be exchanged **with a client secret**, and Atlassian does not support PKCE. A secret cannot live in a static page. API tokens (Basic auth) don't work from the browser at all: `*.atlassian.net` has no CORS.

## Decision
* The site is deployed as a Cloudflare Worker with static assets. The Worker script (`worker/index.ts`) runs **only** for `/api/*` (`run_worker_first`) and has two routes:
  * `GET /api/jira/config` returns the public client id (or `null` when not configured);
  * `POST /api/jira/token` checks the `Origin` and that the redirect URI is our own origin, adds the secret, exchanges the code with Atlassian and returns only `accessToken`, `expiresIn`, `scope`.
* It keeps no state, has observability/logging off, requests no `offline_access` (no refresh token), and never sees issues: the browser loads them from `api.atlassian.com` directly. The access token lives only in React state.
* OAuth `state` is random per sign-in, stored in `sessionStorage` and checked on return; the code is removed from the address bar immediately.
* `JIRA_CLIENT_ID` and `JIRA_CLIENT_SECRET` are Worker **secrets** set in the Cloudflare dashboard, so deploys don't overwrite them.
* The CSP allows `connect-src` to `api.atlassian.com` in addition to GitHub.
* Large exports and Jira Data Center go through the CLI (`bin/flowsnag.mjs`) with the user's own token on their machine; it shares the connector code with the browser.

## Consequences
* The privacy promise becomes: "issue data never touches our server; only the one-time sign-in code passes through it". The privacy page must say exactly this.
* Until Atlassian reviews the app, all users share 65,000 rate-limit points per hour (jira-api.md §3). The picker caps a load at 5,000 issues; heavy users are pointed to the CLI.
