from datetime import datetime

import pytest

from research import common
from research.stats import block_bootstrap_ci, pearson, ranks, spearman, summarize


def test_average_ranks_handle_ties():
    assert ranks([10, 20, 20, 30]) == [0.0, 1.5, 1.5, 3.0]


def test_spearman_detects_monotonic_relations():
    assert spearman([1, 2, 3, 4], [10, 20, 30, 40]) == 1.0
    assert spearman([1, 2, 3, 4], [40, 30, 20, 10]) == -1.0
    assert spearman([1, 1, 1, 1], [10, 20, 30, 40]) is None
    assert pearson([1, 2], [3, 4]) is None


def test_summarize_reports_mean_t_and_win_share():
    summary = summarize([0.1, -0.05, 0.2, 0.05])

    assert summary["n"] == 4
    assert summary["mean"] == 0.075
    assert summary["positive_share"] == 0.75
    assert summary["t"] > 0
    assert summarize([])["n"] == 0


def test_block_bootstrap_is_deterministic_and_covers_the_mean():
    values = [0.05, -0.1, 0.2, 0.0, 0.15, -0.05, 0.1, 0.02, -0.08, 0.12]

    first = block_bootstrap_ci(values, block=3, draws=500, seed=11)
    second = block_bootstrap_ci(values, block=3, draws=500, seed=11)

    assert first == second
    mean = sum(values) / len(values)
    assert first[0] <= mean <= first[1]


def _snapshot():
    dates = [datetime(2023, 1, 1), datetime(2023, 2, 1)]

    def entry(price, score):
        return {"score": score, "price": price, "distance": 0.0, "trend_30d": 0.0, "above_sma200": True}

    return {
        "frequency": "monthly",
        "dates": dates,
        "entries": {
            dates[0]: {
                "AAAUSDT": entry(100.0, 90.0),
                "BBBUSDT": entry(100.0, 50.0),
                "CCCUSDT": entry(100.0, 10.0),
            },
            dates[1]: {
                "AAAUSDT": entry(120.0, 90.0),
                "BBBUSDT": entry(100.0, 50.0),
                "CCCUSDT": entry(90.0, 10.0),
            },
        },
        "rates": {},
        "rate_dates": [],
        "series": {},
    }


def test_forward_returns_require_enough_symbols():
    snapshot = _snapshot()

    assert len(list(common.forward_return_pairs(snapshot, 1, min_universe=4))) == 0
    pairs = list(common.forward_return_pairs(snapshot, 1, min_universe=3))
    assert len(pairs) == 1


def test_ic_and_spread_track_a_perfect_signal():
    snapshot = _snapshot()

    assert common.ic_series(snapshot, lambda entry: entry["score"], 1, 3) == [1.0]
    spreads = common.quintile_spread_series(snapshot, lambda entry: entry["score"], 1, 3)
    assert spreads[0] == pytest.approx(0.3)
