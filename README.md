# Mihin lounaalle?

A small Finnish lunch recommendation service for the Seinäjoki area. It collects every restaurant returned by Lounaspaikka within 50 kilometres of the fixed centre point, preserves menu revisions in SQLite, and publishes one shared daily top three.

The first version is intentionally narrow: no accounts, personalization, admin UI, queues, or separate database service.

## How it works

- At startup and every day at 04:15 Europe/Helsinki, the backend refreshes dates from today through Sunday. A Sunday refresh includes the following week.
- Identical menus create a new freshness observation, not a duplicate revision. Changed menus remain available as immutable history.
- When `OPENAI_API_KEY` is set, only unseen menu revisions are assessed. The model returns four 0–10 scores and one short Finnish recommendation rationale.
- Ranking is deterministic: appeal 35%, distinctiveness 25%, variety 20%, and value 20%. Ties are ordered by restaurant ID.
- The reader UI is Finnish. OpenAI instructions and all code are English; model rationales are Finnish.

## Run with Docker Compose

1. Copy `.env.example` to `.env`.
2. Set `OPENAI_API_KEY` in `.env` to enable recommendations.
3. Start the service:

```sh
docker compose up -d --build --wait
```

Open [http://localhost](http://localhost). Menu collection still runs without an OpenAI key, but the recommendation section remains pending.

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
| `DATABASE_PATH` | `data/lunch.sqlite` | SQLite file path; Compose sets `/data/lunch.sqlite`. |
| `OPENAI_API_KEY` | empty | Enables assessment and top-three generation. |
| `OPENAI_MODEL` | `gpt-5.4-nano` | Model used for structured assessments. Changing it creates new assessment provenance. |
| `PORT` | `3000` | Backend HTTP port. |
| `SITE_ADDRESS` | `http://localhost` | Caddy site address and production hostname. |

Before a public launch, confirm that the source publisher's current terms permit the intended automated collection, storage, attribution, and republication of menu content.
