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
- **Themed loading animation**: waiting states show a "radar sweep discovering the dip" animation (hero on the initial-sync screen, compact in the sync banner), announced to screen readers via a polite status label and replaced by a static glyph under `prefers-reduced-motion`. Transient API hiccups no longer strand the dashboard on an error card — it toasts, keeps the loaded data and retries automatically.
- **USD parity in the detail view**: clicking a coin anywhere shows both currencies — the live BTC/USD rate is stored during every sync, the price card has a USD/BTC toggle (USD by default) and the price-history chart switches between BTC parity and USD (`/history?vs=usd`, converted with the same-day BTC rate). The dip/distance metrics stay in BTC parity, and no separate USD dashboard is needed.
- **Valuation percentile & Value Score**: beyond distance-to-dip, every coin is measured against its own history — valuation percentile (1y/3y/all: share of days spent above today's price), distance from the 3-year median, range position (ATL→ATH), basing (% of the last 90 days spent in the bottom price quartile) and 90-day trend. A transparent 0–100 Value Score (liquidity/history gated, component breakdown in the tooltip, knife-risk penalty for free-falls) surfaces coins that are cheap without being falling knives — including coins that are >100% away from their 2021 low yet in the cheapest 10% of their 3-year range (e.g. SAND). The design was validated with a quarterly 90-day-forward backtest: distance-to-dip had the strongest cross-sectional IC, valuation percentile was a close second, and trend was ambiguous, so it only acts as a penalty.
- **Leaderboard modes**: Closest · Falling · **Cheapest** (switchable 1y/3y/all valuation window) · **Basing at lows**.
- **Strategy Lab (backtesting page)**: replays the Value Score at historical rebalance dates (weekly/monthly/quarterly, point-in-time scores computed only from candles available at each date) and simulates buying the top-N cheapest coins — with min-score, market-cap, volume, weighting (equal/score/market-cap), BTC-fill for unfilled slots and per-trade fees all configurable. Two exit rules: **reset to the top-N cheapest every period**, or **hold each position until its score drops below an exit threshold** (buy cheap, sell once the cheapness is gone — hysteresis avoids churn and lets winners run while they stay cheap). Risk management on top: a 30-day trend gate that skips free-falling entries plus daily-checked **stop-loss, trailing stop and take-profit** exits (proceeds wait in BTC until the next rebalance and the stopped coin sits out one period). Shows total return in BTC *and* USD against BTC buy & hold, CAGR, Sharpe, volatility, max drawdown, Calmar, win rate, turnover, **consistency diagnostics** (positive-year share, share of rolling 1-year windows that end positive, time spent in drawdown, and how much of the total gain came from the best 5% of periods — a one-off vintage spike can no longer masquerade as a good strategy), log-scale equity + drawdown chart, a **trade log** that says exactly where each position was bought and sold (dates, BTC prices, result, exit reason: take profit / trailing stop / stop loss / score faded / rotated out / still open) and an expandable rebalance history (latest 8 by default). Presets (Conservative · Balanced · Aggressive · Optimized · Hedge) cover common risk appetites; the last two were found by search after the score became a percentile and are documented below. The headline Value Score is a **cross-sectional percentile** of the composite (50 = median coin, 95 = cheapest 5%), so the 0-100 scale is uniform by construction and both tails are directly comparable indicators. A `score_model` selector A/Bs the rule-based score against the learned artifact (`learned_v4`, trained through 2024-12-31): it scores 24 point-in-time features — including the dashboard's 3-year P05/P25/P75/P95 band distances and multi-horizon trends — and lifts walk-forward IC to **0.170 vs 0.062** for the rule score (+0.108, 95% CI [+0.070, +0.146]) while beating it in the 2025+ simulator A/B (Balanced preset: 1.57 vs 0.60 Sharpe; Aggressive holdout +36% vs −6%) with no turnover inflation. A clickable **Feature importance** panel under the selector lists every feature's weight, direction and description only for those who expand it. The model stays labelled experimental (the shadow period is open). The framing is **BTC accumulation**: altcoins are vehicles for growing the BTC balance, not a portfolio to hold — so a **profit sweep** (`Profit sweep %`) harvests part of every position's BTC-denominated gain back into BTC at each rebalance, and a **max holding** stop returns stale positions to BTC. At 50% sweep the Balanced preset gives up some upside (+316% → +232% BTC) but raises Sharpe 0.66 → 0.71, lowers drawdown (−32% → −29%), cuts the share of gains from the best 5% of periods (54% → 51%) and reduces average alt exposure (1.00 → 0.79): the book spends more time in BTC and only uses alts to top it up. An **auto-optimizer** button opens a modal that treats "find the best parameters" as a proper model-selection problem: you add parameters with **+** (everything else stays pinned with an editable value) — including the market-cap floor and ceiling — hit **Optimize all** to search every parameter, pick the number of CV folds, and Optuna TPE searches the combinations on a training region (the full grid is far too large to brute-force, so trials control coverage); the best unique candidates are re-scored with **purged + embargoed walk-forward CV** inside that region, and only finalists touch a trailing holdout the search never sees. The strictness setting decides the **verdict**, not visibility: every returned candidate is labelled *validated* (all CV folds positive, holdout positive and keeping at least half of the CV edge) or flagged with the exact failure reason (overfit risk / factor weak / holdout decay / unstable folds), so the table always shows the best attempts — validated ones first — and the search digs deeper when nothing passes. Every Strategy Lab control carries a **hover explanation** (no click needed) — hover the info icon next to a label or metric. A **factor-IC filter** measures the score's own rolling cross-sectional information coefficient and shrinks the whole factor bet while it is weak (shipped off by default: on this dataset it whipsaws — the losses arrive faster than the rolling IC can turn, so the honest regime response stays the dominance/breadth filter above). A **factor-side switch** (`Factor side`) can flip the book to the momentum direction (long the most expensive coins, short the cheapest) for regimes where cheapness is out of favour. A **market-neutral short sleeve** (`Short N`) shorts the most expensive coins each period, sized as a share of the long book (`Short exposure`) with a configurable funding drag (`Short funding APR`); at 25% exposure with 10% APR funding it lifted the Balanced preset from +191% to +316% BTC with the same −32% drawdown, Sharpe 0.56 → 0.66, and cut the share of gains coming from the best 5% of periods from 61% to 54% — more of the return now comes from many periods instead of one vintage (the latest 2025-2026 window stays negative because the cheap-vs-expensive spread itself inverted there). An **altcoin-dominance regime filter** is built from our own universe (equal-weight alt/BTC index + breadth — a keyless proxy for the falling OTHERS.D): when the alt trend is below its SMA the book runs at reduced exposure with the rest in BTC. Partial exposure is the shipped setting because the measured binary on/off switch whipsaws: at 35% exposure Balanced improved from +132% to +220% BTC (max drawdown −52% → −33%, Sharpe 0.51 → 0.58) and Aggressive from +170% to +490% (−56% → −44%, Sharpe 0.51 → 0.63); out-of-sample (2025+ after the parameters were chosen) Balanced Sharpe 0.24 → 0.47 and Aggressive 0.70 → 0.96. The **Hedge** preset is the large-cap value spread found by a focused 3,600-trial search (sharpe / consistency / calmar, cap band $500M–$10B pinned, short sleeve n5 pinned, every other parameter in scope): long the cheapest large caps at a breadth-scaled exposure (25–35%) while shorting the five most expensive ones at full size, hold rule sell < 5, IC filter at 0% exposure, equity-trend brake 35%, 50% profit lock. Cold-start windows (what the UI shows when you apply the preset with that date range): 2022-23 +111% (Sharpe 1.25, −19% DD), 2024 +9%, **2025+ +55% (Sharpe 1.81, −12% DD)**, last-17-months −1%, FULL **+971% BTC (Sharpe 1.79, −19% DD, every year and every rolling 1-year window positive)**, turnover 0.14/week, 24.5% cumulative funding. The optimizer's nested validation measures the same strategy as a *continuous* run (positions and state carried from 2022), where the holdout slice is +43% — both numbers are true, but the cold-start one is what a fresh application experiences. Caveats: the short leg needs a borrow/perp market (funding, liquidation and borrow-availability risk are only partially modelled), the cap band uses today's market caps (survivorship), and the recent 17 months are flat rather than negative.

The **Optimized** preset comes from four one-click searches run under the percentile score — **5,400 trials** (1,500 return, 1,500 return with a 50% drawdown limit, 1,200 return with top-5 pinned, 1,200 Sharpe with top-5 pinned) on top of 6,500 trials under the previous scale — every parameter in scope including the new **market-cap band**, realistic 10% short funding pinned, nested CV→holdout gate. It is a mid-cap momentum rotation: 50M–1B cap band, top-5 score-weighted, momentum factor side, hold-until-score-fades (sell < 3), short sleeve n5, 30/25 sweep/lock, breadth regime at 50% exposure. Re-measured after the percentile change it makes **+150% BTC** over 2022→2026 (Sharpe 0.80, −42% DD, 82% rolling years positive), **+48% in 2025+** (Sharpe 1.83, −4% DD) and **+26% in the holdout** (Sharpe 1.43, −7% DD, every rolling year positive). Caveat: the cap band is applied with *today's* market caps (survivorship bias), so treat it as the aggressive, small-cap-tilted option next to the steadier Balanced preset. Note on scale: the rule score is now a cross-sectional percentile, so thresholds read as percentiles (sell < 3 keeps winners until they are among the most expensive 3%). The classic presets were re-measured under that scale — Balanced ≈ +122% BTC (Sharpe 0.59, −44% DD) and Aggressive ≈ +29% (0.36, −72%) over 2022→2026 — and were originally tuned with ~60k simulations on the full 2022→2026 history plus per-year holdout checks: Conservative = quarterly top-3 equal-weighted, score ≥ 60, trend ≥ +10, sell < 40, trailing 75% / TP 100 (trades rarely); Balanced = weekly top-3 score-weighted, sell < 25, trend ≥ −25, regime alt-trend at 35%, short sleeve n3 at 25% with 10% funding, 50% profit sweep (≈ +232% BTC · Sharpe 0.71 · −29% DD); Aggressive = the same with top-2, short sleeve at 50% and 30% sweep (higher octane, wider drawdowns). With position-lifetime stop semantics the risk exits consistently hurt this dataset, so the tuned presets leave them off — experiment freely. Honestly labeled: liquidity filters use today's market cap/volume and delisted coins are missing (survivorship bias); presets are in-sample fits and returns concentrate in a few trades (the trade log shows exactly which), not guarantees.
- **Distribution strip**: the coin modal shows where today's price sits inside the 3-year distribution (P05–P95 band with a "You are here" marker) plus signal chips (3y percentile, range position, basing, ATL age, 200-day trend gate).
- **Custom reference windows and listing filters**: compute distances against "Since 2021", the all-time low, or any custom start date (`Custom` picker); filter the universe by listing era (before 2021 / 2021+); the detail chart switches between 90d, 1y and all history.
- **Watchlist and alerts**: star coins from the table or the detail modal and set per-coin dip thresholds. After each sync the worker checks the watchlist and notifies you through a webhook and/or Telegram when a coin crosses below its threshold (no repeat spam while it stays below).
- **Four views and comparison**: leaderboard, scatter map, treemap (area = market cap, color = distance) and a sortable table. Up to three coins can be compared on a log-scaled relative-performance chart (start = 1x) with hover/tap readouts of exact multiples and percentage changes; the current chart can be exported as PNG. The modal's 365-day price chart and dip-distance chart share 90d/1y/All ranges and an as-of marker.
- **Summary strip**: tracked coin count, how many are within 25%/50% of the dip, and the median distance at a glance.
- **Delist archive & point-in-time liquidity**: coins that leave Binance are archived (`delisted_at`) instead of deleted — they vanish from the live board but stay in the research universe so backtests stop being survivorship-biased going forward. Coins delisted *before* the archive existed are recovered from Binance's public data mirror (`python -m binance_mirror --discover` lists candidates, `--sync-from-candidates` recreates their Coin rows and daily candles; the live database already carries FTTBTC and friends this way). `python -m market_history` fills a new `market_history` table with daily USD price / market cap / volume from CoinGecko (weekly from the worker when `COINGECKO_API_KEY` is set), so future models can use the liquidity that actually existed on a historical date instead of today's snapshot.
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
| `RATE_LIMIT_PER_MINUTE` | `600` | Per-client request limit for `/api/*` (0 disables); the proxy forwards `X-Forwarded-For` so browsers behind it get separate buckets. |
| `ALERT_THRESHOLD_PCT` | `20` | Default dip-distance threshold for watched coins without their own value. |
| `ALERT_WEBHOOK_URL` | unset | Optional webhook that receives alert JSON payloads. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | unset | Optional Telegram bot used to deliver alerts. |
| `HTTP_PROXY` / `HTTPS_PROXY` | unset | Optional proxy for outbound data-provider requests. |

## API Endpoints 🔌

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/coins` | Tracked coins with distances and bubble sizes. Optional `?low_from=YYYY-MM-DD` recomputes the event low from a custom start date; `?as_of=YYYY-MM-DD` returns a historical snapshot (price, lows, distances and trends up to that day). |
| `GET` | `/api/coins/{symbol}/history?limit=365` | Most recent daily candles for a coin (ascending, max 5000). Add `&vs=usd` to convert OHLC to USD with the same-day BTC rate. |
| `GET` | `/api/coins/{symbol}/dip-history?limit=365` | Running distance-from-dip series for a coin (lows computed as of each day). |
| `GET` | `/api/backtest?start=YYYY-MM-DD` | Replays the Value Score at historical rebalance dates and simulates the portfolio. Options: `end` (default latest), `rebalance=weekly\|monthly\|quarterly`, `top_n`, `min_score`, `min_market_cap`, `min_volume`, `weighting=equal\|score\|market_cap`, `fill_with_btc`, `fee_pct`, `rotation=rebalance\|hold`, `sell_score` (exit threshold for `hold`, default `min_score`), `min_trend_30d` (skip falling entries), `stop_loss_pct` / `trailing_stop_pct` / `take_profit_pct` (daily-checked risk exits). `score_model=rule\|learned_v1` picks which score ranks the coins. The response carries the equity curve, per-rebalance picks and a per-position trade log (entry/exit date, BTC price, exit reason, return). |
| `GET` | `/api/meta` | Last sync time, tracked coin count (plus archived/delisted count) and whether a sync is running. |
| `POST` | `/api/refresh` | Starts a background sync. Returns `409` if one is already running. |
| `GET` | `/api/watchlist` | Watched coins with distances, thresholds and last alert time. |
| `POST` | `/api/watchlist/{symbol}` | Adds or updates a watched coin (`{"threshold_pct": 20}`). |
| `DELETE` | `/api/watchlist/{symbol}` | Removes a coin from the watchlist. |
| `POST` | `/api/backtest/optimize` | Nested-validation parameter search (JSON body): pinned universe (`min_market_cap`, `min_volume`, `rebalance`, `score_model`, `fee_pct`), `optimize_params` (searched, UI adds them with **+**) plus `fixed_params` (pinned values) must cover every strategy parameter, `objective=sharpe\|return\|calmar\|consistency`, `trials` (≤1000), `cv_folds` (1-6, default 3), optional `max_drawdown_limit`, `validation_fraction` (trailing holdout). Returns only configs that pass the walk-forward CV **and** holdout gates, with train / CV / holdout metrics. |
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

Need data without hitting the providers? `cd backend && python demo_seed.py` inserts five deterministic demo coins with ~4.5 years of candles (the E2E job in CI uses the same script).

**Value Score research**: `backend/research/` is a read-only, deterministic harness (baseline IC study, bootstrap CIs, provenance/fingerprint freezing). See `backend/research/README.md` for how to run it against a database copy, the data caveats (survivorship, no point-in-time liquidity) and the shipping gates for any future learned score.

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
