from datetime import datetime, timedelta

import pytest

from backtest import BacktestError, build_snapshot, optimize, simulate
from models import Coin, Kline

START = datetime(2021, 1, 1)
DAYS = 1100
WINDOW = {"start": datetime(2023, 6, 1), "end": datetime(2024, 1, 10)}


def _price_cheap(day: int) -> float:
    if day <= 800:
        return 100.0 - 0.1125 * day
    return 10.0 + (day - 800) * (20.0 / 300.0)


def _price_rich(day: int) -> float:
    return 1.0 + 0.09 * day


def _seed_coin(db, symbol, price_at, days=DAYS, market_cap=50_000_000.0, volume=1_000_000.0):
    coin = Coin(
        symbol=symbol,
        is_pre_2021=False,
        listed_checked=True,
        market_cap=market_cap,
        volume_24h=volume,
        current_price_btc=price_at(days - 1),
    )
    db.add(coin)
    for day in range(days):
        price = price_at(day)
        db.add(
            Kline(
                symbol=symbol,
                timestamp=START + timedelta(days=day),
                open=price,
                high=price,
                low=price,
                close=price,
                volume=1_000_000.0,
            )
        )
    db.commit()


@pytest.fixture
def seeded_db(db):
    _seed_coin(db, "CHEAPUSDT", _price_cheap)
    _seed_coin(db, "RICHUSDT", _price_rich)
    return db


def _snapshot(db):
    return build_snapshot(db, "monthly", START + timedelta(days=DAYS - 1), use_cache=False)


def test_snapshot_uses_point_in_time_prices_and_scores(seeded_db):
    snapshot = _snapshot(seeded_db)
    assert len(snapshot["dates"]) > 10

    entry_date = snapshot["dates"][5]
    entries = snapshot["entries"][entry_date]
    assert {"CHEAPUSDT", "RICHUSDT"} <= set(entries)

    cheap = entries["CHEAPUSDT"]
    rich = entries["RICHUSDT"]
    assert cheap["price"] == pytest.approx(_price_cheap((entry_date - START).days), rel=1e-6)
    assert rich["price"] == pytest.approx(_price_rich((entry_date - START).days), rel=1e-6)
    assert cheap["score"] > rich["score"]


def test_simulate_rotates_into_cheap_coin(seeded_db):
    snapshot = _snapshot(seeded_db)
    result = simulate(
        snapshot,
        top_n=1,
        min_score=0,
        min_market_cap=0,
        min_volume=0,
        weighting="equal",
        fill_with_btc=False,
        fee_pct=0,
        **WINDOW,
    )

    assert result["metrics"]["periods"] == len(result["curve"]) - 1
    assert result["metrics"]["periods"] >= 5
    assert all(period["picks"][0]["symbol"] == "CHEAPUSDT" for period in result["holdings"])
    assert result["metrics"]["total_return"] > 0
    assert result["metrics"]["max_drawdown"] <= 0
    assert result["curve"][-1]["equity"] > 1.0


def test_fees_reduce_returns(seeded_db):
    snapshot = _snapshot(seeded_db)
    common = {
        "top_n": 1,
        "min_score": 0,
        "min_market_cap": 0,
        "min_volume": 0,
        "fill_with_btc": False,
        **WINDOW,
    }

    free = simulate(snapshot, fee_pct=0, **common)
    costly = simulate(snapshot, fee_pct=1, **common)

    assert costly["metrics"]["total_return"] < free["metrics"]["total_return"]


def test_fill_with_btc_caps_coin_exposure(seeded_db):
    snapshot = _snapshot(seeded_db)
    dates = [date for date in snapshot["dates"] if date >= WINDOW["start"]]
    cheap_scores = [snapshot["entries"][date]["CHEAPUSDT"]["score"] for date in dates]
    rich_scores = [snapshot["entries"][date]["RICHUSDT"]["score"] for date in dates]
    assert min(cheap_scores) > max(rich_scores)
    threshold = (min(cheap_scores) + max(rich_scores)) / 2

    common = {
        "top_n": 2,
        "min_score": threshold,
        "min_market_cap": 0,
        "min_volume": 0,
        "weighting": "equal",
        "fee_pct": 0,
        **WINDOW,
    }

    unfilled = simulate(snapshot, fill_with_btc=False, **common)
    filled = simulate(snapshot, fill_with_btc=True, **common)

    assert unfilled["holdings"][0]["picks"][0]["weight"] == pytest.approx(1.0)
    assert filled["holdings"][0]["picks"][0]["weight"] == pytest.approx(0.5)
    assert filled["curve"][1]["period_return"] == pytest.approx(unfilled["curve"][1]["period_return"] / 2)


def test_snapshot_rejects_coins_without_enough_history(db):
    _seed_coin(db, "NEWUSDT", lambda day: 1.0 + day * 0.001, days=120)

    with pytest.raises(BacktestError):
        build_snapshot(db, "monthly", START + timedelta(days=119), use_cache=False)


def test_simulate_rejects_window_without_anchors(seeded_db):
    snapshot = _snapshot(seeded_db)

    with pytest.raises(BacktestError):
        simulate(
            snapshot,
            start=datetime(2021, 1, 1),
            end=datetime(2021, 2, 1),
            top_n=1,
            min_score=0,
            min_market_cap=0,
            min_volume=0,
        )


def test_optimize_returns_ranked_configs(seeded_db):
    snapshot = _snapshot(seeded_db)
    results = optimize(
        snapshot,
        {
            "min_market_cap": 0,
            "min_volume": 0,
            "weighting": "equal",
            "fee_pct": 0.1,
            **WINDOW,
        },
        limit=3,
    )

    assert len(results) == 3
    assert results[0]["sharpe"] >= results[1]["sharpe"] >= results[2]["sharpe"]
    assert all({"top_n", "min_score", "fill_with_btc"} <= set(row) for row in results)
