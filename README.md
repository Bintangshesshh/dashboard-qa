# QA Automation Dashboard

English, light-theme dashboard for a trusted development team. Next.js App Router + TypeScript + Tailwind, SQLite, Playwright, Lighthouse CI, live WebSocket logs, and per-run Docusaurus reports.

## Security boundary

**Test authors can execute arbitrary Node.js code on the runner. This is not a sandbox or a public SaaS.** Only give accounts to trusted developers. Deploy the runner on an isolated VM/container with restricted egress, no company credentials outside the target test account, no Docker socket, and no production database access. The URL allowlist validates the configured target; it cannot constrain arbitrary submitted code. Browser subresources on other origins may require adding those origins.

Accounts are stored in SQLite. The first registered account becomes an administrator; later registrations become members. Administrators can manage accounts from the Users view and can use every workspace feature. Members can use the QA workspace but cannot open account management. Registration is open by default so the first administrator can be created; create all required accounts, then set `ALLOW_REGISTRATION=false` and restart the backend. Existing accounts can still sign in, and an administrator can promote, demote or remove them from the Users view. Do not expose a registration-enabled instance to an untrusted network: registering grants access to run arbitrary test code.

This is application-level authentication, not corporate SSO. Put SSO/VPN or another access gateway in front of a shared deployment. Do not expose the backend directly. Production requires HTTPS. The HttpOnly session cookie uses SameSite=Lax; unsafe API requests additionally require the per-session CSRF token returned by the auth endpoint. Sessions expire after seven days and are removed on sign-out. Logs, traces, screenshots, and native HTML reports can contain secrets and private data; retain and distribute them accordingly.

## Project map

- web/app/ — responsive dashboard, account entry, suite/case editor, run details, terminal
- web/components/AuthDialog.tsx — sign-in and registration dialog
- web/components/UsersView.tsx — administrator account management
- web/next.config.mjs — standalone deployment and local API rewrites
- server/index.mjs — account/session API, REST resources, WebSocket subscriptions, report serving
- server/auth.mjs — scrypt password hashing, session cookies, CSRF and request authentication
- server/store.mjs — SQLite schema, accounts, sessions and persistence
- server/runner.mjs — process execution, cancellation, artifacts, documentation trigger
- server/validation.mjs — request validation and target allowlist
- scripts/build-run-docs.mjs — isolated per-run Docusaurus production build
- docusaurus/run-report-page.jsx — escaped, factual failure report
- scripts/local-fixture.mjs — safe local verification target
- scripts/verify-dashboard.mjs — live integration check
- scripts/test-run-docs.mjs — real report-build regression check
- eureka/ — preserved legacy test suites; not automatically imported or executed
- scripts/cek.mjs, gabung.mjs, doc.mjs — preserved legacy command-line workflow
- Dockerfile, docker-compose.yml, deploy/ — container deployment and gateway
- ecosystem.config.js — PM2 alternative

## Prerequisites

Node.js 22.5+ (or 24+, where `node:sqlite` no longer needs the flag), npm. No database server is required: accounts, sessions and history are stored in one SQLite file. Linux servers need Playwright browser system dependencies. Docker deployment includes them. The existing root Playwright version and Docker Playwright image must remain aligned.

Install from lockfiles:

~~~sh
npm ci
cd server && npm ci && cd ..
cd web && npm ci && cd ..
cd docusaurus && npm ci && cd ..
npx playwright install chromium
~~~

Linux without Docker:

~~~sh
npx playwright install --with-deps chromium
~~~

Copy .env.example to .env only if you do not already have .env. Merge dashboard keys into an existing file without losing legacy credentials.

Set `DATABASE_URL`, `TARGET_ALLOWLIST` (comma-separated exact origins), `RUNS_DIR`, `COOKIE_SECURE`, and optionally `ALLOW_REGISTRATION`. `DATABASE_URL` accepts `sqlite:./data/qa.db`, `file:/data/qa.db` or a plain path; the required directory is created automatically and startup creates the tables. Use an absolute path such as `sqlite:/data/qa.db` for services, and back up that single file (plus any `-wal`/`-shm` siblings) instead of running a database server. Registration is open unless `ALLOW_REGISTRATION=false`.

## Run locally

In separate terminals from project root:

~~~sh
node --env-file=.env server/index.mjs
npm run dev --prefix web
~~~

Open http://127.0.0.1:3000, choose **Create account**, and register. The first account becomes the administrator. Later accounts join as members unless an administrator changes their role. Local npm dev/start uses web/server.mjs, which forwards HTTP and WebSocket upgrades explicitly. Do not launch plain next start for local use: the earlier rewrite-only setup did not forward the terminal connection correctly. Docker keeps the standalone Next server behind the explicit Nginx gateway. API listens on 127.0.0.1:3001 by default. Local HTTP uses COOKIE_SECURE=false; never use that setting on an exposed deployment. Do not commit .env.

### First test

1. Start the local target: node scripts/local-fixture.mjs.
2. Add http://127.0.0.1:4173 to TARGET_ALLOWLIST and restart the backend.
3. Create an account and sign in.
4. Create a suite with that target URL.
5. Add a case using the editor and save it.
6. Select Playwright, choose Headless, and run.
7. Watch native stdout/stderr in the terminal. Open the report after its build finishes.

Case example:

~~~ts
import { test, expect } from '@playwright/test';

test('local action works', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading')).toHaveText('QA verification fixture');
  await page.getByRole('button', { name: 'Run action' }).click();
  await expect(page.getByRole('status')).toHaveText('Action completed');
  const response = await request.get('/api/health');
  expect(response.ok()).toBeTruthy();
});
~~~

Developer writes assertions; dashboard stores, edits, organizes and runs them. CRUD does not infer business requirements automatically. Use relative URLs with the suite baseURL. Existing repository suites can be copied into cases after removing host-specific imports and secrets. Keep reusable complex suites in version control.

Headed launches Chromium on the **runner machine**, not inside the dashboard. It works on a laptop with a desktop session. Headless is the default for Linux containers. Remote interactive desktop/noVNC is not included. Both modes stream real terminal output.

## Reports

Use the Reports navigation to open completed Docusaurus reports. The terminal shows separate target, Playwright, Lighthouse and documentation-build phases. Lighthouse audits do not require a Playwright test case.

Every execution stores its own metadata, logs and artifacts under RUNS_DIR/<run-id>. After tests, an isolated Docusaurus build creates docs/. Reports include observed errors, failed steps where present in source reports, Lighthouse audit details, screenshot links, native reports, and trace download instructions. No invented root-cause diagnosis. A failed test and a failed documentation build are distinct states.

The builder accepts node scripts/build-run-docs.mjs <run-directory>. REPORT_BASE_URL defaults to /reports/<uuid>/docs/. Only logs and artifacts are published; submitted source snapshots are not copied into the public report tree. See docusaurus/RUN-REPORTS.md for details.

## Accounts and administration

- The first registered account is an administrator. All later accounts are members by default.
- Administrators see the **Users** navigation item and can promote, demote or remove accounts.
- Members can use suites, cases, categories, runs and reports, but cannot manage accounts.
- The last administrator cannot be demoted or removed, and an administrator cannot remove their own account from the UI.
- Passwords are hashed with scrypt. Sessions use opaque, HttpOnly cookies; only a SHA-256 hash of each session token is stored.
- Signing out deletes the server session. Removing an account also deletes that account's sessions.
- To stop public sign-ups after onboarding, set `ALLOW_REGISTRATION=false` and restart the backend. Create every required account first; account management currently has no administrator "invite" form.

## Docker Compose handoff

Docker Engine + Compose plugin required on the destination server. Docker is not required for local Node development.

1. Set TARGET_ALLOWLIST in .env. Leave registration enabled for first boot, create the administrator and any member accounts, then set ALLOW_REGISTRATION=false.
2. For production set COOKIE_SECURE=true. Terminate HTTPS at the company reverse proxy.
3. Run docker compose config to validate configuration.
4. Run docker compose up -d --build.
5. Check docker compose ps and docker compose logs -f backend.
6. Open the dashboard through the gateway, create the first administrator and any member accounts, then disable registration.
7. Proxy the dedicated subdomain to http://127.0.0.1:8080 with WebSocket upgrades enabled. Do not expose ports 3000, 3001, or the docs service publicly.

Compose runs web, backend, docs and gateway. Docusaurus is built by the runner after each run; the docs service serves the resulting static files read-only. The SQLite database and run artifacts use separate named volumes. Gateway protects reports with an authentication subrequest. Browser security sandbox headers isolate executable native reports from dashboard credentials; some native report interactivity may require downloading artifacts and opening offline.

For a localhost-only HTTP Docker preview, set COOKIE_SECURE=false and keep the gateway bound to 127.0.0.1. Production headed mode needs an explicitly managed display server; use headless by default.

## PM2 alternative

Install dependencies, browser/system dependencies first. Configure .env, then:

~~~sh
npm run build --prefix web
npm install --global pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
~~~

Follow the command printed by pm2 startup on Linux. On Windows, configure a company-approved startup service instead. PM2 runs one backend instance: it owns one execution slot. Do not use cluster mode or scale backend replicas without adding a distributed queue and worker locks.

Route the public subdomain through the company reverse proxy: /api and /ws to 127.0.0.1:3001; /reports to the same backend (authenticated); other paths to 127.0.0.1:3000. Preserve the Cookie header, CSRF header and WebSocket upgrades. PM2 backend serves reports directly, so a separate static docs process is unnecessary. Apply TLS and the report CSP headers from deploy/gateway.conf.

## Verification

~~~sh
npm test --prefix server
node scripts/test-run-docs.mjs
npm run build --prefix web
~~~

With local fixture and backend running, run:

~~~sh
node scripts/verify-dashboard.mjs
~~~

The integration check registers a temporary account (or uses `VERIFY_EMAIL` and `VERIFY_PASSWORD` for an existing account), creates temporary suite/case records, executes real Playwright, checks account cookies, live logs, SQLite history, authenticated Docusaurus serving and CRUD deletion. It preserves run history/artifacts as test evidence. `VERIFY_MODE=both` also executes Lighthouse. Do not aim this check at a company production target.

Additional local UI checks are in `web/ui-check.mjs`, `web/workbench-check.mjs`, `web/draft-check.mjs` and `web/proxy-check.mjs`. They register a temporary account by default or use `QA_EMAIL`/`QA_PASSWORD` when set.

## Operations and known boundaries

- Categories and suite/case organization are implemented, including empty-category visibility and category-aware search.
- Dialogs trap focus, restore focus on close, and handle Escape; destructive actions ask for confirmation.
- Reports are static Docusaurus exports: CSS is embedded, JavaScript hydration is removed, and native details/download links remain usable under the report sandbox. Native Playwright/Lighthouse reports are for offline viewing. Older reports need rebuilding to receive this rendering fix.
- See REVIEW.md for the whole-system review, tested fixes, and remaining verification gaps.
- Back up the SQLite database file (with any `-wal`/`-shm` siblings) and back up the run volume. Stop the backend or use `sqlite3 qa.db ".backup copy.db"` for a consistent copy. Restore both to recover accounts, sessions, history and artifacts.
- No automatic artifact retention is enabled yet. Monitor disk growth and define a company retention policy before shared deployment; do not delete active run directories.
- Use one backend process. Runs are serialized and conflicting starts return a clear error.
- Keep target credentials in dedicated test accounts, never embedded in case code or screenshots.
- Do not run mutating production tests without explicit business approval.
- Playwright visual assertions are available, but baseline promotion/versioning needs a repository workflow; do not treat a missing screenshot baseline as a passed test.
- Docker deployment must be validated on the destination Linux host. A source configuration is not proof of successful deployment.
