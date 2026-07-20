# Mihin lounaalle?

A small Finnish lunch recommendation service for the Seinäjoki area. It collects every restaurant returned by Lounaspaikka within 50 kilometres of the fixed centre point, preserves menu revisions in SQLite, and publishes one shared daily top three.

The first version is intentionally narrow: no user accounts, personalization, queues, or separate database service. It has one password-protected operational admin screen.

## How it works

- At startup and every day at 04:15 Europe/Helsinki, the backend refreshes dates from today through Sunday. A Sunday refresh includes the following week.
- An admin can add a public HTTPS restaurant page that is missing from Lounaspaikka. Its menu must be present in the static page text; PDF menus and browser-rendered pages are not supported. The page is extracted into the same dated menu structure and refreshed with the normal daily run.
- Identical menus create a new freshness observation, not a duplicate revision. Changed menus remain available as immutable history.
- When `OPENAI_API_KEY` is set, it extracts custom menu pages and assesses only unseen menu revisions. The model sees menu facts without restaurant identity and returns four conservatively calibrated 0–10 scores plus one short Finnish recommendation rationale.
- OpenAI calls have separate hard request budgets for each startup/scheduled refresh and each admin source-add action. Cached custom-page extractions do not consume budget, and setting a budget to zero blocks calls for that operation.
- Ranking is deterministic: appeal 35%, distinctiveness 25%, variety 20%, and value 20%. Ties are ordered by restaurant ID.
- The admin can label recent immutable assessments as too high or too low. Labels are stored for shared-profile calibration and never act as hidden restaurant penalties or immediate ranking overrides.
- The reader UI is Finnish. OpenAI instructions and all code are English; model rationales are Finnish.

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

## Local development

Requirements: Node.js 24 and npm 11.

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
| `OPENAI_MODEL` | `gpt-5.4-nano` | Model used for structured extraction and assessment. Changing it creates new provenance. |
| `OPENAI_REFRESH_REQUEST_BUDGET` | `100` | Maximum OpenAI requests shared by one startup or scheduled refresh; `0` blocks them. |
| `PORT` | `3000` | Backend HTTP port. |
| `SITE_ADDRESS` | `http://localhost` | Caddy site address and production hostname. |

Before a public launch, confirm that the source publisher's current terms permit the intended automated collection, storage, attribution, and republication of menu content.
