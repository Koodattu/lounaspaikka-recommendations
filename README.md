# Mihin lounaalle?

A small Finnish lunch recommendation service for the Seinäjoki area. It collects every restaurant returned by Lounaspaikka within 50 kilometres of the fixed centre point, preserves menu revisions in SQLite, and compares all assessed lunches in one daily ranking.

The first version is intentionally narrow: no user accounts, personalization, separate job queue, or separate database service. It has one password-protected operational admin screen.

## How it works

- At startup and every day at 04:15 Europe/Helsinki, the backend refreshes dates from today through Sunday. A Sunday refresh includes the following week.
- An admin can add a public HTTPS restaurant page that is missing from Lounaspaikka. Its menu must be present in the static page text; PDF menus and browser-rendered pages are not supported. The page is extracted into the same dated menu structure and refreshed with the normal daily run.
- Custom-page fetches have a 15-second total deadline, including DNS, redirects, and response reading. An unchanged page can reuse an earlier extraction covering all requested dates, even after a refresh for fewer dates; source, content, model, and prompt versions must match.
- Identical menus create a new freshness observation, not a duplicate revision. Changed menus remain available as immutable history.
- Failed updates keep the last successful menu. Daily menus and restaurant weeks identify the affected source/date, the failed attempt, and the previous observation; an unsuccessful first fetch is distinct from an unpublished menu.
- When `OPENAI_API_KEY` is set, it extracts custom menu pages and assesses only unseen menu revisions. The model sees menu facts without restaurant identity and returns four conservatively calibrated 0–10 scores plus one short Finnish recommendation rationale.
- OpenAI calls have separate hard request budgets for each startup/scheduled refresh and each admin source-add action. Cached custom-page extractions do not consume budget, and setting a budget to zero blocks calls for that operation.
- Scheduled publication and admin source addition run one at a time within the backend process to avoid assessing the same unseen revision twice. A source-add request can wait for the current publication; reader requests remain available.
- Ranking is deterministic: appeal 35%, distinctiveness 25%, variety 20%, and value 20%. Assessments without an actual extracted lunch course are excluded; ties are ordered by restaurant ID.
- Daily rows show every available overall score and rationale, up to three main-course highlights, and a prominent lunch price. Full source menus remain in `Koko ruokalista` and the restaurant week. Component scores remain available to the admin; the existing top-three API field and immutable sets are retained for compatibility.
- Assessment prompt v6 / schema v5 adds selected main-course indices, adult EUR lunch price bounds, explicit vegetarian/vegan main availability, and coffee inclusion. Unknown facts stay null. Side dishes and ambiguous `V` markers cannot establish vegetarian suitability; prices exclude children's, member-only and takeaway/kg offers. Fixed, ranged and from prices remain distinct. Provider output is bounded at 2,400 tokens to accommodate the existing 32-course limit plus these facts; request budgets are unchanged.
- Reader queries prefer current assessments and can retain prompt v5 / schema v4 data for the exact same revision, profile, rubric and model until normal refresh enriches it. Historical scores are not erased by the rollout; changed menus never inherit an old score. This uses the existing JSON column without a database migration.
- The admin can label recent immutable assessments as too high or too low. Labels are stored for shared-profile calibration and never act as hidden restaurant penalties or immediate ranking overrides.
- Calibration search matches restaurant names and menu text locally. The selected review date and search survive refresh, reload and session recovery through the admin URL; feedback results appear beside the assessment.
- In `Lisätyt ravintolat`, `Hae uudelleen` retries an enabled custom source using the same bounded, serialized workflow as adding its URL. It preserves an unrelated source-form draft and reports the result beside that source.
- `Poista käytöstä` stops a custom source's scheduled collection and removes its menus from reader views. `Ota käyttöön` restores eligibility without fetching; retry explicitly or wait for collection. History and feedback are retained. Source changes share the publication queue and rebuild current dates using cached assessments only, with zero model requests. A disabled URL cannot be reactivated by submitting it as a new source. Active fetch health excludes disabled sources; their historical errors remain visible.
- If enabled menus still lack assessments, recommendations remain pending until normal assessment succeeds; changing source state never spends the model budget to fill those gaps.
- The reader UI is Finnish. OpenAI instructions and all code are English; model rationales are Finnish.
- Readers can search the selected day's full menus by restaurant, town, address, or dish. Search preserves the shared ranking and stays applied when changing dates, visiting a restaurant, and returning. The optional `q` in the page URL also restores search after reload or when sharing the link.
- Returning from a restaurant week focuses that restaurant in the daily list after it loads, preserving comparison position as well as date and search. Missing or filtered-out restaurants do not receive focus.
- Readers can sort by overall score or cheapest stated adult lunch price, and filter for explicitly stated vegetarian/vegan mains. Unknown prices sort last; absent diet information is not treated as absence of an option. Search, `sort=price`, and `diet=vegetarian|vegan` survive date changes, reload and restaurant return. Price ranges compare their lower bound; they do not promise that every dish costs that amount.
- `Valitse päivä` jumps directly to a date in the daily list or a restaurant's week. `Kopioi linkki` copies the selected date, search, sort and diet filter so another reader can open the same view. If clipboard access is unavailable, a selected link field supports manual copying. Links show the latest stored menus for that date, not a frozen snapshot.
- Restaurant weeks also provide seven direct day buttons. Switching within the loaded week needs no extra API request and keeps the selected date, shared link, and return to recommendations aligned; all other days remain available for comparison below.

## Run with Docker Compose

1. Copy `.env.example` to `.env`.
2. Set `OPENAI_API_KEY` in `.env` to enable recommendations and custom page extraction.
3. Set a unique `ADMIN_PASSWORD` of at least 16 characters to enable `/admin`.
4. Start the service:

```sh
docker compose up -d --build --wait
```

Open [http://localhost](http://localhost). Lounaspaikka collection still runs without an OpenAI key, but recommendations and custom page extraction are disabled.

The admin screen is intentionally not linked from the reader UI. Open `/admin` directly and sign in with `ADMIN_PASSWORD`. The session lasts eight hours and is cleared when the backend restarts. Use HTTPS for every public deployment.

Treat calibration feedback as a review dataset: collect a balanced set of labels, identify restaurant-name-free menu patterns, update the explicit rubric or shared profile, and increment its version. A version change triggers reproducible reassessment; feedback itself does not silently alter published scores.

For production, set `SITE_ADDRESS` to a DNS name such as `lounas.example.fi`, point that name at the host, and allow inbound TCP 80/443. Caddy then obtains and renews HTTPS certificates automatically.

SQLite data is stored in the `lunch_data` volume. Back up that volume before host migration or destructive Docker maintenance. Do not use `docker compose down -v` unless deleting the stored history is intentional.

### Established production release

This repository's `origin/main` is deployed to [lounas.koodattu.dev](https://lounas.koodattu.dev/) on the existing `vaarattu-server` SSH target. The VM's `koodattu-auto-deploy.timer` checks for changes five minutes after its preceding run finishes. It fast-forwards the clean checkout under `/srv/projects/lounaspaikka-recommendations`, validates Compose with the existing deployments-repository override, builds, and waits for container health. There is no GitHub Actions workflow or test gate on the VM: run `npm test`, `npm run typecheck`, `npm run build`, and review the complete staged diff **before pushing to main**.

After a normal push, follow the existing timer instead of starting a second deployment. Verify `/var/lib/koodattu-auto-deploy/lounaspaikka-recommendations.state` contains the released commit, check the app containers and [public health endpoint](https://lounas.koodattu.dev/api/health), and exercise safe reader flows. The state record also includes the deployments-repository revision. A Git push or updated server checkout alone does not prove that new containers are healthy.

The runner records only successful deployments and retries failures. Inspect `journalctl -u koodattu-auto-deploy.service` before a corrective release. There is no generic database rollback; preserve volumes and shared infrastructure. An older application may need rebuilding if its image was pruned. Prefer a history-preserving corrective commit through the same workflow, and do not undo somebody else's newer release.

## Local development

Requirements: Node.js 24.15 or newer in the 24.x release line and npm 11.

```sh
npm install
npm test
npm run typecheck
npm run build
```

Run the built backend and the Vite frontend in separate terminals:

```sh
npm run build -w backend
npm start -w backend
```

```sh
npm run dev -w frontend
```

The backend defaults to `data/lunch.sqlite` and port 3000. Vite proxies `/api` to it.

### Isolated synthetic preview

To review reader and admin journeys without external collection or model calls, use the in-memory preview instead of the normal backend:

```sh
npm run build -w backend
node work/goal-improvement/preview.mjs
```

In a second terminal:

```sh
npm run dev -w frontend -- --host 127.0.0.1 --strictPort
```

Open [the fixture day](http://127.0.0.1:5173/?date=2026-10-03). The fixture has 32 fictional restaurants for 28 September–4 October 2026. At `/admin`, use `local-preview-only-password`. Source URLs ending in `/failure` simulate failed extraction; other URLs add a synthetic menu without fetching the URL. Stop both commands with Ctrl+C; restarting the preview resets its database.

Use `node work/goal-improvement/preview.mjs --planning` for varied daily dishes, an unpublished Sunday, long content, and a custom source with failed updates. Retrying that source from admin succeeds for the currently requested dates, while older failed dates retain their warning. This mode uses the same isolated in-memory database and synthetic adapters.

Run `node work/goal-improvement/benchmark.mjs` after building the backend to repeat the isolated read benchmark. Measurements, verification details, and screenshots are in [the improvement work log](work/goal-improvement/STATE.md).

## Reader API

- `GET /api/health`
- `GET /api/days/:serviceDate`
- `GET /api/restaurants/:restaurantId/weeks/:monday`

Dates use `YYYY-MM-DD`. Restaurant weeks must start on a Monday.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | empty | Enables `/admin`; must contain at least 16 characters. |
| `DATABASE_PATH` | `data/lunch.sqlite` | SQLite file path; Compose sets `/data/lunch.sqlite`. |
| `OPENAI_API_KEY` | empty | Enables custom page extraction, assessment, and top-three generation. |
| `OPENAI_ADMIN_SOURCE_REQUEST_BUDGET` | `20` | Maximum OpenAI requests for one admin source-add action; `0` blocks them. |
| `OPENAI_MODEL` | `gpt-6-luna` | Model used for structured extraction and assessment. Changing it creates new provenance. |
| `OPENAI_REFRESH_REQUEST_BUDGET` | `100` | Maximum OpenAI requests shared by one startup or scheduled refresh; `0` blocks them. |
| `PORT` | `3000` | Backend HTTP port. |
| `SITE_ADDRESS` | `http://localhost` | Caddy site address and production hostname. |

Before a public launch, confirm that the source publisher's current terms permit the intended automated collection, storage, attribution, and republication of menu content.
