# FlowSnag: notes for Claude

Private, in-browser process mining. Static SPA, **no backend, no database**: process data must never leave the user's browser (only calls to the source system's API, e.g. api.github.com).

## Working rules
* Spec-driven: read `specs/001-mvp/spec.md` (Ukrainian), `plan.md`, `tasks.md` before a feature; tick tasks in `tasks.md` in the same PR. Architecture decisions go to `docs/adr/`.
* UI text is **English only**. Talk to Dmytro (the owner) in Ukrainian.
* Never show per-person metrics or rankings (spec §3). Resources are for filters only, anonymised by default.
* `src/core` stays UI-free and pure so it runs in the Web Worker and in Node (scripts). Use only erasable TypeScript syntax (no enums, no parameter properties) so Node can run it with type stripping.
* Every analysis change needs a Vitest test. Run `npm test` and `npm run build` before pushing.
* No analytics, cookies or third-party scripts in the app without an ADR.
