# Whole-system review — 2026-10-20

## Fixed findings

- High: suite/case PATCH used read-then-upsert, risking lost concurrent changes and resurrection after DELETE. Store.patch now locks current row in a transaction and performs UPDATE only. Real PostgreSQL regression checks concurrent independent fields and missing-row non-resurrection. Same-field edits remain last-write-wins; no optimistic edit conflict UI.
- High: new suite/case and Lighthouse target changes could discard unsaved drafts. Shared discard guard and beforeunload protection added; isolated browser regression passed.
- Medium: cookie-only sessions could not disconnect. Narrow logout authorization and frontend exception added; proxy now preserves public Host, including port. Actual same-origin proxy logout returned 200. Cookie CRUD and cross-site logout remain forbidden.
- Medium: WebSocket disconnect during awaited lookup leaked runner listeners. Closed connection guard and regression added.
- Medium: restart during report generation overwrote completed test outcome. Execution and documentation recovery now separate.
- Medium: terminal scrolled to bottom on empty polling responses. Empty merges preserve state; auto-follow respects user scroll position.
- Medium: Docusaurus returned 200 but CSS/JS were blocked by ORB under opaque sandbox and Strict cookie. Generated index now embeds CSS and removes hydration scripts. Screenshots use download links. Sandbox remains; HttpOnly SameSite=Lax permits authenticated top-level download navigation while mutations still require bearer authorization. Two existing reports rebuilt and Chromium-verified, including archive downloads.
- Low: Docker docs routing lacked slashless report redirect. Relative 308 added; Docker runtime remains untested.

## Verification

- Backend: 11/11 tests passed, including actual PostgreSQL and generated Playwright TypeScript case.
- Production Next build and typecheck passed.
- Draft protection/read-only logout browser regression passed with isolated mocked API; no stored user suites touched.
- Report regression: actual Docusaurus builds, escaping, artifact archive, missing-tar fallback and static sandbox browser rendering passed.
- Real reports: styled content, no Docusaurus loading warning, native details toggle, successful artifacts.tar.gz downloads.
- Full workbench final PASS: BOTH f6b1876d-8313-4258-9079-070986deb240; Lighthouse-only f9037d35-6521-4598-906f-12f2ca8d1296. WebSocket interception now registered before navigation; actual attempted connection, forced close, exact ordered HTTP replay/terminal equality, mobile layout and real cookie-only logout verified. Earlier run failed during concurrent report rebuilding with stale cross-run links; concurrency root cause remains under review.
- Final proxy smoke: 25 identical replay logs through backend and web proxy; report HTTP 200. Draft regression rerun passed.

## Requirement and verification gaps

- Category → suite → case hierarchy and category CRUD remain absent. Current implementation has suite → case only.
- Custom modal lacks full keyboard focus containment; accessibility follow-up required.
- Full visual baseline promotion/versioning, retention, corporate SSO/RBAC, and multi-worker execution are not implemented.
- Logs replay is unbounded at API/database layer; UI caps rendered entries at 3,000. History lists cap at 500 without pagination.
- Docker image build and Compose startup remain unverified.
- Generated web/.next output and web/tsconfig.tsbuildinfo were already tracked in Git; ignore rules do not untrack them. No index cleanup performed during this review.
- Old reports not explicitly rebuilt still use previous generated markup.

## Scope

Source review plus local-only checks. No company-site execution. Existing local smoke suite preserved. No secrets read from .env. Trusted developer code still executes with runner privileges; target allowlist is not a sandbox.
