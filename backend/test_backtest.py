from array import array
from datetime import datetime, timedelta

import pytest

from backtest import BacktestError, build_snapshot, optimize, regime_warmup_start, simulate
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


def test_snapshot_entries_carry_point_in_time_research_features(seeded_db):
    snapshot = _snapshot(seeded_db)
    entry = snapshot["entries"][snapshot["dates"][5]]["CHEAPUSDT"]

    assert entry["valuation_pct_3y"] is not None
    assert entry["volatility_30d"] is not None and entry["volatility_30d"] > 0
    assert entry["volatility_90d"] is not None and entry["volatility_90d"] > 0
    assert entry["drawdown_from_ath"] is not None and entry["drawdown_from_ath"] <= 0
    assert entry["days_since_ath"] is not None and entry["days_since_ath"] >= 0
    assert entry["dollar_volume_30d"] is not None and entry["dollar_volume_30d"] > 0

    regime = snapshot["regime"][snapshot["dates"][5]]
    assert regime["alt_index"] > 0
    assert regime["alt_above_sma"] in (True, False)
    assert regime["breadth"] is not None


def test_snapshot_can_use_a_learned_score_artifact(seeded_db):
    end = START + timedelta(days=DAYS - 1)
    rule = build_snapshot(seeded_db, "monthly", end, use_cache=False)
    learned = build_snapshot(seeded_db, "monthly", end, use_cache=False, score_model="learned_v1")

    entry_date = learned["dates"][5]
    assert set(learned["entries"][entry_date]) == set(rule["entries"][entry_date])
    for entry in learned["entries"][entry_date].values():
        assert 0.0 <= entry["score"] <= 100.0

    with pytest.raises(BacktestError):
        build_snapshot(seeded_db, "monthly", end, use_cache=False, score_model="does_not_exist")


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
    assert all({"rotation", "top_n", "min_score", "fill_with_btc"} <= set(row) for row in results)


def _manual_snapshot():
    """Tiny handcrafted snapshot where AAA gets expensive and BBB gets cheap."""
    dates = [datetime(2023, 1, 1), datetime(2023, 2, 1), datetime(2023, 3, 1), datetime(2023, 4, 1)]

    def entry(score, price):
        return {
            "score": score,
            "distance": 0.0,
            "price": price,
            "cap": 1_000_000_000.0,
            "volume": 100_000_000.0,
        }

    entries = {
        dates[0]: {"AAAUSDT": entry(90, 100.0), "BBBUSDT": entry(30, 100.0)},
        dates[1]: {"AAAUSDT": entry(45, 110.0), "BBBUSDT": entry(80, 100.0)},
        dates[2]: {"AAAUSDT": entry(35, 120.0), "BBBUSDT": entry(85, 100.0)},
        dates[3]: {"AAAUSDT": entry(30, 130.0), "BBBUSDT": entry(90, 100.0)},
    }
    return {
        "frequency": "monthly",
        "end": dates[-1],
        "dates": dates,
        "entries": entries,
        "rates": {},
        "rate_dates": [],
    }


_ROTATION_WINDOW = {
    "start": datetime(2023, 1, 1),
    "end": datetime(2023, 4, 1),
    "top_n": 1,
    "min_score": 50,
    "min_market_cap": 0,
    "min_volume": 0,
    "weighting": "equal",
    "fill_with_btc": False,
    "fee_pct": 0,
}


def _held_symbols(result):
    return [period["picks"][0]["symbol"] for period in result["holdings"]]


def test_hold_rotation_keeps_a_position_while_its_score_stays_above_exit():
    snapshot = _manual_snapshot()

    result = simulate(snapshot, rotation="hold", sell_score=30, **_ROTATION_WINDOW)

    # AAA is 45, 35, 30 across the periods: still cheap enough to hold.
    assert _held_symbols(result) == ["AAAUSDT", "AAAUSDT", "AAAUSDT"]


def test_hold_rotation_sells_once_the_score_drops_below_exit():
    snapshot = _manual_snapshot()

    result = simulate(snapshot, rotation="hold", sell_score=40, **_ROTATION_WINDOW)

    # Period 1: AAA (45) still above 40 and BBB cannot take the only slot.
    # Period 2: AAA falls to 35, gets sold and BBB is bought in its place.
    assert _held_symbols(result) == ["AAAUSDT", "AAAUSDT", "BBBUSDT"]


def test_rebalance_rotation_swaps_as_soon_as_scores_flip():
    snapshot = _manual_snapshot()

    result = simulate(snapshot, rotation="rebalance", **_ROTATION_WINDOW)

    assert _held_symbols(result) == ["AAAUSDT", "BBBUSDT", "BBBUSDT"]


def test_hold_rotation_defaults_to_the_buy_threshold():
    snapshot = _manual_snapshot()

    result = simulate(snapshot, rotation="hold", **_ROTATION_WINDOW)

    # Without an explicit sell_score the buy threshold (50) is the exit:
    # AAA (45) is sold at the first rebalance even though it is still ranked.
    assert _held_symbols(result) == ["AAAUSDT", "BBBUSDT", "BBBUSDT"]


def test_simulate_rejects_unknown_rotation():
    with pytest.raises(BacktestError):
        simulate(_manual_snapshot(), rotation="daily", **_ROTATION_WINDOW)


def _regime_snapshot():
    snapshot = _manual_snapshot()
    dates = snapshot["dates"]
    snapshot["regime"] = {
        dates[0]: {"alt_above_sma": True, "breadth": 0.8, "alt_index": 1.01},
        dates[1]: {"alt_above_sma": False, "breadth": 0.2, "alt_index": 0.95},
        dates[2]: {"alt_above_sma": True, "breadth": 0.6, "alt_index": 1.02},
        dates[3]: {"alt_above_sma": True, "breadth": 0.6, "alt_index": 1.03},
    }
    return snapshot


def test_regime_filter_sits_in_btc_when_the_alt_trend_turns_down():
    snapshot = _regime_snapshot()

    result = simulate(snapshot, regime_filter="alt_trend", **_ROTATION_WINDOW)

    assert [period["risk_on"] for period in result["holdings"]] == [True, False, True]
    assert result["holdings"][1]["picks"] == []
    regime_exits = [trade for trade in result["trades"] if trade["exit_reason"] == "regime"]
    assert len(regime_exits) == 1


def test_regime_filter_breadth_threshold_is_configurable():
    snapshot = _regime_snapshot()
    window = {**_ROTATION_WINDOW, "regime_filter": "breadth"}

    strict = simulate(snapshot, regime_min_breadth=0.5, **window)
    loose = simulate(snapshot, regime_min_breadth=0.1, **window)

    assert [period["risk_on"] for period in strict["holdings"]] == [True, False, True]
    assert all(period["risk_on"] for period in loose["holdings"])


def test_simulate_rejects_unknown_regime_filter():
    with pytest.raises(BacktestError):
        simulate(_manual_snapshot(), regime_filter="moon", **_ROTATION_WINDOW)


def test_snapshot_includes_archived_coins_without_market_cap(db):
    _seed_coin(db, "CHEAPUSDT", _price_cheap)
    _seed_coin(db, "RICHUSDT", _price_rich)
    archived = Coin(
        symbol="FTTBTC",
        is_pre_2021=False,
        listed_checked=True,
        market_cap=None,
        volume_24h=None,
        delisted_at=datetime(2022, 11, 16),
    )
    db.add(archived)
    for day in range(DAYS):
        price = _price_cheap(day)
        db.add(
            Kline(
                symbol="FTTBTC",
                timestamp=START + timedelta(days=day),
                open=price,
                high=price,
                low=price,
                close=price,
                volume=1_000_000.0,
            )
        )
    db.commit()

    snapshot = build_snapshot(db, "monthly", START + timedelta(days=DAYS - 1), use_cache=False)

    assert "FTTBTC" in snapshot["entries"][snapshot["dates"][-1]]


def _stop_snapshot(closes: list):
    """Two monthly anchors with daily closes for AAA between them."""
    anchor = datetime(2023, 1, 1)
    next_anchor = datetime(2023, 2, 1)
    timestamps = array("d", [(anchor + timedelta(days=index)).timestamp() for index in range(len(closes))])

    def entry(score, price):
        return {"score": score, "distance": 0.0, "price": price, "cap": 1e9, "volume": 1e8, "trend_30d": 0.0}

    entries = {
        anchor: {"AAAUSDT": entry(90, closes[0])},
        next_anchor: {"AAAUSDT": entry(90, closes[-1])},
    }
    return {
        "frequency": "monthly",
        "end": next_anchor,
        "dates": [anchor, next_anchor],
        "entries": entries,
        "rates": {},
        "rate_dates": [],
        "series": {"AAAUSDT": {"timestamps": timestamps, "closes": array("d", closes)}},
    }


_STOP_WINDOW = {
    "start": datetime(2023, 1, 1),
    "end": datetime(2023, 2, 1),
    "top_n": 1,
    "min_score": 50,
    "min_market_cap": 0,
    "min_volume": 0,
    "weighting": "equal",
    "fill_with_btc": False,
    "fee_pct": 0,
    "rotation": "hold",
}


def test_stop_loss_sells_mid_period_at_the_trigger_price():
    closes = [100.0, 95.0, 74.0, 80.0, 90.0, 85.0]
    snapshot = _stop_snapshot(closes)

    result = simulate(snapshot, stop_loss_pct=25, **_STOP_WINDOW)

    assert result["holdings"][0]["picks"][0]["exited"] is True
    assert result["holdings"][0]["picks"][0]["period_return"] == pytest.approx(74.0 / 100.0 - 1.0)
    assert result["curve"][1]["period_return"] == pytest.approx(74.0 / 100.0 - 1.0)


def test_trailing_stop_sells_after_a_peak_fades():
    closes = [100.0, 130.0, 120.0, 111.0, 90.0, 80.0]
    snapshot = _stop_snapshot(closes)

    result = simulate(snapshot, trailing_stop_pct=15, **_STOP_WINDOW)

    # Peak 130 -> floor 110.5; 111 stays above it, 90 triggers the exit.
    assert result["holdings"][0]["picks"][0]["period_return"] == pytest.approx(90.0 / 100.0 - 1.0)


def test_take_profit_sells_into_strength():
    closes = [100.0, 120.0, 141.0, 150.0, 160.0]
    snapshot = _stop_snapshot(closes)

    result = simulate(snapshot, take_profit_pct=40, **_STOP_WINDOW)

    assert result["holdings"][0]["picks"][0]["period_return"] == pytest.approx(141.0 / 100.0 - 1.0)


def test_exits_stay_disabled_without_stop_parameters():
    closes = [100.0, 50.0, 140.0, 60.0]
    snapshot = _stop_snapshot(closes)

    result = simulate(snapshot, **_STOP_WINDOW)

    assert result["holdings"][0]["picks"][0]["exited"] is False
    assert result["holdings"][0]["picks"][0]["period_return"] == pytest.approx(closes[-1] / 100.0 - 1.0)


def test_trend_filter_skips_free_falling_coins():
    dates = [datetime(2023, 1, 1), datetime(2023, 2, 1), datetime(2023, 3, 1)]

    def entry(score, price, trend):
        return {
            "score": score,
            "distance": 0.0,
            "price": price,
            "cap": 1e9,
            "volume": 1e8,
            "trend_30d": trend,
        }

    entries = {
        dates[0]: {"AAAUSDT": entry(90, 100.0, -55.0), "BBBUSDT": entry(60, 100.0, 5.0)},
        dates[1]: {"AAAUSDT": entry(90, 90.0, -60.0), "BBBUSDT": entry(60, 100.0, 5.0)},
        dates[2]: {"AAAUSDT": entry(90, 80.0, -60.0), "BBBUSDT": entry(60, 100.0, 5.0)},
    }
    snapshot = {
        "frequency": "monthly",
        "end": dates[-1],
        "dates": dates,
        "entries": entries,
        "rates": {},
        "rate_dates": [],
    }

    result = simulate(
        snapshot,
        min_trend_30d=-25,
        start=dates[0],
        end=dates[-1],
        top_n=1,
        min_score=50,
        min_market_cap=0,
        min_volume=0,
        weighting="equal",
        fill_with_btc=False,
        fee_pct=0,
        rotation="hold",
    )

    assert _held_symbols(result) == ["BBBUSDT", "BBBUSDT"]
    assert result["curve"][1]["period_return"] == pytest.approx(0.0)


def test_trade_log_records_buy_and_sell_prices_with_reasons():
    snapshot = _manual_snapshot()

    result = simulate(snapshot, rotation="rebalance", **_ROTATION_WINDOW)
    trades = result["trades"]

    first = trades[0]
    assert first["symbol"] == "AAAUSDT"
    assert first["entry_date"].startswith("2023-01-01")
    assert first["entry_price"] == pytest.approx(100.0)
    assert first["exit_date"].startswith("2023-02-01")
    assert first["exit_price"] == pytest.approx(110.0)
    assert first["exit_reason"] == "rebalance"
    assert first["return_pct"] == pytest.approx(0.10)
    assert first["days"] == 31

    open_trade = trades[-1]
    assert open_trade["symbol"] == "BBBUSDT"
    assert open_trade["exit_reason"] == "open"
    assert open_trade["exit_date"].startswith("2023-04-01")


def test_trade_log_marks_score_exits_in_hold_mode():
    snapshot = _manual_snapshot()

    result = simulate(snapshot, rotation="hold", sell_score=40, **_ROTATION_WINDOW)
    closed = [trade for trade in result["trades"] if trade["exit_reason"] == "score"]

    assert closed[0]["symbol"] == "AAAUSDT"
    assert closed[0]["exit_date"].startswith("2023-03-01")
    assert closed[0]["exit_price"] == pytest.approx(120.0)


def test_trade_log_marks_risk_exits():
    snapshot = _stop_snapshot([100.0, 95.0, 74.0, 80.0, 90.0, 85.0])

    result = simulate(snapshot, stop_loss_pct=25, **_STOP_WINDOW)
    trade = result["trades"][-1]

    assert trade["exit_reason"] == "stop_loss"
    assert trade["exit_price"] == pytest.approx(74.0)
    assert trade["entry_date"].startswith("2023-01-01")
    assert trade["exit_date"].startswith("2023-01-03")
    assert trade["return_pct"] == pytest.approx(-0.26)


def test_stop_levels_follow_the_original_entry_across_periods():
    dates = [datetime(2023, 1, 1), datetime(2023, 2, 1), datetime(2023, 3, 1)]
    closes = []
    for index in range(60):
        if index == 0:
            closes.append(100.0)
        elif index <= 31:
            closes.append(100.0 - (index / 31.0) * 20.0)
        elif index == 32:
            closes.append(74.0)
        else:
            closes.append(74.0 + ((index - 32) / 27.0) * 16.0)
    timestamps = array("d", [(dates[0] + timedelta(days=index)).timestamp() for index in range(len(closes))])

    def entry(price):
        return {"score": 90.0, "distance": 0.0, "price": price, "cap": 1e9, "volume": 1e8, "trend_30d": 0.0}

    snapshot = {
        "frequency": "monthly",
        "end": dates[-1],
        "dates": dates,
        "entries": {
            dates[0]: {"AAAUSDT": entry(100.0)},
            dates[1]: {"AAAUSDT": entry(80.0)},
            dates[2]: {"AAAUSDT": entry(90.0)},
        },
        "rates": {},
        "rate_dates": [],
        "series": {"AAAUSDT": {"timestamps": timestamps, "closes": array("d", closes)}},
    }

    result = simulate(
        snapshot,
        stop_loss_pct=25,
        start=dates[0],
        end=dates[-1],
        top_n=1,
        min_score=50,
        min_market_cap=0,
        min_volume=0,
        weighting="equal",
        fill_with_btc=False,
        fee_pct=0,
        rotation="hold",
    )

    # The 25% stop sits at 75 from the original 100 entry, so the 74 close in
    # the second period sells it even though that period opened at 80.
    assert result["trades"][-1]["exit_reason"] == "stop_loss"
    assert result["trades"][-1]["exit_price"] == pytest.approx(74.0)
    assert result["trades"][-1]["return_pct"] == pytest.approx(-0.26)
    assert result["holdings"][1]["picks"][0]["exited"] is True


def test_snapshot_earliest_limits_the_anchor_range(seeded_db):
    end = START + timedelta(days=DAYS - 1)
    full = build_snapshot(seeded_db, "monthly", end, use_cache=False)
    cutoff = datetime(2023, 6, 1)
    trimmed = build_snapshot(seeded_db, "monthly", end, use_cache=False, earliest=cutoff)

    assert full["dates"][0] < cutoff
    assert trimmed["dates"][0] >= cutoff
    assert len(trimmed["dates"]) < len(full["dates"])
    assert trimmed["entries"][trimmed["dates"][0]]  # scoring still works


def test_regime_warmup_start_leaves_room_for_the_trend():
    warmup = regime_warmup_start(datetime(2022, 1, 1), "monthly")

    assert warmup < datetime(2022, 1, 1)
    assert (datetime(2022, 1, 1) - warmup).days >= 30
