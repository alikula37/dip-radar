# Value Score Research Harness

Read-only, deterministic experiments for the Value Score and the Strategy Lab.
No application code is written here; scripts only `SELECT` and reuse
`backtest.build_snapshot` so research and production share one feature pipeline.

## Quick start

Point the harness at a **copy** of the database (snapshot builds are heavy and
we never want research runs to touch live data):

```bash
docker compose cp backend:/data/dipradar.db /tmp/dipradar.db
cd backend
DB_DIR=/tmp DATABASE_URL=sqlite:////tmp/dipradar.db \
  ../.venv/bin/python -m research.baseline_ic \
  --save research/baselines/value_score_baseline.json
```

Every run prints provenance (git commit, database sha256, latest candle,
tracked coins, seed) and freezes it into the JSON when `--save` is used.
Committed baselines live in `research/baselines/`; treat them as immutable —
create a new file instead of overwriting one.

## Layout

| File | Purpose |
| --- | --- |
| `stats.py` | Rank/Spearman helpers, summaries, moving-block bootstrap CIs (no SciPy). |
| `common.py` | Lazy DB session, database fingerprint, snapshot loading, forward-return pairs, IC/spread series. |
| `baseline_ic.py` | Current Value Score baseline: cross-sectional IC of the score and its stored sub-signals, per-year breakdown, quintile spread, IC by forward horizon, bootstrap CIs. |
| `data_quality.py` | Universe composition (active/delisted/stable), candle coverage and >3-day gaps, point-in-time market-history coverage, liquidity staleness. |
| `feature_store.py` | Point-in-time feature rows per (rebalance anchor, symbol): score components, volatility, ATH drawdown, dollar volume, point-in-time market cap/volume, BTC regime. JSONL export. Current-only liquidity lives in explicit `cap_current`/`volume_current` columns. |
| `cv.py` | Purged + embargoed expanding-window walk-forward folds for forward-return labels (`assert_no_overlap` guards every experiment). |

Point-in-time liquidity is ingested by the application module
`backend/market_history.py` (`python -m market_history`); coins that leave
Binance are archived via `Coin.delisted_at` instead of deleted, so the
snapshot universe keeps their history. CoinGecko's `market_chart` endpoint
requires a free Demo API key (`COINGECKO_API_KEY`); without it the command
reports per-coin failures and leaves the table untouched.

## Interpreting the baseline

Measured on the 2020–2026 dataset (see `baselines/value_score_baseline.json`
for the exact snapshot):

- The composite score has a small but real rank IC (~+0.07 monthly) whose 95%
  block-bootstrap CI excludes zero.
- The top-minus-bottom quintile *return* spread is much weaker statistically
  than the rank IC — rank significance is not money significance.
- Distance-to-dip alone scores almost the same IC as the composite, so any
  future model must beat that simple baseline out-of-sample, not just "work".
- IC drifts by regime (2022–24 strong, 2025–26 near zero): expect decay.

## Data caveats (fix before trusting a learned model)

1. **Survivorship bias**: only currently tracked coins exist in the database;
   delisted coins are missing, which flatters labels and ICs.
2. **No point-in-time liquidity**: `market_cap`/`volume_24h` are today's
   values. They may be used as *filters* (as production does) but never as
   model features — that would leak the future. Historical dollar volume can
   be derived from `Kline.volume × close` once needed.
3. **Small effective sample**: ~370 coins × daily candles looks large, but
   cross-sectional correlation leaves roughly 20–40 independent regimes.
   Keep models tiny.
4. **Multiple testing**: log every configuration tried; prefer deflated
   Sharpe / pre-registered gates over "best of N".

## Leakage rules for any future model

- Features may only use candles `<= t`, exactly like `build_snapshot` does.
- Labels are forward returns; training folds must **purge** samples whose
  label horizon overlaps the validation window and **embargo** a buffer after
  it. Plain K-fold or random splits are forbidden.
- Hyperparameter search happens inside the training window only; the final
  holdout is touched once.
- Score weights/thresholds never get tuned on the Strategy Lab metrics of the
  same period they are evaluated on.

## Shipping gates for a learned score

A model replaces the rule-based score only if, on walk-forward evaluation, it:

1. beats the frozen baseline IC with a 95% CI that excludes the baseline
   value and stays positive across at least 4/6 calendar years;
2. improves Strategy Lab Sharpe / max drawdown on the same walk-forward
   splits without inflating turnover beyond the baseline;
3. survives a shadow period (>= 3 months) in production before becoming the
   default, and ships with a version tag plus a documented refit schedule.

If it fails, the rule-based score stays — a negative result is still a result.

## Roadmap

- Phase 1 (shipped; still open: recovering coins delisted *before* the
  archive existed, and refreshing `market_history` from the worker):
  delisted-coin archive (`delisted_at`), point-in-time
  market cap/volume ingestion (`market_history` module; needs a free
  `COINGECKO_API_KEY`), and the `data_quality` report.
- Phase 2 (this harness): point-in-time feature store keyed by rebalance date
  (`feature_store.py`) plus purged/embargoed walk-forward folds (`cv.py`), with
  a leakage regression test proving anchor features never change when future
  candles arrive.
- Phase 3 (next): train constrained models (monotonic ranks first, tiny GBM
  with monotonic constraints second) on the feature store with `cv.py` folds,
  and compare against the frozen baseline on IC, strategy Sharpe/drawdown and
  turnover.
- Phase 4: shadow scoring, model versioning, per-model comparison in the
  Strategy Lab (`score_model=` parameter).
