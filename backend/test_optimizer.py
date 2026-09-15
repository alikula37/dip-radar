import json
from datetime import datetime, timedelta

from optimizer import (
    DEFAULT_FIXED_PARAMS,
    DEFAULT_SEARCH_PARAMS,
    PARAM_NAMES,
    _sample,
    optimize_strategy,
    validate_scope,
)

START = datetime(2022, 1, 1)


def _snapshot(anchors=12, symbols=6, cap=50_000_000.0, volume=1_000_000.0):
    dates = [
        datetime(2022, 1, 1) + timedelta(days=30 * index)
        for index in range(anchors)
    ]

    def entry(price, symbol_index):
        return {
            "symbol": f"COIN{symbol_index}",
            "score": 50.0 + symbol_index * 7,
            "price": price,
            "cap": cap,
            "volume": volume,
            "distance": 10.0 * symbol_index,
            "trend_30d": -10.0,
            "above_sma200": True,
        }

    entries = {}
    for index, date in enumerate(dates):
        entries[date] = {
            f"COIN{symbol_index}": entry(100.0 + 5.0 * symbol_index + index * (symbol_index - 2), symbol_index)
            for symbol_index in range(symbols)
        }

    regime = {
        date: {"alt_above_sma": index % 2 == 0, "breadth": 0.6 if index % 2 == 0 else 0.3}
        for index, date in enumerate(dates)
    }

    return {
        "frequency": "monthly",
        "end": dates[-1],
        "dates": dates,
        "entries": entries,
        "regime": regime,
        "rates": {},
        "rate_dates": [],
        "series": {},
    }


def test_sample_is_deterministic_for_a_seed():
    import random

    first = _sample(random.Random(3), DEFAULT_SEARCH_PARAMS)
    second = _sample(random.Random(3), DEFAULT_SEARCH_PARAMS)

    assert first == second
    assert 2 <= first["top_n"] <= 10
    assert set(first) == set(DEFAULT_SEARCH_PARAMS)


def test_scope_validation_requires_full_coverage():
    optimize, pinned = validate_scope(
        ["top_n", "min_score"],
        {"sell_score": None, "min_trend_30d": None, "weighting": "score", "rotation": "hold",
         "regime_filter": None, "regime_exposure": 1.0, "trailing_stop_pct": None,
         "take_profit_pct": None, "stop_loss_pct": None},
    )
    assert optimize == ["top_n", "min_score"]
    assert pinned["weighting"] == "score"

    import pytest

    with pytest.raises(Exception):
        validate_scope(["top_n"], {})  # missing parameters
    with pytest.raises(Exception):
        validate_scope(["top_n", "moon"], {"min_score": 50})
    with pytest.raises(Exception):
        validate_scope(
            ["top_n"],
            {"top_n": 5, **{name: None for name in PARAM_NAMES if name not in ("top_n", "min_score")}},
        )  # overlap + missing


def test_optimizer_returns_ranked_candidates_with_a_holdout():
    result = optimize_strategy(
        _snapshot(),
        start=START,
        end=START + timedelta(days=30 * 11),
        min_market_cap=0,
        min_volume=0,
        fee_pct=0.1,
        fill_with_btc=True,
        objective="sharpe",
        trials=12,
        validation_fraction=0.3,
        seed=5,
        top_k=3,
    )

    assert result["optimizer"] in ("optuna-tpe", "random")
    assert result["evaluated"] > 0
    assert len(result["best"]) <= 3
    for candidate in result["best"]:
        assert candidate["train_metrics"] is not None
        assert candidate["cv_metrics"]["mean"] > 0
        assert set(candidate["params"]) == set(DEFAULT_SEARCH_PARAMS)
    assert result["train"]["end"] <= result["holdout"]["start"]
    assert set(result["fixed_params"]) == set(DEFAULT_FIXED_PARAMS)


def test_optimizer_respects_universe_constraints():
    result = optimize_strategy(
        _snapshot(),
        start=START,
        end=START + timedelta(days=30 * 11),
        min_market_cap=0,
        min_volume=10_000_000_000.0,  # nothing passes the volume filter
        fee_pct=0.1,
        fill_with_btc=True,
        objective="return",
        trials=6,
        seed=1,
        top_k=2,
    )

    assert result["evaluated"] > 0
    assert result["best"] == []
    assert result["validated"] == 0
    assert result["message"]


def _crashing_snapshot():
    """Same shape as _snapshot but every price falls 12% per anchor."""
    snapshot = _snapshot()
    dates = snapshot["dates"]
    for index, date in enumerate(dates):
        for symbol, entry in snapshot["entries"][date].items():
            entry["price"] = 100.0 * (0.88**index)
    return snapshot


def test_optimizer_drawdown_limit_rejects_everything_when_impossible():
    result = optimize_strategy(
        _crashing_snapshot(),
        start=START,
        end=START + timedelta(days=30 * 11),
        min_market_cap=0,
        min_volume=0,
        fee_pct=0.1,
        fill_with_btc=True,
        objective="return",
        trials=8,
        max_drawdown_limit=0.0001,
        seed=2,
        top_k=3,
    )

    # Nothing survives the drawdown + validation gates on a crash.
    assert result["best"] == []
    assert result["validated"] == 0
    assert result["message"]


def test_optimizer_is_reproducible_for_a_seed():
    kwargs = {
        "start": START,
        "end": START + timedelta(days=30 * 7),
        "min_market_cap": 0,
        "min_volume": 0,
        "fee_pct": 0.1,
        "fill_with_btc": True,
        "objective": "sharpe",
        "trials": 10,
        "seed": 11,
        "top_k": 2,
    }

    first = optimize_strategy(_snapshot(), **kwargs)
    second = optimize_strategy(_snapshot(), **kwargs)

    assert [candidate["params"] for candidate in first["best"]] == [
        candidate["params"] for candidate in second["best"]
    ]


def test_optimizer_reports_purged_cv_and_rejects_overfits():
    result = optimize_strategy(
        _crashing_snapshot(),
        start=START,
        end=START + timedelta(days=30 * 11),
        min_market_cap=0,
        min_volume=0,
        fee_pct=0.1,
        fill_with_btc=True,
        objective="sharpe",
        trials=8,
        seed=4,
        top_k=3,
    )

    assert result["cv"]["folds"]
    assert result["cv"]["horizon_anchors"] == 1
    assert result["cv"]["embargo_anchors"] == 1
    holdout_start = result["holdout"]["start"]
    for fold in result["cv"]["folds"]:
        assert fold["test"][1] <= holdout_start  # CV never touches the holdout
    assert result["best"] == []  # everything loses in a crash
    assert result["validated"] == 0
    assert result["rejected"]["count"] > 0
    assert result["message"]


def test_optimizer_returns_unique_configs():
    result = optimize_strategy(
        _snapshot(),
        start=START,
        end=START + timedelta(days=30 * 11),
        min_market_cap=0,
        min_volume=0,
        fee_pct=0.1,
        fill_with_btc=True,
        objective="sharpe",
        trials=20,
        seed=9,
        top_k=4,
    )

    keys = [json.dumps(candidate["params"], sort_keys=True, default=str) for candidate in result["best"]]
    assert len(keys) == len(set(keys))
