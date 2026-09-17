"""Constrained learned score evaluated with purged walk-forward folds.

Design choices (see research/README.md for the gates):

- Features are cross-sectional rank percentiles of the point-in-time feature
  store, oriented by a fixed prior direction (cheaper/lower-risk = higher
  expected return). Directions are *not* learned — that removes sign flips
  that would be pure noise on ~100 anchors.
- The model is non-negative least squares of forward-return ranks on those
  oriented ranks: tiny, interpretable, and only magnitudes are learned.
- Evaluation is purged + embargoed walk-forward CV; every metric is compared
  against the frozen rule-based score on the exact same test anchors.

Usage (from backend/):

    python -m research.model --frequency monthly
    python -m research.model --frequency monthly --save research/baselines/model_report.json
"""

import argparse
import json
import math
import os

from research import common
from research.cv import assert_no_overlap, walk_forward_folds
from research.stats import block_bootstrap_ci, summarize

FEATURE_DIRECTIONS = {
    # feature column in the store -> +1 if a larger value should predict
    # higher forward returns, -1 if smaller is better.
    "valuation_pct_1y": -1,
    "valuation_pct_3y": -1,
    "valuation_pct_all": -1,
    "distance": -1,
    "abs_median_dist_3y": -1,
    "basing_pct_90d": +1,
    "range_position": -1,
    "trend_7d": +1,
    "trend_90d": +1,
    "trend_180d": +1,
    "trend_365d": +1,
    "volatility_90d": -1,
    "drawdown_from_ath": -1,
    "days_since_ath": +1,
    "dollar_volume_30d": +1,
    "band_p05_dist_3y": -1,
    "band_p25_dist_3y": -1,
    "band_p75_dist_3y": -1,
    "band_p95_dist_3y": -1,
    "band_iqr_width_3y": -1,
    "band_span_width_3y": -1,
    "above_p75_3y": -1,
    "below_p25_3y": +1,
    "top_band_share_90d": -1,
    "dip_bounces": +1,
    "dip_bounce_avg": +1,
}


def _feature_value(row: dict, name: str):
    if name == "abs_median_dist_3y":
        value = row.get("median_dist_3y")
        return abs(value) if value is not None else None
    return row.get(name)


def rank_percentiles(values: list):
    """Average-rank percentiles in [0, 1]; None when a value is missing."""
    order = sorted(range(len(values)), key=lambda index: values[index])
    result = [0.0] * len(values)
    index = 0
    while index < len(order):
        end = index
        while end + 1 < len(order) and values[order[end + 1]] == values[order[index]]:
            end += 1
        average = ((index + end) / 2.0) / (len(values) - 1) if len(values) > 1 else 0.5
        for position in range(index, end + 1):
            result[order[position]] = average
        index = end + 1
    return result


def build_samples(rows: list, horizon: int = 1, min_universe: int = 30, regime_only: bool = False) -> list:
    """Group feature rows into dated cross-sections with forward-return labels.

    ``regime_only`` keeps only anchors where the alt/BTC trend is above its SMA
    (the periods the simulator is actually allowed to buy in).

    Returns a list of anchors: ``{"date", "symbols", "features", "labels",
    "baseline", "forward", "alt_above_sma", "breadth"}`` where ``labels`` are
    centered rank percentiles of the forward return and ``features`` are
    oriented rank percentiles.
    """
    by_date = {}
    for row in rows:
        by_date.setdefault(row["date"], {})[row["symbol"]] = row
    dates = sorted(by_date)

    anchors = []
    for index in range(len(dates) - horizon):
        date = dates[index]
        future = by_date[dates[index + horizon]]
        pool = by_date[date]
        symbols = [symbol for symbol in pool if symbol in future and pool[symbol]["price"]]
        if len(symbols) < min_universe:
            continue

        reference = pool[symbols[0]]
        if regime_only and reference.get("alt_above_sma") is not True:
            continue

        forward = [future[symbol]["price"] / pool[symbol]["price"] - 1.0 for symbol in symbols]
        labels = [value - 0.5 for value in rank_percentiles(forward)]

        features = []
        for symbol in symbols:
            row = pool[symbol]
            vector = []
            for name, direction in FEATURE_DIRECTIONS.items():
                value = _feature_value(row, name)
                vector.append(value if value is not None else math.nan)
            features.append(vector)

        # Fill missing values per feature with the cross-sectional median so
        # the solver never sees NaNs (the information "missing" is not used).
        width = len(FEATURE_DIRECTIONS)
        medians = []
        for column in range(width):
            present = sorted(vector[column] for vector in features if not math.isnan(vector[column]))
            medians.append(present[len(present) // 2] if present else 0.0)
        oriented = []
        for vector in features:
            values = [
                medians[column] if math.isnan(vector[column]) else vector[column]
                for column in range(width)
            ]
            ranked = rank_percentiles(values)
            oriented.append(
                [
                    percentile if direction > 0 else 1.0 - percentile
                    for direction, percentile in zip(FEATURE_DIRECTIONS.values(), ranked)
                ]
            )

        anchors.append(
            {
                "date": date,
                "symbols": symbols,
                "features": oriented,
                "labels": labels,
                "baseline": [pool[symbol]["score"] for symbol in symbols],
                "forward": forward,
                "alt_above_sma": reference.get("alt_above_sma"),
                "breadth": reference.get("breadth"),
            }
        )
    return anchors


def standardize(features: list):
    """Column standardization shared by training and artifact export."""
    width = len(features[0])
    count = len(features)
    means = [sum(row[column] for row in features) / count for column in range(width)]
    scales = []
    for column in range(width):
        variance = sum((row[column] - means[column]) ** 2 for row in features) / max(1, count - 1)
        scales.append(math.sqrt(variance) or 1.0)
    standardized = [
        [(row[column] - means[column]) / scales[column] for column in range(width)] for row in features
    ]
    return standardized, means, scales


def fit_standardized(standardized: list, targets: list, iterations: int = 60, l2: float = 0.05):
    """Non-negative least squares on already standardized columns."""
    if not standardized:
        return []
    width = len(standardized[0])
    count = len(standardized)
    target_mean = sum(targets) / count
    centered = [target - target_mean for target in targets]

    weights = [0.0] * width
    predictions = [0.0] * count
    for _ in range(iterations):
        for column in range(width):
            numerator = 0.0
            denominator = l2 * count
            for index in range(count):
                value = standardized[index][column]
                residual = centered[index] - predictions[index] + weights[column] * value
                numerator += value * residual
                denominator += value * value
            updated = max(0.0, numerator / denominator) if denominator else 0.0
            delta = updated - weights[column]
            if delta:
                weights[column] = updated
                for index in range(count):
                    predictions[index] += delta * standardized[index][column]
    return weights


def fit_nonnegative(features: list, targets: list, iterations: int = 60, l2: float = 0.05):
    """Non-negative least squares via cyclic coordinate descent.

    Each coordinate is solved in closed form against the partial residual, so
    the fit is stable without tuning a learning rate; ``l2`` is a per-sample
    ridge that shrinks unstable weights toward zero.
    """
    standardized, _, _ = standardize(features)
    return fit_standardized(standardized, targets, iterations, l2)


def _rank_ic(scores: list, forward: list):
    from research.stats import spearman

    return spearman(scores, forward)


def _quintile_spread(scores: list, forward: list) -> float:
    ordered = sorted(zip(scores, forward))
    top = max(1, len(ordered) // 5)
    return sum(value for _, value in ordered[-top:]) / top - sum(value for _, value in ordered[:top]) / top


def _top_n_return(scores: list, forward: list, top_n: int = 3) -> float:
    ordered = sorted(zip(scores, forward), key=lambda item: -item[0])
    picks = ordered[:top_n]
    return sum(value for _, value in picks) / len(picks)


def _curve_metrics(period_returns: list, periods_per_year: int = 12) -> dict:
    equity = 1.0
    peak = 1.0
    max_drawdown = 0.0
    for period_return in period_returns:
        equity *= 1.0 + period_return
        peak = max(peak, equity)
        max_drawdown = min(max_drawdown, equity / peak - 1.0)
    count = len(period_returns)
    mean = sum(period_returns) / count if count else 0.0
    if count > 1:
        variance = sum((value - mean) ** 2 for value in period_returns) / (count - 1)
        std = math.sqrt(variance)
    else:
        std = 0.0
    return {
        "total_return": equity - 1.0,
        "sharpe": (mean / std) * math.sqrt(periods_per_year) if std else 0.0,
        "max_drawdown": max_drawdown,
        "periods": count,
    }


def evaluate(
    anchors: list,
    horizon: int = 1,
    test_size: int = 12,
    min_train: int = 24,
    embargo: int = 1,
    periods_per_year: int = 12,
    train_regime_only: bool = False,
) -> dict:
    folds = walk_forward_folds(len(anchors), horizon, test_size, min_train, embargo)
    assert_no_overlap(folds, horizon)
    if not folds:
        return {"folds": [], "error": "not enough anchors for walk-forward evaluation"}

    fold_reports = []
    model_ics = []
    baseline_ics = []
    model_spreads = []
    baseline_spreads = []
    weight_history = []
    model_periods = []
    baseline_periods = []
    universe_periods = []
    model_ics_risk_on = []
    baseline_ics_risk_on = []

    for fold in folds:
        train = anchors[fold["train"][0] : fold["train"][1]]
        if train_regime_only:
            train = [anchor for anchor in train if anchor.get("alt_above_sma") is True]
        test = anchors[fold["test"][0] : fold["test"][1]]
        if len(train) < 6:
            continue

        train_features = [vector for anchor in train for vector in anchor["features"]]
        train_labels = [label for anchor in train for label in anchor["labels"]]
        weights = fit_nonnegative(train_features, train_labels)
        weight_history.append(weights)

        fold_ic_deltas = []
        for anchor in test:
            predictions = [
                sum(weight * value for weight, value in zip(weights, vector))
                for vector in anchor["features"]
            ]
            model_ic = _rank_ic(predictions, anchor["forward"])
            baseline_ic = _rank_ic(anchor["baseline"], anchor["forward"])
            model_spread = _quintile_spread(predictions, anchor["forward"])
            baseline_spread = _quintile_spread(anchor["baseline"], anchor["forward"])
            if model_ic is None or baseline_ic is None:
                continue
            model_ics.append(model_ic)
            baseline_ics.append(baseline_ic)
            model_spreads.append(model_spread)
            baseline_spreads.append(baseline_spread)
            fold_ic_deltas.append(model_ic - baseline_ic)
            model_periods.append(_top_n_return(predictions, anchor["forward"]))
            baseline_periods.append(_top_n_return(anchor["baseline"], anchor["forward"]))
            universe_periods.append(sum(anchor["forward"]) / len(anchor["forward"]))
            if anchor.get("alt_above_sma") is True:
                model_ics_risk_on.append(model_ic)
                baseline_ics_risk_on.append(baseline_ic)

        fold_reports.append(
            {
                "train": [train[0]["date"], train[-1]["date"]],
                "test": [test[0]["date"], test[-1]["date"]],
                "weights": {
                    name: round(weight, 4) for name, weight in zip(FEATURE_DIRECTIONS, weights)
                },
                "mean_ic_delta": sum(fold_ic_deltas) / len(fold_ic_deltas) if fold_ic_deltas else None,
            }
        )

    deltas = [model - baseline for model, baseline in zip(model_ics, baseline_ics)]

    return {
        "folds": fold_reports,
        "model_ic": summarize(model_ics),
        "baseline_ic": summarize(baseline_ics),
        "risk_on_ic": {
            "model": summarize(model_ics_risk_on),
            "baseline": summarize(baseline_ics_risk_on),
        },
        "ic_delta": {**summarize(deltas), "ci95": list(block_bootstrap_ci(deltas, 3))},
        "model_spread": summarize(model_spreads),
        "baseline_spread": summarize(baseline_spreads),
        "strategy": {
            "model_top3": _curve_metrics(model_periods, periods_per_year),
            "baseline_top3": _curve_metrics(baseline_periods, periods_per_year),
            "universe_mean": _curve_metrics(universe_periods, periods_per_year),
        },
        "mean_weights": {
            name: sum(history[index] for history in weight_history) / len(weight_history)
            for index, name in enumerate(FEATURE_DIRECTIONS)
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frequency", default="monthly", choices=["weekly", "monthly", "quarterly"])
    parser.add_argument("--horizon", type=int, default=1)
    parser.add_argument("--test-size", type=int, default=12)
    parser.add_argument("--min-train", type=int, default=24)
    parser.add_argument("--embargo", type=int, default=1)
    parser.add_argument("--start", default="2020-01-01", help="Ignore anchors before this date")
    parser.add_argument("--regime-only", action="store_true", help="Evaluate only on risk-on anchors (diagnostic)")
    parser.add_argument("--train-regime-only", action="store_true", help="Fit on risk-on anchors, evaluate on all")
    parser.add_argument("--save", default=None)
    args = parser.parse_args()

    from research.feature_store import build_feature_rows

    session = common.db_session()
    try:
        rows = build_feature_rows(session, args.frequency)
    finally:
        session.close()

    rows = [row for row in rows if row["date"] >= args.start]
    anchors = build_samples(rows, horizon=args.horizon, regime_only=args.regime_only)
    periods_per_year = {"weekly": 52, "monthly": 12, "quarterly": 4}[args.frequency]
    report = evaluate(
        anchors,
        args.horizon,
        args.test_size,
        args.min_train,
        args.embargo,
        periods_per_year,
        train_regime_only=args.train_regime_only,
    )
    report["provenance"] = {
        "frequency": args.frequency,
        "horizon": args.horizon,
        "embargo": args.embargo,
        "anchors": len(anchors),
        "start": args.start,
        "regime_only": args.regime_only,
        "train_regime_only": args.train_regime_only,
        "git_commit": common.git_commit(),
    }

    if "error" in report:
        print(report["error"])
        return

    print(f"anchors: {len(anchors)} · folds: {len(report['folds'])}")
    for fold in report["folds"]:
        print(
            f"  train {fold['train'][0]}→{fold['train'][1]} "
            f"test {fold['test'][0]}→{fold['test'][1]} "
            f"ic_delta {fold['mean_ic_delta']:+.3f}"
        )
    for label in ("baseline_ic", "model_ic"):
        summary = report[label]
        print(f"{label:12s} mean {summary['mean']:+.3f}  t≈{summary['t']:5.2f}  n={summary['n']}")
    delta = report["ic_delta"]
    print(f"ic_delta     mean {delta['mean']:+.3f}  t≈{delta['t']:5.2f}  CI95 [{delta['ci95'][0]:+.3f}, {delta['ci95'][1]:+.3f}]")
    print("strategy (test anchors only, top-3 equal weight, no fees):")
    for label, curve in report["strategy"].items():
        print(
            f"  {label:14s} return {curve['total_return'] * 100:+7.1f}%  sharpe {curve['sharpe']:5.2f}  "
            f"maxDD {curve['max_drawdown'] * 100:6.1f}%"
        )
    print("mean weights:")
    for name, weight in sorted(report["mean_weights"].items(), key=lambda item: -item[1]):
        print(f"  {name:22s} {weight:+.4f}")

    if args.save:
        path = os.path.abspath(args.save)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as handle:
            json.dump(report, handle, indent=2, sort_keys=True)
        print(f"saved {path}")


if __name__ == "__main__":
    main()
