# Tasks: FlowSnag MVP

Legend: [x] done, [ ] to do. Each slice is one PR.

## Slice 1: CSV, map, GitHub (PR #1)
- [x] T01 Project setup: Vite + React + TypeScript, Vitest, CI on GitHub Actions
- [x] T02 `xray-log` event model (`src/core/types.ts`)
- [x] T03 CSV parsing, delimiter detection, column guessing, date formats, row errors (`src/core/csv.ts`)
- [x] T04 Cases, directly-follows graph, time stats, variants, returns, cycle time, insights (`src/core/analyze.ts`)
- [x] T05 Map simplification by detail level (`processMap`)
- [x] T06 Analysis in a Web Worker (`src/core/worker.ts`, `useAnalysis`)
- [x] T07 Synthetic demo dataset (`src/demo/synthetic.ts`)
- [x] T08 GitHub PR connector: REST without token, GraphQL with token, clear rate-limit errors
- [x] T09 UI: import screen, column mapping, analysis view with map, paths, returns, histogram
- [x] T10 Script + Action to pre-build GitHub demo datasets

## Slice 2: export, filters, XES
- [ ] T11 Export map as SVG and PNG with legend (FR-12)
- [ ] T12 Filters: attribute values and period (FR-10)
- [ ] T13 Resource anonymisation by default, "Person 1…N" (FR-13)
- [ ] T14 XES import (FR-03), BPI Challenge demo
- [ ] T15 GitHub demo datasets selectable on the start screen
- [ ] T16 Playwright e2e in CI: demo, CSV, GitHub (mocked), "no requests to our domain" (FR-14)

## Slice 3: Jira
- [ ] T17 Jira OAuth 3LO in the browser + Cloudflare Worker for the token exchange
- [ ] T18 Jira changelog → xray-log (pagination, status names, issue types)
- [ ] T19 `npx flowsnag jira` CLI for big exports and Data Center

## Slice 4: launch
- [ ] T20 Flow animation (FR-11)
- [ ] T21 Cookieless counter (Plausible/Umami, names of actions only)
- [ ] T22 Privacy page, Impressum, Datenschutzerklärung
- [ ] T23 Deploy to Cloudflare Pages, then own domain
