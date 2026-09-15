from datetime import datetime, timedelta

from models import Coin, Kline, MarketHistory
from research.data_quality import build_report


def test_data_quality_report_summarizes_universe_and_coverage(db):
    db.add_all(
        [
            Coin(
                symbol="ETHBTC",
                is_pre_2021=True,
                listed_checked=True,
                coingecko_id="ethereum",
                market_cap=1e9,
                current_price_btc=0.05,
                last_updated=datetime(2026, 9, 14),
            ),
            Coin(
                symbol="OLDBTC",
                is_pre_2021=True,
                listed_checked=True,
                coingecko_id="old-coin",
                market_cap=1e6,
                delisted_at=datetime(2022, 11, 15),
            ),
        ]
    )
    for index in range(5):
        db.add(
            Kline(
                symbol="ETHBTC",
                timestamp=datetime(2023, 1, 1) + timedelta(days=index),
                open=1,
                high=1,
                low=1,
                close=1,
                volume=1,
            )
        )
    db.add(
        Kline(
            symbol="ETHBTC",
            timestamp=datetime(2023, 1, 10),
            open=1,
            high=1,
            low=1,
            close=1,
            volume=1,
        )
    )
    db.add(
        MarketHistory(
            symbol="ETHBTC",
            timestamp=datetime(2023, 1, 1),
            price_usd=1.0,
            market_cap=100.0,
            volume_24h=10.0,
        )
    )
    db.commit()

    report = build_report(db)

    assert report["universe"] == {
        "coins_total": 2,
        "active": 1,
        "delisted": 1,
        "stable": 0,
        "with_coingecko_id": 2,
    }
    assert report["delisted_symbols"][0]["symbol"] == "OLDBTC"
    assert report["delisted_symbols"][0]["delisted_at"].startswith("2022-11-15")
    assert report["klines"]["symbols"] == 1
    assert report["klines"]["symbols_with_gaps"] == 1
    assert report["klines"]["total_gaps"] == 1
    assert report["market_history"]["symbols"] == 1
    assert report["market_history"]["rows"] == 1
    assert report["market_history"]["coverage_of_eligible"] == 0.5
    assert report["liquidity"]["active_with_market_cap"] == 1
    assert report["liquidity"]["active_stale_over_7d"] == 0
    assert report["liquidity"]["active_without_price"] == 0
