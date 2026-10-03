# Goal improvement state

## Starting state and boundaries

- Started 2026-10-03; revision `9533ebc9255ed3c641c70cd143337359db276726`, branch `main`.
- Staged, unstaged, and untracked Git state was clean. Existing ignored `.env`, caches, dependencies, and scratch files are preserved and not used as fixtures.
- Single agent. Local changes only; no commits, publishing, deployment/auth policy changes, live collection, or paid API calls.
- PowerShell; Node 24.4.1, npm 11.4.2. Installed dependencies work but Node is below the documented 24.15 minimum; report this verification limitation.
- No applicable on-disk AGENTS.md or ADRs found. Follow the supplied global instructions and goal.
- SQLite tests use `:memory:` or dedicated temporary directories. Browser preview will use an in-memory synthetic database and localhost only, without `server.ts` startup jobs or environment credentials.

## Product and journeys

Finnish-only responsive React/Vite reader and Fastify/SQLite backend. Preserve the existing local wayfinding visual system in `frontend/DESIGN.md`.

1. Choose lunch: open today, compare full menus and shared top three, view sources/criteria, open route.
2. Plan another day: previous/next/today, open a restaurant week, return with date context.
3. Recover: failed/empty/stale data and invalid restaurant links.
4. Operate: sign in, inspect freshness/errors, add a source, label assessment calibration, refresh, sign out.

## Baseline

- `npm test`: PASS, backend 42 tests / 16 files, frontend 25 tests / 3 files.
- `npm run typecheck`: PASS both workspaces.
- `npm run build`: PASS. CSS 45.83 kB (8.95 gzip); reader JS 213.03 kB (66.34 gzip); lazy admin JS 17.94 kB (5.18 gzip).
- Git commands need per-command `-c safe.directory=C:/Users/Juha/Desktop/Projektit/lounaspaikka-recommendations` under the sandbox account; no global configuration changed.
- Skills read/applied: diagnosing-bugs; improve-codebase-architecture + codebase-design (sequential self-assessment); end-user-ui-ux; impeccable audit/harden with product register and context script; tdd. User-authorized workflow adjustments apply.

## Ranked working backlog

All confirmed items below are complete. Evidence and checks are recorded by batch.

| Priority | Finding / evidence | Acceptance | Confidence / effort / risk |
| --- | --- | --- | --- |
| P1 | Restaurant URL decoding can throw before rendering; missing restaurant returns a generic retry-only error. | Malformed/unknown links show a useful recovery path; transient failures remain retryable. | High / small / low |
| P1 | Admin source draft is local to dashboard, so session expiry unmounts and loses it. Failed source processing tells operator to check overview without refreshing it. | Input survives sign-in recovery; persisted source failure appears without a manual refresh; no duplicate submission. | High / medium / medium |
| P1 | Scheduled and admin publication overlap and attempt to insert the same immutable assessment. | Both runs succeed without duplicate provider work; rejection does not block the next run. | Confirmed by regression / small / medium |
| P2 | Daily list covers a 50 km catchment but offers no way to find a restaurant, area, or dish. | Quickly narrow existing menus, clear a no-result query, retain ranking/menu detail and date context. Confirm in browser. | Medium / medium / low |
| P2 | Restaurant week fetches all restaurants and parses every assessment seven times before selecting one restaurant. Admin loads snapshots for every assessed historical date before limiting to eight. | Measure representative synthetic workload, reduce unnecessary reads/parsing, preserve snapshot semantics, versions and disabled sources. | High / medium / medium |

## Decisions / test surfaces

- UI: render `App` / `AdminPage`, simulate user actions at the HTTP boundary; browser checks against real local Fastify and SQLite with synthetic external adapters.
- Backend: public reader HTTP routes, offering snapshot/read interfaces and admin overview against disposable SQLite. Benchmark those same read interfaces.
- No production dependencies, new services, speculative caches or indexes. No schema change unless measurement establishes a need.
- Source collection, immutable history, ranking, request budgets, external HTTP bounds, and auth are covered by existing tests; continue assessment of uncovered behavior.

## Completed batches

### 1. Broken restaurant link recovery

- Reproduced malformed percent encoding with `npm test -w frontend -- --run src/App.test.tsx -t 'malformed restaurant'`: failed with URIError before render.
- Reproduced missing restaurant with `npm test -w frontend -- --run src/App.test.tsx -t 'missing restaurant and'`: recovery heading absent, generic network retry shown.
- Fixed route decoding, typed HTTP status errors, and a Finnish not-found screen returning to the selected day. Updated the existing route test's old crash expectation to the intended recovery contract.
- `npm test -w frontend -- --run src/App.test.tsx src/navigation.test.ts`: PASS 21 tests. Existing network retry and weekly navigation tests remain green.
- Browser: localhost real API 404 at 390x844 shows recovery, clicking it returns to 2026-10-03 menus. `before-missing.jpg`, `after-missing-mobile.jpg`.
- Diagnosis phases 3/4 were unnecessary: the deterministic stack trace directly identifies unguarded URI decoding; no instrumentation required.

### Baseline browser observations

- Synthetic fixture: 32 restaurants / 7 days, all generated through real ingestion and assessment interfaces, no external calls.
- At 390x844: 32 rows, document height 12,929 px, no horizontal overflow, no search. `before-mobile.jpg`.
- Desktop 1440x1000: coherent three-column comparison; preserve it. `before-desktop.jpg`.
- Week navigation works; route link omits town when the source supplies separate address/city fields. `before-week-mobile.jpg`. Add city to display and routing while avoiding duplication.
- Audit: accessibility 3/4 (good semantics/focus, missing-link gap); performance 3/4 (lean lazy admin, database amplification); responsive 3/4 (no observed overflow, long list difficult); theming 3/4 (established tokens with legacy overrides); anti-patterns 4/4 (distinctive functional identity). No redesign justified. Next commands: harden recovery and clarify finding menus; final targeted polish.

### 2. Admin recovery without lost source input

- Red tests demonstrated source URL loss after 401/relogin and absent diagnostics after a persisted 422 source-processing failure.
- Lifted only the source draft to the page so it survives dashboard unmount on session expiry. Explicit logout and successful source addition clear it; no persistent storage or auth policy change.
- Processing failure refreshes the overview automatically while preserving the failed URL and its error.
- `npm test -w frontend -- --run src/AdminPage.test.tsx src/App.test.tsx`: PASS 26 tests. `npm run typecheck -w frontend`: PASS.
- Real browser/Fastify/SQLite: synthetic failed extraction appears in sources/errors immediately; shared-session logout in a second tab triggers 401; re-login restores the draft; resubmitting successfully stores a synthetic source and clears its input. Evidence: `after-source-failure-desktop.jpg`, `after-session-recovery-desktop.jpg`.
- Preview now uses real custom-source persistence with synthetic page fetch/extraction. It never calls external hosts, regardless of the entered URL.
- Additional observed friction: source form follows 30 full calibration assessments, requiring a long scroll. Add compact in-page navigation as part of the scoped findability pass.

### Performance baseline

- `node work/goal-improvement/benchmark.mjs`: 80 synthetic restaurants x 63 dates; in-memory SQLite; 5 warmups, 25 timed reads. `performance-before.json`.
- Week read median 3.682 ms, p95 4.063 ms. Admin overview median 10.734 ms, p95 11.723 ms. These are local synthetic measurements, not production latency.
- Preserve output hashes and existing latest-success/source-version semantics during optimization.

### 3. Coordinate overlapping recommendation publication

- Added a public publication-interface regression with real custom-source persistence, disposable SQLite and a controllable synthetic assessor.
- `npm test -w backend -- --run test/recommendation-publication.test.ts -t 'overlapping scheduled'`: failed twice; exact cause `SQLITE_CONSTRAINT_UNIQUE` inserting the same immutable assessment from overlapping scheduled/admin runs. Rejected hypotheses: budget exhaustion and extraction validation.
- Publication instance now sequences its two entry points. Each run retains its own request budget, dates, and outcome; a rejected run does not prevent subsequent work. No auth, database schema, ranking, or deployment changes.
- A source-add request during publication can wait for the current bounded run; existing reader requests continue normally. This coordination is per process, matching the existing single-process deployment; it is not a distributed lock.
- Targeted publication/recommendations/refresh/custom-source suite: PASS 14 tests. Typecheck exposed use of `Promise.withResolvers` in the new test beyond the project's ES lib; replaced it with ordinary promises, without changing compiler configuration.
- Recheck: backend typecheck PASS; publication suite PASS 4 tests.

### 4. Find menus and reach operational tasks

- Red tests: separate town missing from day/week directions; search control absent; source failure still advertised as ready. Implemented a single address formatter, case-insensitive multi-word local menu search, and honest operational status.
- Search matches restaurant, address, town and published dish text; results retain their actual rank and complete menus. It makes no additional requests, has a live result count, clear action with focus restoration, and preserves input through date changes/retry. No dietary claims inferred from search.
- Scoped UI direction: existing tokens, native input and links, compact label above the list; first recommended menu remains in the 390x844 viewport. No new motion or dependencies. Only Finnish is maintained, using existing inline-copy conventions.
- Admin in-page navigation jumps to calibration/source form/sources/errors. Heading targets accept focus; Tab from the source heading reaches its input.
- `npm test -w frontend`: PASS 33 tests; frontend typecheck PASS. Subsequent focused search checks cover hiding dietary guidance when no menus match.
- Browser: desktop/mobile admin navigation, source heading keyboard handoff, sign-out; search `ILMAJOKI kuhaa` narrows 32 rows to 3 and 12,929 px to 2,045 px of content (query-specific, same synthetic data). Town appears in displayed address and generated Maps destination. 320px no-results/clear returns focus with no horizontal overflow.
- Evidence: `after-mobile.jpg`, `after-search-mobile.jpg`, `after-empty-search-320.jpg`, `after-admin-mobile.jpg`, `after-admin-navigation-desktop.jpg`. Desktop search / larger text / full navigation checks still pending.

### 5. Bound restaurant and admin read work

- Week queries now request seven snapshots for the selected restaurant together and parse only its assessments. Reuses the shared latest-success snapshot logic and menu serializer.
- Admin queries request snapshots eight dates at a time until eight active assessment dates are found. Retains older valid results behind unassessed replacements; a simple SQL LIMIT would incorrectly hide them.
- No schema, index, cache, retention, or HTTP response contract changes. Existing immutable history and versions remain intact.
- `npm test -w backend -- --run test/http-app.test.ts test/ingestion.test.ts test/custom-sources.test.ts test/daily-offering-snapshot.test.ts`: PASS 11 tests. Admin/snapshot suite then PASS 3 tests, including additional week checks for failed fetch fallback, replacement, disabled custom sources, and removal by a later empty success.
- One new assertion needed optional array access for strict TypeScript; corrected after typecheck reported it and verified by the final full checks.
- Same 80 x 63 workload: week median 3.682 -> 0.221 ms (p95 4.063 -> 0.343); admin 10.734 -> 3.801 ms (p95 11.723 -> 4.163). First reads: week 4.812 -> 0.710 ms, admin 13.111 -> 4.933 ms. `performance-after.json`.
- A second fresh process measured medians 0.274 / 3.775 ms and p95 0.502 / 5.144 ms. All before/after output hashes match exactly (excluding uptime, fixed current time). Measurements are local synthetic read costs, not production latency. No storage savings claimed.

### Final UI verification and self-review

- Browser checks used real local Fastify/SQLite and synthetic external adapters. Checked 320x740, 390x844, 768x1024 and 1440x1000; no horizontal overflow in the exercised states. These are viewport checks, not physical-device or assistive-technology certification.
- Day -> restaurant week -> following empty week -> previous week -> day preserves date context. Offline emulation shows retry; restoring connectivity and retrying restores the menus. Final network check: one successful day API request; search generated none; no console warnings/errors in the final capture.
- Admin: sign-in, feedback save and refresh persistence, source-add success/failure, automatic error overview, expired-session draft recovery, explicit sign-out, keyboard section navigation, and newly added menu visible in the reader. Source-add reader fixture deliberately leaves that menu unassessed to exercise partial data.
- Doubled computed text sizes exposed a 91px-wide search input at 390px. Flexible wrapping now keeps it 351px wide; checked screenshot `after-text-200-mobile.jpg`. Also checked doubled text at 768px. This is simulated text scaling, not browser zoom. All temporary styles/emulation reset afterward.
- Reduced-motion emulation gives the search input a 0.00001s transition, matching the existing global rule. No new animations.
- Pending assessment wording no longer claims generation is running: the API's `pending` only means published menus have no active recommendation set. Focused `honest pending` regression was red, then green. Finnish remains the only maintained locale.
- Latest screenshots include `after-search-desktop.jpg`, `after-week-empty-tablet.jpg`, `after-text-200-mobile.jpg`, `after-empty-search-320.jpg`, and `after-source-reader-mobile.jpg`; earlier before/after evidence is retained beside this file.
- Applied code-review as sequential self-review: standards (global instructions, README, PRODUCT/DESIGN and local conventions), then spec (goal and batch acceptance). Reviewed unstaged and new files against the clean starting revision. No remaining actionable findings in the combined change; no subagents or external publication.

## Final checks and coverage

- `npm test`: PASS, backend 44 tests / 16 files; frontend 33 tests / 3 files (77 total, baseline 67).
- `npm run typecheck`: PASS both workspaces, including corrected optional array access.
- `npm run build`: PASS both. CSS 46.45 kB / 9.09 gzip; reader JS 215.38 / 67.03; lazy admin JS 18.55 / 5.33. Small feature cost; admin still loaded separately. No added dependencies.
- `git -c safe.directory=C:/Users/Juha/Desktop/Projektit/lounaspaikka-recommendations diff --check`: PASS. Git reports existing Windows LF/CRLF conversion notices; no line-ending-only rewrite.
- Applicable area coverage: reader/admin task completion, loading/empty/error/partial states, input preservation, semantic controls/focus, keyboard/touch sizing, responsive/text/motion, request/bundle/read performance, database snapshots/indexes/constraints/immutable history, publication concurrency/budgets, parameterized input handling and sanitized operational errors, external timeouts/size/redirect limits, and local test setup.
- Database migration tests cover existing fresh/upgrade behavior. No migrations, caches, new indexes, retention changes, auth policies, infrastructure, or deployment changes were needed. Persistent data was not accessed.
- Architecture changes reuse snapshot/menu interfaces and coordinate the existing publication boundary. Existing extraction caches, schema constraints, and external request bounds had no confirmed in-scope defect requiring another change.
- Local preview and benchmark instructions are in README's "Isolated synthetic preview" section. Review with the ordinary working-tree diff plus `work/goal-improvement` (new evidence files).

## Blocked / deferred

- Real source and model integration intentionally not exercised: requires external access/paid requests; use synthetic adapters.
- Runtime version differs from documented minimum; do not install/upgrade host infrastructure.
- Manual browser checks used the available Chromium-based in-app browser. Other engines, physical touch devices, screen-reader announcements, and production latency remain unverified.
- Publication coordination is process-local. Multiple backend processes would need coordination if that deployment model is introduced; no distributed service was added.

## Next action

Complete. The synthetic API and Vite process sessions have exited. Windows listener enumeration was denied in the sandbox; a direct localhost TCP check instead confirmed ECONNREFUSED on both test ports (3000/5173). Temporary browser tab and viewport/emulation overrides are cleared. No containers, persistent databases, commits, or external writes were created. Local source changes, reproducible fixtures, and evidence remain for review; no feasible high-priority backlog items remain.
