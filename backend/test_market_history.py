import calendar
from datetime import datetime

from market_history import daily_rows, sync_market_history, upsert_market_history
from models import Coin, MarketHistory


def utc_ms(year, month, day, hour=0):
    return calendar.timegm(datetime(year, month, day, hour).timetuple()) * 1000


def chart(entries):
    return {
        "prices": [[timestamp, price] for timestamp, price, _, _ in entries],
        "market_caps": [[timestamp, cap] for timestamp, _, cap, _ in entries],
        "total_volumes": [[timestamp, volume] for timestamp, _, _, volume in entries],
    }


class FakeCoinGecko:
    def __init__(self, charts, failing=()):
        self.charts = charts
        self.failing = set(failing)
        self.calls = []

    def fetch_market_chart(self, coin_id, days="max"):
        self.calls.append(coin_id)
        if coin_id in self.failing:
            from fetcher import CoinGeckoError

            raise CoinGeckoError(f"boom {coin_id}")
        return self.charts[coin_id]


def test_daily_rows_normalize_to_utc_midnight_and_collapse_duplicates():
    rows = daily_rows(
        chart(
            [
                (utc_ms(2023, 1, 1), 1.0, 100.0, 10.0),
                (utc_ms(2023, 1, 1, 6), 1.1, 110.0, 11.0),
                (utc_ms(2023, 1, 2), 1.2, 120.0, 12.0),
            ]
        )
    )

    assert [row["timestamp"] for row in rows] == [datetime(2023, 1, 1), datetime(2023, 1, 2)]
    assert rows[0]["price_usd"] == 1.1
    assert rows[0]["market_cap"] == 110.0
    assert rows[1]["volume_24h"] == 12.0


def test_upsert_is_idempotent_and_refreshes_existing_days(db):
    rows = daily_rows(chart([(utc_ms(2023, 1, 1), 1.0, 100.0, 10.0)]))

    assert upsert_market_history(db, "ETHBTC", rows) == (1, 0)
    assert upsert_market_history(db, "ETHBTC", rows) == (0, 0)

    updated_rows = daily_rows(chart([(utc_ms(2023, 1, 1), 2.0, 200.0, 20.0)]))
    assert upsert_market_history(db, "ETHBTC", updated_rows) == (0, 1)

    stored = db.query(MarketHistory).one()
    assert stored.price_usd == 2.0
    assert stored.market_cap == 200.0


def test_sync_continues_after_a_failure_and_honors_filters(db):
    db.add_all(
        [
            Coin(symbol="ETHBTC", is_pre_2021=True, listed_checked=True, coingecko_id="ethereum", market_cap=1e9),
            Coin(symbol="FTTBTC", is_pre_2021=True, listed_checked=True, coingecko_id="ftx-token", market_cap=1e6),
            Coin(symbol="NOIDBTC", is_pre_2021=True, listed_checked=True),
        ]
    )
    db.commit()

    client = FakeCoinGecko(
        {"ethereum": chart([(utc_ms(2023, 1, 1), 1.0, 100.0, 10.0)])},
        failing={"ftx-token"},
    )

    summary = sync_market_history(db, client, delay=0)

    assert summary["coins"] == 1
    assert summary["inserted"] == 1
    assert summary["failed"] == ["FTTBTC"]
    assert client.calls == ["ethereum", "ftx-token"]  # coins without an id are skipped
    assert db.query(MarketHistory).filter(MarketHistory.symbol == "ETHBTC").count() == 1

    filtered = sync_market_history(db, client, symbols=["ETHBTC"], delay=0)
    assert filtered["coins"] == 1
    assert filtered["inserted"] == 0
    assert filtered["updated"] == 0
