# Strategy Lab, presets and signals

The Strategy Lab (`/backtest`) replays the Value Score at historical rebalance
dates (weekly/monthly/quarterly, point-in-time scores computed only from candles
available at each date) and simulates buying the top-N cheapest coins — with
min-score, market-cap, volume, weighting (equal/score/market-cap), BTC-fill for
unfilled slots and per-trade fees all configurable.

## Mechanics

- **Exit rules**: *reset to the top-N cheapest every period*, or *hold each
  position until its score drops below an exit threshold* (hysteresis avoids
  churn and lets winners run while they stay cheap). The hold rule is read
  literally: a position is kept while its score is at least the threshold —
  value books sell once the coin stops being cheap, momentum (flipped) books
  exit the names that land in the most expensive `sell_score`% (a blow-off exit;
  mirrored thresholds were tested and the optimizer kept the literal rule).
- **Risk management**: a 30-day trend gate that skips free-falling entries plus
  daily-checked **stop-loss, trailing stop and take-profit** exits (proceeds wait
  in BTC until the next rebalance and the stopped coin sits out one period).
- **Reporting**: total return in BTC *and* USD against BTC buy & hold, CAGR,
  Sharpe, volatility, max drawdown, Calmar, win rate, turnover, **consistency
  diagnostics** (positive-year share, share of rolling 1-year windows that end
  positive, time spent in drawdown, and how much of the total gain came from the
  best 5% of periods), a log-scale equity + drawdown chart, a **trade log** with
  entry/exit dates, BTC prices and exit reasons, and an expandable rebalance
  history. Flat (in-BTC) weeks carry a chip explaining why (*factor IC weak* /
  *risk-off regime* / *equity brake* / *no candidates*).

## Value Score

The headline score is a **cross-sectional percentile** of the composite
(50 = median coin, 95 = cheapest 5%), so the 0–100 scale is uniform and both
tails are directly comparable. The composite weighs:

| Component | Weight | What it measures |
| --- | --- | --- |
| Valuation blend | 0.27 | 1y / 3y / all-history price percentiles |
| Distance to dip | 0.22 | Distance above the event low (BTC parity) |
| Gap to 3y median | 0.14 | Closeness to the 3-year median close |
| Basing | 0.13 | Time spent in the cheapest quartile of the past year |
| Range position | 0.14 | Position between ATL and ATH |
| **Dip respect** | 0.10 | Proven bounces: ≥30% rallies from a trough that sat within 15% of the running low (last 3 years, 45-day separation). A coin that repeatedly rallied out of the same dip (BCH-style) scores high; new coins with no reactions rank lower. |

A knife-risk penalty applies to free-falls; the coin card shows a
“Dip bounced N× (avg +X%)” chip.

## Presets

| Preset | Character | Measured (cold start, dip-respect score, 2026-09-17 vintage) |
| --- | --- | --- |
| Conservative | quarterly top-3 equal-weight, trend ≥ +10, trades rarely | low activity |
| Balanced | weekly top-3 score-weight, regime alt-trend 35%, short n3 @25%, 50% sweep | FULL ≈ −30% BTC, holdout +14% |
| Aggressive | Balanced with top-2 and short @50%, 30% sweep | higher octane, wider drawdowns |
| **Optimized** | n=4, min score 30, momentum side, 50M–1B cap band, score weights, hold (sell < 10), short n2 @100%, 70% sweep, equity brake 0%, IC filter @35%, stop 30 / trail 75, trend ≥ −60 | **FULL +2270% BTC** (Sharpe 1.38, −49% DD, 100% positive years), 2022-23 +220%, 2024 +115%, 2025+ +47%, **holdout +82%** (Sharpe 0.96, −38% DD) |
| Hedge | long the cheapest large caps at breadth-scaled exposure, short the 5 most expensive at full size, 50% profit lock | FULL +405% (Sharpe 1.32, −18% DD), 2025+ +60% (Sharpe 2.04), holdout +1% |

Optimized v2 was found by a focused 1,200-trial search under the dip-respect
score (the general searches produced overfit families: `return` reached
FULL +7000% with a −72% holdout; `sharpe` a two-coin book). Hedge came from a
3,600-trial search. Both are **in-sample selections** — the verdict badges, the
nested CV and the trailing holdout are the guardrails, not a promise; expect
live results below the tables.

## Auto-optimizer

`POST /api/backtest/optimize` treats "find the best parameters" as a
model-selection problem: you add parameters to the search scope (the UI's
**+** / **Optimize all** buttons, including the market-cap floor and ceiling;
everything else is pinned), pick CV folds and trials, and Optuna TPE searches
the combinations on a training region — the full grid is far too large to
brute-force, so trials control coverage. The best unique candidates are
re-scored with **purged + embargoed walk-forward CV**, and only finalists touch a
trailing holdout the search never sees. The strictness setting decides the
**verdict**, not visibility: every candidate is labelled *validated* or flagged
with the exact failure reason (overfit risk / factor weak / holdout decays /
unstable folds). Winners are in-sample selections; expect live results below the
table.

## Live signals and watched strategies

`GET /api/strategy/signals` replays any configuration to the latest anchor and
returns a signal contract: `state` (BTC share, the *in-BTC* reason, IC / regime /
brake flags, `tracked` symbols), `positions` (entry, mark, BTC PnL, periods held,
stop/trailing/TP trigger prices and any daily exit that already fired; shorts
carry their own entry and inverse-BTC PnL), `candidates` (the strategy's own
next-anchor watchlist) and a human `message`. Reason codes (`ic`, `regime`,
`stop_loss`, …) are machine-friendly in the API and translated in the UI (hover
any reason, or expand *What do the reasons mean?*).

The same engine powers **watched strategies**: `POST /api/strategy/watches`
saves a configuration, freezes its simulated equity as a shadow baseline and
stores the emitted signals (deduplicated per anchor/action/symbol). The worker
refreshes every active watch after each daily sync, sends an **alert**
(webhook/Telegram) for every actionable signal and reports a **paper return**
since creation. The `/signals` page shows each watch live, its signal history
with the paper move since each signal fired (rebased on the current data
vintage; a book sitting in BTC reads 0.00%) and refresh/delete controls.

## Honest caveats

- **Look-ahead**: scores, bands, dip respect and exits are point-in-time. The
  market-cap/volume filters use the daily `market_history` archive where it has
  coverage; before that they fall back to *today's* snapshot, so a cap refresh
  can reshuffle historical universes — quote numbers with a date stamp.
- **Survivorship**: delisted coins are archived and included going forward;
  coins delisted before the archive existed are missing.
- **Costs**: funding is modelled (default 10% APR in the presets), but borrow
  availability and liquidation are not.
- **Selection bias**: presets and optimizer winners were selected on this exact
  history.
- The research harness (`backend/research/README.md`) holds the IC studies, the
  frozen baselines, the look-ahead audit and the shipping gates for any learned
  score.
