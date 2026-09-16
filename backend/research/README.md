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
| `model.py` | Constrained learned score: oriented rank features (signs fixed a priori) + non-negative least squares, evaluated on `cv.py` folds against the frozen baseline on IC *and* a top-3 strategy proxy. |
| `export_model.py` | Trains up to a cutoff and freezes `score_artifacts/<version>.json` (weights, feature scaling, provenance, validation notes) for the Strategy Lab A/B. |

Point-in-time liquidity is ingested by the application module
`backend/market_history.py` (`python -m market_history`); coins that leave
Binance are archived via `Coin.delisted_at` instead of deleted, so the
snapshot universe keeps their history. CoinGecko's `market_chart` endpoint
requires a free Demo API key (`COINGECKO_API_KEY`); without it the command
reports per-coin failures and leaves the table untouched.

### Altcoin dominance (OTHERS.D) finding

The universe's own equal-weight alt/BTC index (computed point-in-time in
`build_snapshot`) shows why BTC-denominated alt strategies bleed: the index
spends most of 2022→2026 below its 6-anchor SMA. A **binary** trend/breadth
switch to BTC was measured to *hurt* (whipsaw: it exits near bottoms and
misses the rebounds), but **partial exposure** helps on both splits:

| Preset | No filter | Alt-trend filter at 35% risk-off exposure |
| --- | --- | --- |
| Balanced (2022+) | +132% BTC, Sharpe 0.51, DD −52% | +220%, 0.58, −33% |
| Balanced (2025+, OOS) | +2.5%, 0.24, −47% | +19.7%, 0.47, −22% |
| Aggressive (2022+) | +170%, 0.51, −56% | +490%, 0.63, −44% |
| Aggressive (2025+, OOS) | +54.9%, 0.70, −41% | +80.9%, 0.96, −20% |

The simulator exposes `regime_filter=alt_trend|breadth`, `regime_exposure`
and `regime_min_breadth`; the feature store carries `alt_above_sma`,
`alt_trend` and `breadth` columns for future models.

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

## Band features, the percentile score and learned_v4 (Sept 2026)

Three changes moved the score line forward:

1. **The dashboard's 3-year bands became model features.** `metrics.py` now emits
   the P05/P25/P75/P95 distances of the current close inside the last 3 years of
   daily closes, the IQR and P05–P95 band widths, the above-P75 / below-P25
   flags, the share of the last 90 days spent in the top quartile, and 7d/180d/365d
   trends. The app was already BTC-denominated end to end (USDT klines are
   converted to BTC parity), so these features measure exactly the dips a BTC
   accumulator cares about: how far a coin is above its BTC-parity dip, and how
   stretched it is inside its own 3-year distribution.
2. **The rule score became a percentile.** The headline score is now the
   cross-sectional percentile of the weighted composite instead of the raw sum of
   percentiles (a sum is bell-shaped: almost nothing above 80 or below 20). The
   scale is uniform by construction and the tails are comparable indicators. The
   side effect had to be managed: old thresholds meant different things on the
   new scale (sell < 25 used to mean "among the most expensive 2-3%", now it means
   the bottom quartile), so the presets' exit thresholds were re-tuned to sell < 3.
3. **learned_v4** retrains the constrained model on the enlarged feature set
   (24 features, anchors up to 2024-12-31, 15,651 samples):

| Metric | Rule score | learned_v4 |
| --- | --- | --- |
| Walk-forward IC (54 folds) | 0.062 | **0.170** |
| Positive IC share | 70% | **91%** |
| IC delta 95% CI | — | [+0.070, +0.146] |
| Top-3 proxy in the harness | −64.8% | **+17.9%** |

   Largest weights: `dollar_volume_30d`, `valuation_pct_1y`, `band_p05_dist_3y`,
   `below_p25_3y`, `distance` — the BTC-parity dip distance and band-edge
   features carry real weight, which matches the manual read of the BCH/BTC
   parity chart (buy at the BTC-parity dip, rotate back at the top).

   Real-simulator A/B with the re-tuned presets (rule → learned_v4): Balanced
   2025+ +31% (Sharpe 0.60) → **+49% (1.57)**, holdout +19% (0.46) → +18% (0.60);
   Aggressive FULL +29% (0.36) → **+168% (0.74)** and holdout −6% (0.17) →
   **+36% (0.86)**. Turnover is unchanged (0.11–0.22). FULL-window Balanced
   favours the rule score (+122% vs +22%), so `rule` stays the default and the
   artifact ships as an experimental option with the shadow period open.
   `learned_v1`/`v2`/`v3_regime` were removed with this change; `learned_v4` is
   the only learned artifact.

### Market-cap search and the optimized preset

The optimizer's parameter space now includes the market-cap **floor and ceiling**
(`min_market_cap` / `max_market_cap`), so universe selection is part of the
search instead of a fixed form field. The retune ran four searches under the
percentile score — 5,400 trials total (1,500 return, 1,500 return with a 50%
drawdown limit, 1,200 return and 1,200 Sharpe with top-5 pinned; 6,500 more ran
under the previous scale) — with funding pinned at 10% and the nested CV→holdout
gate. It produced two families: mid-caps (<$500M) that compound the most but carry −81% drawdowns, and
large caps ($500M–$10B) with Sharpe 1.16–1.62 at −12%…−21% drawdowns but a flat
holdout. The shipped **Optimized** preset blends them: the validated large-cap
family switched to the hold rule (sell < 3) inside a $50M–$1B band, top-5
score-weighted momentum:

| Window | Return (BTC) | Sharpe | Max DD | Rolling-1y positive |
| --- | --- | --- | --- | --- |
| Holdout 2025-04 → 2026-09 | +26% | 1.43 | −7% | 100% |
| 2025+ | +48% | 1.83 | −4% | 100% |
| 2022-2023 | +77% | 1.21 | −15% | 100% |
| Full 2022+ | +150% | 0.80 | −42% | 82% |

The cap band uses today's market caps (look-ahead/survivorship caveat, already
documented for liquidity filters), so the preset is aggressive by design.

### The focused large-cap search and the Hedge preset

Pinning the large-cap band ($500M–$10B), top-5 and the five-name short sleeve and
searching everything else (sharpe / consistency / calmar objectives, 3,600 trials,
funding 10%) produced a much better family than the first pass: long the cheapest
large caps at a breadth-scaled exposure while shorting the five most expensive at
full size, hold rule at sell < 5, IC filter flattening the book when the factor's
rolling IC is weak, equity-trend brake and a 50% profit lock. The best validated
candidate:

| Window (cold start) | Return (BTC) | Sharpe | Max DD |
| --- | --- | --- | --- |
| 2022-2023 | +111% | 1.25 | −19% |
| 2024 | +9% | 0.42 | −21% |
| 2025+ | +55% | 1.81 | −12% |
| Last 17 months (2025-04 →) | −1% | 0.07 | −21% |
| Full 2022+ | **+699%** | **1.62** | −19% |

Every calendar year and every rolling 1-year window in the cold-start run is
positive, turnover is 0.14/week and funding costs ~24% cumulatively. Numbers are
stamped with the 2026-09-14 data vintage: the 2026-09-15 CoinGecko cap refresh
moved FULL from +971% to +699% because the simulator applies today's market caps
to historical filters (Balanced's 2025+ window moved from +31% to −25% in the same
refresh). The keyless daily cap archive is now live: every `sync_coingecko` run appends
today's cap/volume/price per tracked coin to `market_history`, and
`build_snapshot` prefers the archived value at each rebalance date (falling back
to today's cap only where the archive has no coverage). Snapshots also key their
cache on the archive size/timestamp, so a sync invalidates stale snapshots. Dates
before the archive began still carry the old look-ahead, which is why every
number in this document is stamped with its data vintage. Two honest
notes: (1) the **cold-start vs carried** distinction matters here — the optimizer
validates the strategy as a continuous run (its holdout slice is +43% because the
positions and internal state carry over from 2022), while applying the preset on a
fresh date range restarts the book and gives the numbers above; (2) the same
family short-only (long exposure zeroed by the regime switch) was validated by the
calmar objective with a +13% holdout but a −40% full-period drawdown, showing how
much of the edge lives in the short leg. The Hedge preset is the long+short variant. A live call to `GET /api/strategy/signals` with its parameters (2026-09-14 anchor) returns the book sitting in BTC because `rolling_ic` (0.015) is below the 0.05 threshold, with `tracked` listing the carried names and the next-anchor watchlist topped by BCH (score 100) — the exact BTC-parity dip the manual read of the BCH/BTC chart highlighted. Its IC filter (window 12, threshold 0.05, exposure 0%) kept the book flat in BTC for 117 of 245 weeks — the flat rows the Strategy Lab now labels with an "In BTC · factor IC weak" chip, so a 0.00% period return reads as a deliberate de-risk rather than a bug.


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

- Phase 1 (complete): delisted-coin archive (`delisted_at`), point-in-time
  market cap/volume ingestion (`market_history` module, refreshed weekly by
  the worker when a free `COINGECKO_API_KEY` is set), historical recovery of
  coins delisted before the archive existed (Binance data mirror via
  `python -m binance_mirror`), and the `data_quality` report.
- Phase 2 (this harness): point-in-time feature store keyed by rebalance date
  (`feature_store.py`) plus purged/embargoed walk-forward folds (`cv.py`), with
  a leakage regression test proving anchor features never change when future
  candles arrive.
- Phase 3, regime-conditional variant (`learned_v3_regime`, see
  `baselines/model_report_train_regime.json`): fitting only on risk-on anchors
  (where the simulator is allowed to buy) keeps the IC edge (+0.193 vs +0.056,
  CI [+0.073, +0.200]) and lifts the proxy top-3 to **+49.3%**, but the real
  simulator still loses badly: 2025+ OOS rule +18.2% (Sharpe 0.45) vs
  learned_v3 −19.9% (−0.31). A fair threshold sweep (min_score/sell tuned for
  the model) does not rescue it (best −5.8% vs +18.2%). **Three model variants
  and a fair sweep have now failed the strategy gate** while winning on IC and
  proxy metrics — the gate stays closed and `score_model` stays experimental.
  Next ideas if pursued: model the hold/sell dynamics directly instead of
  cross-sectional ranks, or train against simulator outcomes (e.g. Optuna over
  weights) rather than forward-return ranks.
- Phase 4 (shipped): the Strategy Lab exposes a `score_model` selector
  (`rule` default; `learned_v4` is the experimental artifact with its validation
  notes and a clickable feature-importance panel). Shadow scoring remains open —
  the IC gate and the 2025+ simulator A/B are passed, the FULL-window rule score
  still wins, so the artifact is not promoted.

### Phase 3/4 outcome in one line

Learned scores improve cross-sectional IC and proxy portfolios but destroy
strategy returns in the actual simulator — in-sample, out-of-sample and after
per-model threshold tuning. Concrete evidence that the IC gate alone is not
enough and that the strategy gate must stay.

Separation of concerns: *learning a score* failed the gates, while *black-box
optimization over simulator outcomes* is the right tool for "find the best
parameters for this pinned universe" — shipped as `POST /api/backtest/optimize`
(see `backend/optimizer.py`). It runs a nested validation funnel: you add the
parameters to search with **+** (the rest are pinned to editable values) and
Optuna TPE searches on a training region → unique candidates are re-scored by
purged + embargoed walk-forward CV inside that region (the number of folds is
a user-facing knob, `cv_folds`, 1-6) → only finalists touch the trailing
holdout. The **verdict** is a flag, not a filter: every returned candidate is either
*validated* (all CV folds positive, holdout positive and retaining at least
half of the CV edge, `gap_fraction`) or flagged with its exact failure reason
(`passed: false` + `reason`), and the search looks at up to ~60 configurations
when nothing validates so the flagged list still spans different behaviours. Measured: on the
current data both the default and the $1B+ universes end with zero validated
configs, which is itself the honest answer at this sample size.

### Walk-forward reality check (why the gates reject almost everything)

The optimiser now searches with the walk-forward CV score as its objective and
evaluates a **continuous** run (positions carried across fold boundaries —
path-dependent policies cannot be judged by cold-starting the book). Even so,
nothing validates on the default 2022→2026 window, and slicing the shipped
Balanced preset's own curve shows why:

| Slice | Return | Sharpe |
| --- | --- | --- |
| Train 2022-01 → 2025-04 | +228.6% | 0.71 |
| CV fold 2023-02 → 2023-10 | −25.2% | −2.22 |
| CV fold 2023-11 → 2024-07 | −3.0% | 0.10 |
| CV fold 2024-07 → 2025-04 | +20.4% | 0.83 |
| Holdout 2025-04 → 2026-09 | −10.2% | −0.26 |

The whole training gain comes from entries made in 2022; once the measurement
starts in 2023 the same policy is flat-to-negative. The earlier "+19.7% OOS
2025+" headline was itself start-date sensitive (2025-01 vs 2025-04 flips the
sign). Conclusion: on this dataset the value-dip edge is vintage-concentrated,
and the validation gates are telling the truth — keep the presets as
reference, not as a promise, and test different universes/windows.

### Chasing sustained returns (what actually works)

A single vintage spike followed by flat years is not repeatable income, so
consistency is now measured explicitly (positive-year share, rolling 1-year
positive share, time in drawdown, share of gains from the best 5% of periods)
and the optimizer can target it directly (`objective=consistency`). Findings
from scanning the strategy space:

- Exit overlays do not create consistency: trailing stops and stop-losses are
  catastrophic on volatile alts (rolling-positive share 4-31%), take-profit
  above 200% is identical to doing nothing, take-profit at 50% caps the edge.
- Higher market caps are much worse (`min_market_cap` $100M-$1B: every year
  negative, rolling-positive share 7-19%) — the dip edge lives in smaller
  alts, at the price of survivorship risk.
- An equity-curve overlay (scale exposure down while the strategy's own equity
  is below its moving average) modestly improves the recent years (−14% →
  −9% in 2025, −12% → −3% in 2026) at a small total-return cost, and halves
  the drawdown at exposure 0.
- A profit-lock rule that moves part of the book to BTC every time equity
  doubles triggers too late to matter on this data.
- With `objective=consistency`, every top candidate still fails the
  "holdout loses money" gate: on this dataset the long-only alt-dip family has
  no configuration with sustained out-of-sample returns. The honest product
  answer is capital preservation (sit in BTC when risk-off) plus episodic
  alpha, not steady compounding.

### Market-neutral sleeve (long cheap / short expensive)

The long-only book bleeds when the whole alt market bleeds, so the simulator
has a short sleeve: the most expensive coins (lowest scores, optionally
`short_max_score`) are shorted every anchor, sized by `short_exposure` and
charged a `short_funding_apr` drag. Measured on the Balanced preset:

| Variant | Total | Sharpe | Max DD | Gains from best 5% of periods | Funding drag |
| --- | --- | --- | --- | --- | --- |
| long-only | +191% | 0.56 | −33% | 61% | 0% |
| short n3 @25%, 10% APR | **+316%** | **0.66** | −32% | **54%** | 12% |
| short n3 @50%, 10% APR | +401% | 0.72 | −45% | 47% | 24% |
| short n3 @75%, 10% APR | +405% | 0.74 | −59% | 41% | 35% |

The sleeve makes the return stream broader-based (concentration 61% → 41-54%,
Sharpe up, drawdown unchanged at 25% exposure) and improves the train and
2025+ windows, but the latest holdout (2025-04 → 2026-09) stays negative
(−12% → −19% at 25% exposure): the cheap-vs-expensive spread itself inverted
in that regime. Funding is the main practical cost — 20% APR roughly halves
the sleeve's contribution. Conclusion: the short sleeve is a real
diversification improvement for the return *sources*, not a fix for the most
recent regime.

### BTC accumulation is the objective (not holding altcoins)

Everything above is measured in BTC, but the *behaviour* also has to aim at
growing the BTC balance rather than collecting alt bags. Two mechanics were
added for that: `profit_sweep_pct` harvests a share of each position's BTC
gain back into BTC (persisted per position), and `max_holding_periods`
returns stale positions to BTC. Measured on the long-short Balanced preset
(2022+):

| Variant | Total | Sharpe | Max DD | Gains from best 5% | Avg alt exposure |
| --- | --- | --- | --- | --- | --- |
| LS baseline | +316% | 0.66 | −32% | 54% | 1.00 |
| sweep 30% | +265% | 0.70 | −30% | 52% | 0.85 |
| sweep 50% | +232% | 0.71 | −29% | 51% | 0.79 |
| sweep 70% | +203% | 0.72 | −29% | 49% | 0.76 |
| max holding 52 | +339% | 0.69 | −48% | 61% | 0.99 |
| max holding 26 | +142% | 0.53 | −74% | 60% | 0.97 |

Sweeping trades upside for steadiness: Sharpe up, drawdown down, gains less
concentrated, and the book spends more of its weight in BTC. On the recent
windows it also helps (2024+: −41% → −11%; 2025+ Sharpe 0.5 → 0.6), though
the last holdout (2025-04→2026-09) stays slightly negative. Time stops are
the wrong tool here — forcing exits into weakness wrecked consistency
(rolling-positive share 65% → 53%) — so they ship off by default.

### Factor timing: the cheapness spread alternates

Measuring the pure market-neutral spread (long the 3 cheapest, short the 3
most expensive, equal weight, no funding) confirms the cross-sectional factor
is regime-dependent rather than persistently profitable:

| Window | Spread return | Sharpe |
| --- | --- | --- |
| 2022-01 → 2023-06 | +57.7% | 1.01 |
| 2023-06 → 2024-06 | −42.8% | −0.51 |
| 2024-06 → 2025-04 | +10.5% | 0.50 |
| 2025-04 → 2026-09 (holdout) | −48.5% | −0.11 |

A 300-trial `objective=consistency` search over 13 parameters (including the
short sleeve and profit sweep, loose gates) still produced **zero** candidates
that make money in the holdout — the losses come too fast for equity-trend
timing to dodge them. Flipping the factor (`invert_score`: long expensive,
short cheap) is worse, not mirrored (−97% vs −42% over the full period;
the expensive basket falls much harder than the cheap one rises), and it is
also negative in the holdout. Practical conclusion: in an inverted regime the
honest position for this product is BTC, not a factor bet.

### Factor-IC timing (tested, rejected)

The simulator can also time the factor on its own rolling information
coefficient (`ic_filter` / `ic_window` / `ic_threshold` / `ic_exposure`):
each anchor measures how well the score ranked the previous period's
cross-sectional returns and shrinks exposure while that rolling IC is below
the threshold. Measured on the Balanced long-short preset:

| IC exposure | Full 2022+ | Holdout 2025-04+ | 2025+ |
| --- | --- | --- | --- |
| filter off | +248% / 0.7 | −10% / 0.0 | +30% / 0.6 |
| 0% | +465% / 0.9 | −22% / −0.6 | −17% / −0.6 |
| 35% | +381% / 0.9 | −16% / −0.3 | −1% / 0.1 |
| 70% | +306% / 0.8 | −12% / −0.1 | +15% / 0.4 |

IC timing raises the full-period number (it dodges the 2023-24 chop) but
makes the recent windows worse: the losses arrive faster than the rolling IC
can react, and re-entry happens right before the next leg down. It ships as
a research parameter, off by default — the practical response to an inverted
factor regime remains sitting in BTC.

### "Optimize all" with the consistency objective finds the first holdout-positive configs

Searching all 24 parameters at once (consistency objective, loose verdict,
30 trials) produced three **validated** candidates — the first configurations
that are positive in both the CV folds and the untouched holdout. The clearest
winner is a momentum-side, market-cap-weighted, swept book:

`top_n=4, min_score=10, invert_score=true, weighting=market_cap, rotation=rebalance,
profit_sweep=30%, stop 30 / trail 50 / TP 100, no regime filter, short sleeve off`

| Window | Return | Sharpe | Max DD |
| --- | --- | --- | --- |
| Holdout 2025-04 → 2026-09 | **+56.0%** | **0.96** | −25% |
| 2025+ | +30.5% | 0.57 | −33% |
| Full 2022+ | +109% | 0.54 | −62% |
| 2024+ | −20.4% | 0.12 | −61% |

Read it honestly: the config wins where the *momentum* side wins (the factor
inversion documented above) and carries a −62% full-period drawdown from the
2022-2024 stretch. It is a regime-timing discovery surfaced by the optimizer,
not an all-weather strategy — which is exactly why the search now always shows
its candidates with verdicts instead of hiding them.

### The large search (5,000+ trials) and the funding trap

Following that lead we ran the full-scope search much harder — 2,000 trials
with the **consistency** objective, 1,500 with **Sharpe**, 1,500 with
**return** — and the objectives told different stories:

- **consistency / Sharpe overfit the CV.** Their top candidates looked superb
  in-sample (+354…+375% full, Sharpe 1.3) and lost 31-35% in the holdout. More
  trials made this *worse*, not better — TPE got better at exploiting the
  validation window's quirks.
- **return** produced 5 validated candidates, all in one family: the momentum
  side (`invert_score=true`), market-cap weights, IC filter with a 0-35%
  risk-off exposure, a short sleeve, stops 30/50-75/100 and a 30-50% sweep.
  The single best variant kept `ic_exposure=0.35` (partial de-risk),
  half-sized the short book and paid a realistic 10% funding rate.

Funding is the trap worth recording: the unconstrained winners set
`short_funding_apr=0`, which is not a real assumption. Charging 10% APR costs
20-40% cumulatively over this window (short notional averages 0.4-0.9) and was
the difference between "holdout +25%" and "holdout −2%" for otherwise similar
configs. The search was therefore re-run with funding pinned at 10%; its one
validated winner became the **Optimized** preset in the UI:

`top_n=9, min_score=45, momentum side, market_cap weights, hold/exits at
sell_score=20, trend ≥ −40, stops 40/75/100, breadth gate at full exposure,
equity-trend brake 35%, IC filter @0.35 window 4, profit lock 25%, sweep 30%,
max hold 52, short n5 @100%, funding 10%`

| Window | Return (BTC) | Sharpe | Max DD | Rolling-1y positive |
| --- | --- | --- | --- | --- |
| Holdout 2025-04 → 2026-09 | +11% | 0.38 | −29% | 100% |
| 2025+ | +91% | 1.11 | −22% | 100% |
| 2024 | +55% | 0.96 | −47% | 100% |
| 2022-2023 | +39% | 0.56 | −66% | 58% |
| Full 2022+ | **+630%** | **1.04** | −66% | 89% |

So the honest position stands: the highest-return answer is the *momentum*
side with the factor-timing filter and a funded short sleeve, it compounds BTC
much faster than the classic presets (+630% vs +232% for Balanced) and it
accepts a −66% drawdown to do it. The classic value-side presets remain the
steadier choice; the Optimized preset is the empirically searched aggressive
one, not a claim of all-weather robustness.

Operational note: the recovered delisted universe (623 symbols) made cold
snapshot builds heavier (weekly ≈ 27 s, monthly ≈ 8 s, cached afterwards, up
to four snapshots LRU). The next performance step is incremental stats
(sorted trailing windows maintained across anchors instead of re-sorting the
full prefix per anchor).
