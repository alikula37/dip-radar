# Dip Radar 🎯

Dip Radar is a self-hosted web service for **BTC-parity altcoins**: it measures
how far each coin trades from its own dip, ranks how cheap it is versus its
history with a transparent 0–100 Value Score, and ships a **Strategy Lab** that
backtests dip-buying strategies, searches parameters with proper validation and
tracks the chosen strategy's live signals.

## System at a glance

Three containers share one SQLite volume:

1. **Backend (FastAPI)** — REST API and research endpoints.
2. **Worker (APScheduler)** — daily sync from Binance + CoinGecko (candles,
   market caps, point-in-time snapshots) and the alert/signal checks.
3. **Frontend (Next.js + D3)** — dashboard, Strategy Lab and Signals pages; it
   proxies `/api/*` server-side, so no CORS setup is needed.

```
Binance (api.binance.com → data-api.binance.vision fallback)
        │
        ▼
SQLite (shared volume) ◄── FastAPI backend ◄── Next.js /api proxy ◄── Browser
        ▲
CoinGecko metadata / market caps
```

No API keys are required. The first sync runs automatically in the background
(20–60+ minutes depending on Binance rate limits); the UI shows progress.

## Quick start (Docker)

```bash
git clone https://github.com/alikula37/dip-radar.git
cd dip-radar
./scripts/install.sh          # or: docker compose up -d --build
```

Open **http://localhost:3000** — the dashboard, **/backtest** (Strategy Lab) and
**/signals** (watched strategies) are served from there.

- `scripts/install.sh` checks Docker, picks free host ports if 3000/8000 are
  taken, writes them to `.env` and starts the stack.
- Want data before the first sync finishes?
  `docker compose exec -T backend python demo_seed.py` inserts five demo coins
  with ~4.5 years of candles.
- Ports, alerts, API key, proxies and every other knob: see
  [docs/configuration.md](docs/configuration.md).

## Updating

Every page shows an **Update vX.Y.Z** badge in the top-right when a newer
release exists. This repo builds its images from source, so:

```bash
./scripts/update.sh           # git pull + docker compose up -d --build
```

## Documentation

| Where | What |
| --- | --- |
| [docs/features.md](docs/features.md) | Everything the dashboard and the data layer do |
| [docs/strategy-lab.md](docs/strategy-lab.md) | Value Score, presets (with measured numbers), auto-optimizer, live signals and the honest caveats |
| [docs/api.md](docs/api.md) | API reference (coins, backtest, optimizer, signals, watches) and optional Caddy HTTPS |
| [docs/configuration.md](docs/configuration.md) | Ports, environment variables, updating, troubleshooting |
| [docs/development.md](docs/development.md) | Local dev, tests, CI and the research harness |
| [backend/research/README.md](backend/research/README.md) | IC studies, frozen baselines, look-ahead/selection-bias audit, model shipping gates |
| [INSTALL.md](INSTALL.md) | Copy-paste prompt that lets an AI agent install the stack for you |

## Disclaimer

Historical simulation, not investment advice. Presets are in-sample selections,
liquidity filters fall back to today's market caps before the point-in-time
archive covers a date, and delisted coins are only partially recovered — see
the caveats in [docs/strategy-lab.md](docs/strategy-lab.md).

## License

MIT License
