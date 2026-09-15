from datetime import datetime, timedelta

from models import BtcRate, Coin, Kline, MarketHistory
from research.feature_store import build_feature_rows

START = datetime(2022, 1, 1)


def _seed_coin(db, symbol, days=500, base_price=10.0):
    db.add(
        Coin(
            symbol=symbol,
            is_pre_2021=False,
            listed_checked=True,
            market_cap=50_000_000.0,
            volume_24h=1_000_000.0,
            current_price_btc=base_price,
        )
    )
    for day in range(days):
        price = base_price * (1 + 0.002 * day)
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


def _seed_rates(db, days=500):
    for day in range(days):
        db.add(
            BtcRate(
                timestamp=START + timedelta(days=day),
                high=1,
                low=1,
                close=30000.0 + day * 10.0,
            )
        )
    db.commit()


def _seed_market_history(db, symbol, days=500):
    for day in range(days):
        db.add(
            MarketHistory(
                symbol=symbol,
                timestamp=START + timedelta(days=day),
                price_usd=1.0,
                market_cap=1e9 + day,
                volume_24h=1e7 + day,
            )
        )
    db.commit()


def test_feature_rows_join_point_in_time_liquidity_and_btc_regime(db):
    _seed_coin(db, "ETHBTC", base_price=10.0)
    _seed_coin(db, "BNBBTC", base_price=5.0)
    _seed_rates(db)
    _seed_market_history(db, "ETHBTC")

    rows = build_feature_rows(db, "monthly", use_cache=False)

    assert rows
    dates = sorted({row["date"] for row in rows})
    assert dates[0] == "2023-03-01"
    assert len(rows) == 3 * 2  # three monthly anchors, two coins

    by_key = {(row["date"], row["symbol"]): row for row in rows}
    eth = by_key[("2023-03-01", "ETHBTC")]
    expected_cap = 1e9 + (datetime(2023, 3, 1) - START).days
    assert eth["market_cap_pit"] == expected_cap
    assert eth["volume_pit"] is not None
    assert eth["score"] is not None
    assert eth["volatility_30d"] is not None and eth["volatility_30d"] > 0
    assert eth["dollar_volume_30d"] > 0
    assert eth["drawdown_from_ath"] <= 0
    assert eth["days_since_ath"] >= 0
    assert eth["btc_return_30d"] is not None
    assert eth["btc_above_sma200"] is True

    bnb = by_key[("2023-03-01", "BNBBTC")]
    assert bnb["market_cap_pit"] is None  # no point-in-time ingestion for this coin


def test_features_do_not_change_when_the_future_arrives(db):
    _seed_coin(db, "ETHBTC", days=500)
    _seed_rates(db, days=500)

    before = build_feature_rows(db, "monthly", end=START + timedelta(days=499), use_cache=False)

    for day in range(500, 590):
        price = 10.0 * (1 + 0.002 * day)
        db.add(
            Kline(
                symbol="ETHBTC",
                timestamp=START + timedelta(days=day),
                open=price,
                high=price,
                low=price,
                close=price,
                volume=1_000_000.0,
            )
        )
        db.add(
            BtcRate(
                timestamp=START + timedelta(days=day),
                high=1,
                low=1,
                close=30000.0 + day * 10.0,
            )
        )
    db.commit()

    after = build_feature_rows(db, "monthly", end=START + timedelta(days=589), use_cache=False)

    before_by_key = {(row["date"], row["symbol"]): row for row in before}
    after_by_key = {(row["date"], row["symbol"]): row for row in after}

    assert len(after_by_key) > len(before_by_key)  # new anchors appeared
    for key, row in before_by_key.items():
        assert after_by_key[key] == row
