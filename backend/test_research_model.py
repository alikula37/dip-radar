import random

from research.model import (
    FEATURE_DIRECTIONS,
    build_samples,
    evaluate,
    fit_nonnegative,
    rank_percentiles,
)


def test_rank_percentiles_handle_ties_and_bounds():
    assert rank_percentiles([1, 2, 2, 4]) == [0.0, 0.5, 0.5, 1.0]
    assert rank_percentiles([7]) == [0.5]


def test_nonnegative_solver_recovers_known_weights():
    rng = random.Random(3)
    features = [[rng.uniform(0, 1), rng.uniform(0, 1), rng.uniform(0, 1)] for _ in range(400)]
    targets = [0.8 * row[0] + 0.2 * row[1] - 0.5 for row in features]

    weights = fit_nonnegative(features, targets, iterations=600)

    assert weights[0] > weights[1] > 0
    assert weights[2] < 0.05


def _synthetic_rows(anchors=40, symbols=12, seed=11):
    rng = random.Random(seed)
    rows = []
    for anchor in range(anchors):
        date = f"2023-{anchor % 12 + 1:02d}-{anchor + 1:02d}"
        for symbol_index in range(symbols):
            quality = rng.uniform(0, 1)
            row = {
                "date": date,
                "symbol": f"COIN{symbol_index}USDT",
                "price": 100.0 - quality * 10 + anchor * 0.1,
                "score": 50.0 + quality * 50.0,
                "valuation_pct_3y": quality * 100.0,
            }
            for name in FEATURE_DIRECTIONS:
                if name == "abs_median_dist_3y":
                    row["median_dist_3y"] = quality * 50.0 - 25.0
                elif name == "valuation_pct_1y":
                    row["valuation_pct_1y"] = quality * 100.0
                elif name == "valuation_pct_all":
                    row["valuation_pct_all"] = quality * 100.0
                else:
                    row[name] = rng.uniform(0, 1)
            rows.append(row)
    return rows


def test_build_samples_orients_cheapness_features():
    rows = _synthetic_rows(anchors=2, symbols=4)
    # Same quality ordering across symbols so forward returns are predictable.
    anchors = build_samples(rows, horizon=1, min_universe=3)

    assert len(anchors) == 1
    anchor = anchors[0]
    # valuation_pct_1y has direction -1, so the cheapest coin (lowest
    # percentile) must receive the highest oriented feature value.
    column = list(FEATURE_DIRECTIONS).index("valuation_pct_1y")
    oriented = [vector[column] for vector in anchor["features"]]
    raw = [row["valuation_pct_1y"] for row in rows if row["date"] == anchor["date"]]
    cheapest = raw.index(min(raw))
    assert oriented[cheapest] == max(oriented)
    assert all(-0.5 <= label <= 0.5 for label in anchor["labels"])


def test_evaluate_produces_fold_comparison():
    rows = _synthetic_rows(anchors=48, symbols=15)
    anchors = build_samples(rows, horizon=1, min_universe=5)

    report = evaluate(anchors, horizon=1, test_size=10, min_train=20, embargo=1)

    assert report["folds"]
    assert "model_ic" in report and "baseline_ic" in report and "ic_delta" in report
    assert report["model_ic"]["n"] == report["baseline_ic"]["n"] > 0
    assert all("weights" in fold for fold in report["folds"])
    assert set(report["mean_weights"]) == set(FEATURE_DIRECTIONS)
