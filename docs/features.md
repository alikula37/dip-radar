# Features

## Dashboard

- **Leaderboard (default view)** with five modes: **Closest** (default), **Falling**,
  **Cheapest** (valuation percentile), **Basing**, and **Value** — the composite
  Value Score percentile with dip respect included, unscored coins excluded.
  Each row shows a bar, required drop to the low, 7d/30d trends, market cap and
  volume; click any row for details. In the **table view** the *Value* column is
  sortable and it is the default sort (descending, coins without a score last).
- **Scatter map (optional view)**: X axis is market cap (log), Y axis is the
  distance from the historical dip on a symlog scale clipped at the 95th
  percentile; extreme outliers are pinned to the top as ▲ markers. Watch-zone
  shading, collision-aware labels, hover tooltip, zoom/pan and click-through.
- **Color and size encoding**: color runs from green (close to the dip) to red
  (far) using a robust p90 domain so outliers do not wash out the palette; the
  closer a coin is to its dip, the bigger its bubble. Volume and exact values
  live in the tooltip.
- **Trend, sharing and export**: 7d/30d trend badges in the chart tooltip and
  table, shareable URL state for filters/views and CSV export of the filtered
  list. A default ≥ $1M volume filter keeps dead coins out of the way.
- **Historical "as of" view**: pick any date and the dashboard recomputes
  prices, lows, distances and 7d/30d trends as of that day (daily candles, UTC).
  Market caps intentionally stay current and the watchlist/alerts always reflect
  live values.
- **Dip-distance history**: the detail modal charts how a coin's distance from
  its dip evolved over time (running lows), sharing the 90d/1y/All range picker
  and the as-of marker with the price chart.
- **Transparent filtering**: a "showing X of Y tracked coins · hidden by …" line
  explains exactly which filter (stables, listing date, market cap, volume,
  watchlist, search) removes coins, with a one-click reset.
- **Stablecoin & pegged-asset filter**: stablecoins, tokenized gold and similar
  pegged assets are detected from CoinGecko categories plus a symbol/name
  heuristic and hidden by default with a one-click toggle (`stables=1` shows
  them).
- **USD parity in the detail view**: the live BTC/USD rate is stored during
  every sync, the price card toggles USD/BTC (USD by default) and the
  price-history chart switches between BTC parity and USD (`/history?vs=usd`).
  Dip/distance metrics stay in BTC parity.
- **Valuation & Value Score**: every coin is measured against its own history —
  valuation percentile (1y/3y/all), distance from the 3-year median, range
  position, basing (% of the last 90 days in the bottom quartile), 90-day trend
  and dip respect (proven bounces from the dip). A transparent 0–100 Value Score
  (liquidity/history gated, component breakdown in the tooltip, knife-risk
  penalty) surfaces coins that are cheap without being falling knives. See
  [strategy-lab.md](strategy-lab.md) for the weights.
- **Distribution strip**: the coin modal shows where today's price sits inside
  the 3-year P05–P95 band with a "You are here" marker plus signal chips.
- **Four views and comparison**: leaderboard, scatter map, treemap (area =
  market cap, color = distance) and a sortable table. Up to three coins can be
  compared on a log-scaled relative-performance chart (start = 1x) with
  hover/tap readouts; the chart can be exported as PNG.
- **Summary strip**: tracked coin count, how many are within 25%/50% of the dip,
  and the median distance at a glance.
- **Themed loading animation**: a "radar sweep" animation with screen-reader
  announcements and a static glyph under `prefers-reduced-motion`; transient API
  hiccups toast instead of stranding the dashboard.

## Share cards (X/Twitter-ready)

Two **1200×675 PNG** cards can be exported straight from the dashboard and come
with ready-to-post text on the clipboard:

- **Coin report card** (detail modal → *Share card*): Value Score with its
  percentile label, price in USD and BTC with the 7d move, distance from the
  dip, 3y valuation, range position, dip respect (proven bounces + average),
  basing, median gap and a 1-year distance-from-dip sparkline — plus a
  copy-ready tweet with the same numbers (*Tweet* button copies it alone).
- **Daily board** (toolbar → *Share*): the top 5 coins by Value Score with
  score, distance from the dip, 7-day move and dip bounces, stamped with the
  date (or the as-of date in historical mode). Downloading the card also copies
  a numbered thread-style text.

Both cards carry the brand, the date and a short "not financial advice" line
(no URLs); add your own commentary on top when posting. They are rendered from the app's own
numbers (no screenshots), so they stay crisp and consistent.

## Data and sync

- **Broad coverage**: tracks BTC pairs directly and converts USDT-only pairs to
  BTC parity using daily BTCUSDT rates. Pre-2021 listings are always included;
  newer coins are tracked once their market cap passes `MIN_TRACKED_MARKET_CAP`
  (default $10M).
- **Automated sync**: a dedicated APScheduler worker runs daily; a cross-process
  lock prevents concurrent syncs. Live progress (phase + percentage) is reported
  to the UI.
- **Parallel and verified fetching**: candles sync with a worker pool and
  Binance prices are cross-checked against an independent CoinGecko quote.
- **Resilient fetching**: Binance requests fall back to the public
  `data-api.binance.vision` mirror automatically; proxies are supported via
  `HTTP_PROXY`/`HTTPS_PROXY`.
- **Duplicate-free storage**: daily candles are upserted on
  `(symbol, timestamp)`.
- **Delist archive & point-in-time liquidity**: coins that leave Binance are
  archived (`delisted_at`) instead of deleted, and can be recovered from
  Binance's public data mirror (`python -m binance_mirror`). The worker appends
  a daily point-in-time market snapshot (cap/volume/price) to `market_history`,
  so backtest liquidity filters stop rewriting history as caps refresh.

## Alerts and signals

- **Watchlist and alerts**: star coins and set per-coin dip thresholds; after
  each sync the worker notifies you through a webhook and/or Telegram when a
  coin crosses below its threshold (no repeat spam while it stays below).
- **Strategy signals**: the same channels carry every actionable signal of a
  watched strategy (BUY / SELL / SHORT / STAY_IN_BTC) with the watch name,
  symbol, reason and anchor date. See [strategy-lab.md](strategy-lab.md) and the
  `/signals` page.

## Design system

Tailwind CSS 4 with shared tokens and UI components (buttons, badges, stat
cards, segmented controls); self-hosted Inter/JetBrains Mono via Fontsource;
table view, search, sorting and a detail modal with price history and range
pickers.
