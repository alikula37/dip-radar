# Configuration

Everything is optional: the stack runs with sane defaults and **no API keys**.

## Ports

The stack publishes two host ports, both overridable so an occupied port never
blocks an install: `FRONTEND_PORT` (default 3000) and `BACKEND_PORT` (default
8000). Either set them in `.env` or let the installer pick free ones:

```bash
./scripts/install.sh        # finds free ports, writes .env, docker compose up -d --build
```

If you change `FRONTEND_PORT`, keep `CORS_ORIGINS` in sync (it only matters for
direct backend calls — the frontend proxies `/api` internally).

## Environment variables

Copy `.env.example` to `.env` and adjust as needed; docker compose picks it up
automatically.

| Variable | Default | Description |
| --- | --- | --- |
| `DB_DIR` | `/data` | Directory for the SQLite database inside the containers. |
| `FRONTEND_PORT` / `BACKEND_PORT` | `3000` / `8000` | Host ports published by the stack. |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins for direct API access. |
| `BACKEND_URL` | `http://localhost:8000` | Backend URL used by the frontend `/api` proxy. Docker Compose sets `http://backend:8000`. |
| `SYNC_REQUEST_DELAY` | `0.15` | Seconds between Binance requests during a sync. |
| `SYNC_FETCH_WORKERS` | `4` | Concurrent workers used while fetching candle history. |
| `PRICE_VERIFY_TOLERANCE_PCT` | `5` | Max deviation from CoinGecko before a price is flagged unverified. |
| `MIN_TRACKED_MARKET_CAP` | `10000000` | Post-2021 coins below this market cap are not price-tracked (pre-2021 coins are always tracked). |
| `COINGECKO_BATCH_DELAY` | `2` | Seconds between CoinGecko market batches. |
| `LOG_LEVEL` | `INFO` | Python log level for the backend and worker. |
| `API_KEY` | unset | Optional. When set, `/api/*` requires a matching `X-API-Key` header. The frontend proxy adds it automatically. |
| `RATE_LIMIT_PER_MINUTE` | `600` | Per-client request limit for `/api/*` (0 disables); the proxy forwards `X-Forwarded-For` so browsers behind it get separate buckets. |
| `ALERT_THRESHOLD_PCT` | `20` | Default dip-distance threshold for watched coins without their own value. |
| `ALERT_WEBHOOK_URL` | unset | Optional webhook that receives alert JSON payloads (dip alerts and strategy signals). |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | unset | Optional Telegram bot used to deliver alerts. |
| `UPDATE_CHECK` | `1` | Set to `0` to disable the GitHub release check behind the Update badge. |
| `UPDATE_REPO` | `alikula37/dip-radar` | Repository the update check asks for the latest release. |
| `HTTP_PROXY` / `HTTPS_PROXY` | unset | Optional proxy for outbound data-provider requests. |

`COINGECKO_API_KEY` is only needed for the key-gated historical ingestion
(`python -m market_history`); the daily sync and the app itself work keyless.

## Updating

The app is versioned (`backend/VERSION`, shipped inside the backend image and
shown by `GET /api/version`). Every page shows an **Update vX.Y.Z** badge in the
top-right corner when a newer GitHub release exists — hover it for the exact
commands. Image tags are built from source, so pull the source first:

```bash
git pull && docker compose up -d --build      # or: ./scripts/update.sh
```

The check is best-effort (cached 6h; offline installs simply see no badge).
Maintainers cut a release by bumping `backend/VERSION` and tagging the merge
commit (`gh release create vX.Y.Z --generate-notes`).

## Sharing with a friend / installing via an AI agent

[INSTALL.md](../INSTALL.md) contains a copy-paste prompt for an AI agent that
installs the stack with `scripts/install.sh` (busy ports are handled
automatically).

## Troubleshooting

- **No data appearing?** Check the worker logs: `docker compose logs -f worker`.
- **Binance unreachable (`SSL: WRONG_VERSION_NUMBER`)?** The provider is blocked
  or redirected by your network. Dip Radar automatically retries against
  `data-api.binance.vision`; if the whole Binance domain is blocked, configure
  your own proxy via `HTTP_PROXY`/`HTTPS_PROXY` in `.env`.
- **"A sync is already in progress" (HTTP 409)?** Wait for it to finish;
  progress is shown by `GET /api/meta`.
- **Stuck sync?** `docker compose restart worker` (the cross-process lock has a
  TTL, so a crashed sync cannot block forever).
