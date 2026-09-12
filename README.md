# Dip Radar 🎯

Dip Radar is a fully dockerized, self-hosted web service that visualizes the percentage distance of BTC-parity altcoins (listed before 2021) from their historical dip points. It features an interactive D3.js bubble chart and a backend that synchronizes data from Binance and CoinGecko.

## Features ✨

- **Interactive Bubble Chart**: Visualizes coins using a D3.js force simulation. Bubble **size represents market cap** (square-root scale) and bubble **color represents the distance from the dip** (green = close, red = far).
- **Dual Reference Points**: Toggle between "Since 2021" (event low) and "All Time Low" (ATL) to see how far coins are from their historical bottoms.
- **Automated Data Sync**: A dedicated APScheduler worker runs daily to fetch the latest daily candles and metadata. A cross-process lock prevents concurrent syncs from the worker and the manual refresh endpoint.
- **Resilient Data Fetching**: Binance requests automatically fall back to the public market-data mirror (`data-api.binance.vision`) when `api.binance.com` is unreachable. No third-party proxies are used; you can still point the app at your own proxy via `HTTP_PROXY`/`HTTPS_PROXY`.
- **Duplicate-free Storage**: Daily candles are upserted on `(symbol, timestamp)`, so re-syncing never duplicates rows and the in-progress candle is updated in place.
- **Local Caching**: SQLite caching (WAL mode) ensures fast load times and respects API rate limits.
- **Dark Mode UI**: Includes a table view, search, sorting, a per-coin price-history chart and automatic status polling during the initial sync.

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

*Note: On the first run, the worker fetches the listing date of every BTC pair and the full daily history of all coins listed before 2021. This normally takes a few minutes; the frontend shows a status screen until the first data arrives.*

## Environment Variables ⚙️

| Variable | Default | Description |
| --- | --- | --- |
| `DB_DIR` | `/data` | Directory for the SQLite database inside the containers. |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins for direct API access. |
| `BACKEND_URL` | `http://localhost:8000` | Backend URL used by the frontend `/api` proxy. Docker Compose sets `http://backend:8000`. |
| `SYNC_REQUEST_DELAY` | `0.15` | Seconds between Binance requests during a sync. |
| `COINGECKO_BATCH_DELAY` | `2` | Seconds between CoinGecko market batches. |
| `LOG_LEVEL` | `INFO` | Python log level for the backend and worker. |
| `HTTP_PROXY` / `HTTPS_PROXY` | unset | Optional proxy for outbound data-provider requests. |

## API Endpoints 🔌

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/coins` | All tracked pre-2021 coins with distances and bubble sizes. |
| `GET` | `/api/coins/{symbol}/history?limit=365` | Most recent daily candles for a coin (ascending). |
| `GET` | `/api/meta` | Last sync time, tracked coin count and whether a sync is running. |
| `POST` | `/api/refresh` | Starts a background sync. Returns `409` if one is already running. |
| `GET` | `/health` | Liveness probe. |

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

- Backend: `cd backend && python -m pytest -q` (metrics, fetcher fallback/upsert logic and API tests).
- Frontend: `cd frontend && npm run lint && npm run build`.
- CI runs all of the above plus Docker image builds on every push and pull request.

## License 📄

MIT License
