# ADR 0001: Static app, no backend

*Status: accepted · 22.11.2026*

## Context
The project's default stack (Next.js + PostgreSQL) assumes a server. FlowSnag's main promise is that process data never leaves the user's browser, and the first version is a portfolio showcase that should cost nothing to run.

## Decision
* Static single-page app: **Vite + React + TypeScript**. No server rendering, no database.
* Analysis is plain TypeScript in `src/core`, free of UI code, run in a **Web Worker**.
* CSV with **Papa Parse**; map layout with **@dagrejs/dagre**, drawn as **SVG**.
* Tests: **Vitest** for the core, **Playwright** for end-to-end.
* Hosting: **Cloudflare Pages** (free `*.pages.dev` until the domain is bought). The only server code allowed later is one stateless Cloudflare Worker that exchanges the Jira OAuth code for a token.

## Consequences
* Zero running cost, trivial to verify the privacy promise in DevTools.
* Large logs are limited by the browser's memory (target: 50k events comfortably).
* Anything needing storage (accounts, saved reports) is out of scope until a new ADR.
