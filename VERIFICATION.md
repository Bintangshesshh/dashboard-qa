# Verification record

## Latest review supersedes earlier acceptance claims

See [whole-system review](REVIEW.md). Backend now passes 11/11 tests with PostgreSQL. Draft-protection regression and static report rendering/download browser checks pass. Earlier forced-WebSocket-failure claim below was overbroad: test reloaded into read-only mode before inducing failure, so no authenticated socket was attempted. Strengthened full-workbench test now passes: BOTH f6b1876d-8313-4258-9079-070986deb240 and Lighthouse-only f9037d35-6521-4598-906f-12f2ca8d1296, attempted WebSocket forced closed, exact replay equality and actual cookie-only logout. Report HTTP 200 alone did not establish rendering; separate Chromium static rendering/download checks now cover that. Historical results below are retained as chronology, not current end-to-end acceptance.

## User-reported defects reproduced in follow-up
- Port 3000 WebSocket /ws did not upgrade; direct backend /ws replay worked. Earlier API integration did NOT cover production UI proxy.
- Port 3000 Docusaurus link returned 404 after trailing slash normalization; direct backend report returned 200.
- Proxy fix verified on production URL port3000: 15 identical ordered replay logs versus backend, Docusaurus HTTP200. Local startup now web/server.mjs with native upgrade forwarding.
- Backend regression: 8 passed with PostgreSQL, including slash-safe authenticated report serving.
- Docusaurus regression: two actual production builds passed, recursive failure locations, native artifact bundle contents, source exclusion, and missing-tar fallback.
- Workbench full browser acceptance PASS: BOTH run 38437ee6-c38c-4047-a42c-3062b6beb6e5; Lighthouse-only zero-case run 0c90b845-f565-4d18-a74d-8327eabea848. Actual UI clicks, visible phase logs, same-origin reports HTTP200, reload persistence, forced WS failure HTTP replay, no page errors or mobile overflow.
- Final production build/typecheck PASS; separate smoke PASS including hamburger open/close and desktop/mobile screenshots.
- Earlier completion claim was too broad for UI integration. Require actual browser clicks Run, native logs, report open, and Lighthouse-only run before accepting revision.


## Verified locally
- Node 22.21.1; Next registry stable 16.4.2 installed.
- PostgreSQL portable 18.4 UTF8 database used for actual integration.
- Backend node:test: 7 passed, 0 failed, 0 skipped with TEST_DATABASE_URL. Includes real Playwright generated TypeScript execution, auth, CRUD, WebSocket replay/live, cancellation, redirect allowlist, database persistence.
- Docusaurus actual production build regression passed, including escaped hostile input and artifact source exclusion.
- Real combined run 00405d1d-c5b3-4343-a141-51c93d59247b: Playwright browser/API passed; LHCI completed; Docusaurus built and authenticated report fetched successfully. Test harness then failed parsing valid HTTP 204 DELETE; harness fixed and full rerun in progress.
- Next production build and typecheck passed before mobile sidebar CSS fix; rebuild and browser smoke in progress.
- Compose YAML parsed successfully. Docker executable unavailable locally; image build and Compose runtime NOT verified.

## Remaining
- Combined integration FINAL PASS: run e473c67e-cee9-492b-840a-c7e955fe2193, exit 0; Playwright browser/API + LHCI + Docusaurus + authenticated serving + WebSocket + CRUD delete all passed.
- Final Next production build/typecheck PASS. Browser smoke PASS: authentication, responsive layout, mobile hamburger open/close, no overflow and no page errors. Screenshots web/preview-desktop.png and web/preview-mobile.png captured; model image inspection unavailable.
- Review visual-baseline management limitation, artifact retention, native offline report download usability.
- Verify deployment config consistency, complete handoff and final source tree.
- Do not claim full production readiness until remaining checks resolved or explicitly reported.
