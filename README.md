# Dip Radar 🎯

Dip Radar is a fully dockerized, self-hosted web service that visualizes the percentage distance of BTC-parity altcoins (listed before 2021) from their historical dip points. It features an interactive D3.js bubble chart and a backend that synchronizes data from Binance and CoinGecko.

## Features ✨

- **Insight-first scatter chart**: X axis is market cap (log scale), Y axis is the distance from the historical dip. Position now carries meaning: the shaded "watch zone" highlights established coins (≥ $50M cap) that trade within 50% of their dip. Zoom/pan with the mouse, hover for a tooltip, click for details.
- **Color and size encoding**: color runs from green (close to the dip) to red (far) using a robust p90 domain so outliers do not wash out the palette; bubble size also encodes closeness — the closer a coin is to its dip, the bigger its bubble. Volume and exact values are in the tooltip.
- **Ranked "closest to dip" list**: a sidebar leaderboard surfaces the most interesting coins immediately, with quick filters for minimum market cap and volume.
- **Summary strip**: tracked coin count, how many are within 25%/50% of the dip, and the median distance at a glance.
- **Broad coverage**: tracks BTC pairs directly and converts USDT-only pairs to BTC parity using daily BTCUSDT rates. Pre-2021 listings are always included; newer coins (like ICP) are tracked once their market cap passes `MIN_TRACKED_MARKET_CAP` (default $10M).
- **Dual reference points**: toggle between "Since 2021" (event low) and "All Time Low" (ATL).
- **Automated data sync**: a dedicated APScheduler worker runs daily; a cross-process lock prevents concurrent syncs from the worker and the manual refresh endpoint. Live progress (phase + percentage) is reported to the UI.
- **Parallel and verified fetching**: candles are synced with a worker pool (`SYNC_FETCH_WORKERS`, default 4) to cut first-run time, and Binance prices are cross-checked against an independent CoinGecko quote (`PRICE_VERIFY_TOLERANCE_PCT`, default 5%).
- **Resilient data fetching**: Binance requests automatically fall back to the public market-data mirror (`data-api.binance.vision`) when `api.binance.com` is unreachable. No third-party proxies are used; you can still point the app at your own proxy via `HTTP_PROXY`/`HTTPS_PROXY`.
- **Duplicate-free storage**: daily candles are upserted on `(symbol, timestamp)`, so re-syncing never duplicates rows and the in-progress candle is updated in place.
- **Design system**: Tailwind CSS 4 with shared tokens and UI components (buttons, badges, stat cards, segmented controls); table view, search, sorting, detail modal with a 365-day price chart.

## Architecture 🏗️

The project consists of three main Docker containers:

1. **Backend (FastAPI)**: Serves REST API endpoints and handles database queries.
2. **Worker (Python/APScheduler)**: Runs background sync tasks to fetch and process data from Binance and CoinGecko. Includes rate limiting and retries with backoff.
3. **Frontend (Next.js)**: A React-based dashboard that renders the D3.js visualization and proxies `/api/*` requests to the backend, so no CORS configuration is needed.

Data flow:

```
Binance (api.binance.com -> data-api.binance.vision fallback)
        │
        ▼
SQLite (shared volume) ◄── FastAPI backend ◄── Next.js /api proxy ◄── Browser
        ▲
CoinGecko metadata / market caps
```

## Prerequisites 📦

- Docker
- Docker Compose

## Installation & Usage 🚀

1. Clone the repository:

   ```bash
   git clone https://github.com/alikula37/dip-radar.git
   cd dip-radar
   ```

2. (Optional) Copy `.env.example` to `.env` and adjust it.

3. Start the services:

   ```bash
   docker compose up -d --build
   ```

4. Open the dashboard: `http://localhost:3000`

*Note: On the first run, the worker fetches the listing date of every BTC pair and the full daily history of all coins listed before 2021. This normally takes a few minutes; the frontend shows a status screen until the first data arrives. Existing databases from older versions are migrated automatically on startup.*

## Environment Variables ⚙️

| Variable | Default | Description |
| --- | --- | --- |
| `DB_DIR` | `/data` | Directory for the SQLite database inside the containers. |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins for direct API access. |
| `BACKEND_URL` | `http://localhost:8000` | Backend URL used by the frontend `/api` proxy. Docker Compose sets `http://backend:8000`. |
| `SYNC_REQUEST_DELAY` | `0.15` | Seconds between Binance requests during a sync. |
| `SYNC_FETCH_WORKERS` | `4` | Concurrent workers used while fetching candle history. |
| `PRICE_VERIFY_TOLERANCE_PCT` | `5` | Max deviation from CoinGecko before a price is flagged unverified. |
| `MIN_TRACKED_MARKET_CAP` | `10000000` | Post-2021 coins below this market cap are not price-tracked (pre-2021 coins are always tracked). |
| `COINGECKO_BATCH_DELAY` | `2` | Seconds between CoinGecko market batches. |
| `LOG_LEVEL` | `INFO` | Python log level for the backend and worker. |
| `API_KEY` | unset | Optional. When set, `/api/*` requires a matching `X-API-Key` header. The frontend proxy adds it automatically. |
| `RATE_LIMIT_PER_MINUTE` | `120` | Per-client request limit for `/api/*` (0 disables). |
| `HTTP_PROXY` / `HTTPS_PROXY` | unset | Optional proxy for outbound data-provider requests. |

## API Endpoints 🔌

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/coins` | All tracked pre-2021 coins with distances and bubble sizes. |
| `GET` | `/api/coins/{symbol}/history?limit=365` | Most recent daily candles for a coin (ascending). |
| `GET` | `/api/meta` | Last sync time, tracked coin count and whether a sync is running. |
| `POST` | `/api/refresh` | Starts a background sync. Returns `409` if one is already running. |
| `GET` | `/health` | Liveness probe. |

When `API_KEY` is configured, every `/api/*` request must include an `X-API-Key` header. The bundled frontend proxies requests server-side and adds the header for you.

## Development 🛠️

Backend (Python 3.11+):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest -q
uvicorn main:app --reload
```

Frontend (Node.js 20.9+):

```bash
cd frontend
npm ci
npm run dev
```

## Troubleshooting 🔧

- **No data appearing?** Check the worker logs:
  ```bash
  docker compose logs -f worker
  ```
- **Binance unreachable (`SSL: WRONG_VERSION_NUMBER`)?** This usually means the provider is blocked or redirected by your network. Dip Radar automatically retries against `data-api.binance.vision`; if the whole Binance domain is blocked, configure your own proxy via `HTTP_PROXY`/`HTTPS_PROXY` in `.env`.
- **"A sync is already in progress" (HTTP 409)?** The worker is already syncing. Wait for it to finish; progress is shown by `GET /api/meta`.

## Testing ✅

- Backend: `cd backend && python -m pytest -q` (metrics, migrations, fetcher fallback/upsert/conversion logic and API tests).
- Frontend: `cd frontend && npm run lint && npm test && npm run build`.
- CI runs all of the above plus Docker image builds on every push and pull request. Dependabot keeps dependencies fresh and Trivy scans the images (advisory).

## License 📄

MIT License
