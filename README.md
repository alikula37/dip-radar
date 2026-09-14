# Dip Radar 🎯

Dip Radar is a fully dockerized, self-hosted web service that visualizes the percentage distance of BTC-parity altcoins (listed before 2021) from their historical dip points. It features an interactive D3.js bubble chart and a backend that synchronizes data from Binance and CoinGecko.

## Features ✨

- **Answer-first leaderboard (default view)**: ranks coins by how close they are to their dip — or by how fast they are falling toward it — with distance bars, required drop to the low, 7d/30d trends, market cap and volume in one scannable list (top 10 with a one-click expand).
- **Scatter map (optional view)**: X axis is market cap (log), Y axis is the distance from the historical dip on a symlog scale clipped at the 95th percentile; extreme outliers are pinned to the top as ▲ markers instead of squashing the cluster. Watch-zone shading, collision-aware labels, hover tooltip, zoom/pan and click-through remain.
- **Color and size encoding**: color runs from green (close to the dip) to red (far) using a robust p90 domain so outliers do not wash out the palette; bubble size also encodes closeness — the closer a coin is to its dip, the bigger its bubble. Volume and exact values are in the tooltip.
- **Ranked "closest to dip" list**: a sidebar leaderboard surfaces the most interesting coins immediately, with a "falling toward dip" mode based on 7-day price movement and quick filters for minimum market cap and volume.
- **Trend, sharing and export**: 7d/30d trend badges in the chart tooltip and table, shareable URL state for filters/views and CSV export of the filtered list. A default ≥ $1M volume filter keeps dead coins out of the way.
- **Historical "as of" view**: pick any date and the dashboard recomputes prices, lows, distances and 7d/30d trends as of that day (daily candles, UTC). Market caps intentionally stay current, and the watchlist/alerts always reflect live values.
- **Dip-distance history**: the detail modal charts how a coin's distance from its dip evolved over time (running lows), sharing the 90d/1y/All range picker and the as-of marker with the price chart.
- **Transparent filtering**: a "showing X of Y tracked coins · hidden by …" line explains exactly which filter (stables, listing date, market cap, volume, watchlist, search) removes coins, with a one-click reset — so a coin like UNI never silently disappears from the lists.
- **Stablecoin & pegged-asset filter**: stablecoins, tokenized gold and similar pegged assets are detected from CoinGecko categories (`stablecoins`, `tokenized-gold`) plus a symbol/name heuristic for unmapped coins, and hidden by default with a one-click "Stables hidden" toggle (URL: `stables=1` shows them).
- **Valuation percentile & Value Score**: beyond distance-to-dip, every coin is measured against its own history — valuation percentile (1y/3y/all: share of days spent above today's price), distance from the 3-year median, range position (ATL→ATH), basing (% of the last 90 days spent in the bottom price quartile) and 90-day trend. A transparent 0–100 Value Score (liquidity/history gated, component breakdown in the tooltip, knife-risk penalty for free-falls) surfaces coins that are cheap without being falling knives — including coins that are >100% away from their 2021 low yet in the cheapest 10% of their 3-year range (e.g. SAND). The design was validated with a quarterly 90-day-forward backtest: distance-to-dip had the strongest cross-sectional IC, valuation percentile was a close second, and trend was ambiguous, so it only acts as a penalty.
- **Leaderboard modes**: Closest · Falling · **Cheapest** (switchable 1y/3y/all valuation window) · **Basing at lows**.
- **Distribution strip**: the coin modal shows where today's price sits inside the 3-year distribution (P05–P95 band with a "You are here" marker) plus signal chips (3y percentile, range position, basing, ATL age, 200-day trend gate).
- **Custom reference windows and listing filters**: compute distances against "Since 2021", the all-time low, or any custom start date (`Custom` picker); filter the universe by listing era (before 2021 / 2021+); the detail chart switches between 90d, 1y and all history.
- **Watchlist and alerts**: star coins from the table or the detail modal and set per-coin dip thresholds. After each sync the worker checks the watchlist and notifies you through a webhook and/or Telegram when a coin crosses below its threshold (no repeat spam while it stays below).
- **Four views and comparison**: leaderboard, scatter map, treemap (area = market cap, color = distance) and a sortable table. Up to three coins can be compared on a log-scaled relative-performance chart (start = 1x) with hover/tap readouts of exact multiples and percentage changes; the current chart can be exported as PNG. The modal's 365-day price chart and dip-distance chart share 90d/1y/All ranges and an as-of marker.
- **Summary strip**: tracked coin count, how many are within 25%/50% of the dip, and the median distance at a glance.
- **Broad coverage**: tracks BTC pairs directly and converts USDT-only pairs to BTC parity using daily BTCUSDT rates. Pre-2021 listings are always included; newer coins (like ICP) are tracked once their market cap passes `MIN_TRACKED_MARKET_CAP` (default $10M).
- **Dual reference points**: toggle between "Since 2021" (event low) and "All Time Low" (ATL).
- **Automated data sync**: a dedicated APScheduler worker runs daily; a cross-process lock prevents concurrent syncs from the worker and the manual refresh endpoint. Live progress (phase + percentage) is reported to the UI.
- **Parallel and verified fetching**: candles are synced with a worker pool (`SYNC_FETCH_WORKERS`, default 4) to cut first-run time, and Binance prices are cross-checked against an independent CoinGecko quote (`PRICE_VERIFY_TOLERANCE_PCT`, default 5%).
- **Resilient data fetching**: Binance requests automatically fall back to the public market-data mirror (`data-api.binance.vision`) when `api.binance.com` is unreachable. No third-party proxies are used; you can still point the app at your own proxy via `HTTP_PROXY`/`HTTPS_PROXY`.
- **Duplicate-free storage**: daily candles are upserted on `(symbol, timestamp)`, so re-syncing never duplicates rows and the in-progress candle is updated in place.
- **Design system**: Tailwind CSS 4 with shared tokens and UI components (buttons, badges, stat cards, segmented controls); self-hosted Inter/JetBrains Mono via Fontsource (no build-time font downloads); table view, search, sorting, detail modal with price history and range pickers.

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
| `ALERT_THRESHOLD_PCT` | `20` | Default dip-distance threshold for watched coins without their own value. |
| `ALERT_WEBHOOK_URL` | unset | Optional webhook that receives alert JSON payloads. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | unset | Optional Telegram bot used to deliver alerts. |
| `HTTP_PROXY` / `HTTPS_PROXY` | unset | Optional proxy for outbound data-provider requests. |

## API Endpoints 🔌

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/coins` | Tracked coins with distances and bubble sizes. Optional `?low_from=YYYY-MM-DD` recomputes the event low from a custom start date; `?as_of=YYYY-MM-DD` returns a historical snapshot (price, lows, distances and trends up to that day). |
| `GET` | `/api/coins/{symbol}/history?limit=365` | Most recent daily candles for a coin (ascending, max 5000). |
| `GET` | `/api/coins/{symbol}/dip-history?limit=365` | Running distance-from-dip series for a coin (lows computed as of each day). |
| `GET` | `/api/meta` | Last sync time, tracked coin count and whether a sync is running. |
| `POST` | `/api/refresh` | Starts a background sync. Returns `409` if one is already running. |
| `GET` | `/api/watchlist` | Watched coins with distances, thresholds and last alert time. |
| `POST` | `/api/watchlist/{symbol}` | Adds or updates a watched coin (`{"threshold_pct": 20}`). |
| `DELETE` | `/api/watchlist/{symbol}` | Removes a coin from the watchlist. |
| `GET` | `/health` | Liveness probe. |

When `API_KEY` is configured, every `/api/*` request must include an `X-API-Key` header. The bundled frontend proxies requests server-side and adds the header for you.

### HTTPS with Caddy (optional) 🔒

The compose file ships an optional [Caddy](https://caddyserver.com/) reverse proxy that terminates TLS automatically:

```bash
DOMAIN=radar.example.com docker compose --profile proxy up -d --build
```

Point `DOMAIN` at a hostname that resolves to your server and Caddy will obtain a Let's Encrypt certificate on first start; keep the default (`localhost`) for local testing with Caddy's internal CA. Ports 80/443 are exposed by the proxy while the frontend keeps its 3000 mapping for direct access.

## Development 🛠️

Backend (Python 3.11+):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
ruff check .          # lint
python -m pytest -q   # tests
uvicorn main:app --reload
```

The repo also ships a `.pre-commit-config.yaml` (ruff + basic hygiene hooks); install it with `pip install pre-commit && pre-commit install`.

Frontend (Node.js 20.9+):

```bash
cd frontend
npm ci
npm run dev
```

Need data without hitting the providers? `cd backend && python demo_seed.py` inserts five deterministic demo coins with 180 days of candles (the E2E job in CI uses the same script).

## Troubleshooting 🔧

- **No data appearing?** Check the worker logs:
  ```bash
  docker compose logs -f worker
  ```
- **Binance unreachable (`SSL: WRONG_VERSION_NUMBER`)?** This usually means the provider is blocked or redirected by your network. Dip Radar automatically retries against `data-api.binance.vision`; if the whole Binance domain is blocked, configure your own proxy via `HTTP_PROXY`/`HTTPS_PROXY` in `.env`.
- **"A sync is already in progress" (HTTP 409)?** The worker is already syncing. Wait for it to finish; progress is shown by `GET /api/meta`.

## Testing ✅

- Backend: `cd backend && ruff check . && python -m pytest -q` (metrics, migrations, fetcher fallback/upsert/conversion/verification logic, alerts and API tests).
- Frontend: `cd frontend && npm run lint && npm test && npm run build`.
- End-to-end (Playwright, requires a running dashboard): `cd frontend && E2E_BASE_URL=http://localhost:3000 npm run test:e2e`. CI starts the stack, seeds demo data and runs this suite automatically.
- CI runs backend lint + tests, frontend lint + tests + build, the Playwright suite against a seeded stack, and Docker image builds with a blocking Trivy scan for critical CVEs. Dependabot keeps dependencies fresh.

## License 📄

MIT License
