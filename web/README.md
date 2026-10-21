# QA Dashboard (web) — implementation log

Port of the static `ui/` mock into the real `web/` Next.js app, per `PANDUAN-UI.md`.

Decisions taken (questions 1–3, all option **a**):
1. Full port: 4 views (Overview, Runs, Failures, Projects), donut, 14-day chart, runs table, failure cards, project grid, detail drawer.
2. Real API data from `/api/runs` + `/api/suites` (no seed 20261020 mock). Fields the backend does not expose are derived or left empty — never invented.
3. Modular: `app/page.tsx` = shell + view routing; `app/_components/*.tsx` = views; `app/qa-model.ts` = derivations; `app/qa-dashboard.css` = view styles on top of `shell.css`.

## Field mapping (backend → dashboard)

| Dashboard field | Source | Note |
|---|---|---|
| project | `suiteName` | matched against `jaja`/`masdis`/`ebh`, else first word |
| flaky | — | always 0; backend has no retry counter |
| spec / browser | `run.error` | parsed from the error text when present, else `null` |
| duration | `finishedAt` − `startedAt` | `null` while queued/running |
| passed / failed | `run.summary` | 0 while the run has no summary yet |

## Preserved

- Workbench views (Playwright / Lighthouse / Reports) stay reachable alongside the four QA views.
- `web/ui-check.mjs` selectors: `Connect workspace`, `Operator token`, `Live execution terminal`, `Toggle sidebar`, `Suite navigation`.
- `output: "standalone"`, empty basePath.
