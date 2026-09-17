# API

All endpoints live under `/api`. When `API_KEY` is configured, every request
must include a matching `X-API-Key` header — the bundled frontend proxies
requests server-side and adds it for you.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/coins` | Tracked coins with distances, the Value Score and bubble sizes. `?low_from=YYYY-MM-DD` recomputes the event low from a custom start date; `?as_of=YYYY-MM-DD` returns a historical snapshot (price, lows, distances and trends up to that day). |
| `GET` | `/api/coins/{symbol}/history?limit=365` | Most recent daily candles for a coin (ascending, max 5000). Add `&vs=usd` to convert OHLC to USD with the same-day BTC rate. |
| `GET` | `/api/coins/{symbol}/dip-history?limit=365` | Running distance-from-dip series for a coin. |
| `GET` | `/api/backtest?start=YYYY-MM-DD` | Replays the Value Score at historical rebalance dates and simulates the portfolio. Full parameter list: `end`, `rebalance`, `top_n`, `min_score`, `min_market_cap` / `max_market_cap`, `min_volume`, `weighting`, `fill_with_btc`, `fee_pct`, `rotation`, `sell_score`, `min_trend_30d`, `stop_loss_pct`, `trailing_stop_pct`, `take_profit_pct`, `regime_filter` / `regime_min_breadth` / `regime_exposure`, `equity_trend_exposure`, `profit_lock_pct`, `short_n` / `short_max_score` / `short_funding_apr` / `short_exposure`, `profit_sweep_pct`, `max_holding_periods`, `invert_score`, `ic_filter` / `ic_window` / `ic_threshold` / `ic_exposure`, `score_model`. The response carries the equity curve, per-rebalance picks, a per-position trade log and the final book state. |
| `POST` | `/api/backtest/optimize` | Nested-validation parameter search (JSON body): pinned universe (`min_market_cap`, `min_volume`, `rebalance`, `score_model`, `fee_pct`), `optimize_params` plus `fixed_params` covering every strategy parameter, `objective=sharpe\|return\|calmar\|consistency`, `trials` (≤3000), `cv_folds` (1-6), optional `max_drawdown_limit`, `validation_fraction`, `strictness=strict\|balanced\|loose`. Returns validated and flagged candidates with train / CV / holdout metrics. |
| `GET` | `/api/strategy/signals` | Replays a configuration to the latest anchor and returns the live signal contract (state, positions with exit levels, next-anchor watchlist, message). Same parameters as `/api/backtest`; `end` sets the as-of date. |
| `GET` | `/api/strategy/watches` · `POST` · `DELETE /{id}` | Watched strategies: list (with paper return), save a configuration and emit its first signals, delete. |
| `POST` | `/api/strategy/watches/{id}/refresh` | Recompute the watch now and store new signals. |
| `GET` | `/api/strategy/watches/{id}/live` | Replay the watch without storing anything. |
| `GET` | `/api/strategy/watches/{id}/signals?limit=` | Stored signal history with the paper move since each signal (`return_since`). |
| `GET` | `/api/score-models` | Score models (rule + learned artifacts) with per-feature weights, directions, labels and descriptions for the feature-importance panel. |
| `GET` | `/api/version` | Running version and whether a newer GitHub release exists. |
| `GET` | `/api/meta` | Last sync time, tracked coin count (plus archived/delisted) and whether a sync is running. |
| `POST` | `/api/refresh` | Starts a background sync. Returns `409` if one is already running. |
| `GET` | `/api/watchlist` · `POST /{symbol}` · `DELETE /{symbol}` | Dip-threshold watchlist used by the alerting worker. |
| `GET` | `/health` | Liveness probe. |

## HTTPS with Caddy (optional)

The compose file ships an optional [Caddy](https://caddyserver.com/) reverse
proxy that terminates TLS automatically:

```bash
DOMAIN=radar.example.com docker compose --profile proxy up -d --build
```

Point `DOMAIN` at a hostname that resolves to your server and Caddy will obtain
a Let's Encrypt certificate on first start; keep the default (`localhost`) for
local testing with Caddy's internal CA. Ports 80/443 are exposed by the proxy
while the frontend keeps its own mapping for direct access.
