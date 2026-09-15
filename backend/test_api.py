from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

import main
from backtest import clear_snapshot_cache
from database import Base, SessionLocal, engine
from models import BtcRate, Coin, Kline, Meta, SyncLock
from timeutils import utcnow_naive

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    main.rate_limiter.hits.clear()
    clear_snapshot_cache()
    yield
    main.rate_limiter.hits.clear()
    clear_snapshot_cache()


def seed_coin(symbol="ETHBTC", is_pre_2021=True, market_cap=1000.0):
    db = SessionLocal()
    coin = Coin(
        symbol=symbol,
        name="Ethereum" if symbol == "ETHBTC" else symbol,
        is_pre_2021=is_pre_2021,
        listed_checked=True,
        market_cap=market_cap,
        current_price_btc=0.05,
        distance_pct_event=25.0,
        distance_pct_atl=50.0,
    )
    db.add(coin)
    db.commit()
    db.close()


def test_get_coins_returns_only_coins_with_price_history():
    seed_coin("ETHBTC", is_pre_2021=True, market_cap=1000.0)
    seed_coin("ICPUSDT", is_pre_2021=False, market_cap=500.0)

    db = SessionLocal()
    db.add(Coin(symbol="JUNKUSDT", is_pre_2021=False, listed_checked=True, market_cap=1.0))
    db.commit()
    db.close()

    response = client.get("/api/coins")

    assert response.status_code == 200
    payload = response.json()
    assert [coin["symbol"] for coin in payload] == ["ETHBTC", "ICPUSDT"]
    # sqrt scaling across the whole dataset: the largest cap gets 100%.
    assert payload[0]["bubble_size_event"] == 100.0
    assert payload[0]["bubble_size_atl"] == 100.0
    assert payload[1]["bubble_size_event"] < 100.0


def test_history_returns_latest_klines_in_ascending_order():
    seed_coin()
    db = SessionLocal()
    for day in range(5):
        db.add(
            Kline(
                symbol="ETHBTC",
                timestamp=datetime(2021, 1, 1) + timedelta(days=day),
                open=1,
                high=1,
                low=1,
                close=1 + day,
                volume=1,
            )
        )
    db.commit()
    db.close()

    response = client.get("/api/coins/ETHBTC/history", params={"limit": 3})

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 3
    assert [item["close"] for item in payload] == [3, 4, 5]


def test_history_returns_404_for_unknown_symbol():
    assert client.get("/api/coins/NOPE/history").status_code == 404


def test_meta_reports_tracked_coins_and_sync_state():
    seed_coin()
    db = SessionLocal()
    db.add(Meta(key="last_updated", value="2026-01-01T00:00:00+00:00"))
    db.add(
        Meta(
            key="sync_progress",
            value='{"phase": "klines", "processed": 10, "total": 100}',
        )
    )
    db.commit()
    db.close()

    response = client.get("/api/meta")

    assert response.status_code == 200
    payload = response.json()
    assert payload["tracked_coins"] == 1
    assert payload["delisted_coins"] == 0
    assert payload["sync_in_progress"] is False
    assert payload["last_updated"] == "2026-01-01T00:00:00+00:00"
    assert payload["sync_progress"]["phase"] == "klines"
    assert payload["sync_progress"]["processed"] == 10


def test_delisted_coins_are_archived_from_the_live_board():
    seed_coin("ETHBTC")
    db = SessionLocal()
    db.add(
        Coin(
            symbol="FTTBTC",
            name="FTX Token",
            is_pre_2021=True,
            listed_checked=True,
            market_cap=500.0,
            current_price_btc=0.0001,
            delisted_at=datetime(2022, 11, 15),
        )
    )
    db.commit()
    db.close()

    response = client.get("/api/coins")

    assert response.status_code == 200
    assert [coin["symbol"] for coin in response.json()] == ["ETHBTC"]

    meta = client.get("/api/meta").json()
    assert meta["tracked_coins"] == 1
    assert meta["delisted_coins"] == 1


def test_refresh_schedules_background_sync(monkeypatch):
    calls = []
    monkeypatch.setattr(main, "run_sync_with_lock", lambda: calls.append("sync"))

    response = client.post("/api/refresh")

    assert response.status_code == 202
    assert calls == ["sync"]


def test_refresh_returns_409_when_sync_is_running():
    db = SessionLocal()
    db.add(
        SyncLock(
            name="sync",
            acquired_at=utcnow_naive(),
            expires_at=utcnow_naive() + timedelta(minutes=30),
        )
    )
    db.commit()
    db.close()

    response = client.post("/api/refresh")

    assert response.status_code == 409


def test_get_coins_as_of_historical_snapshot():
    db = SessionLocal()
    db.add(
        Coin(
            symbol="ETHBTC",
            name="Ethereum",
            is_pre_2021=True,
            listed_checked=True,
            market_cap=1000.0,
            current_price_btc=1.0,
        )
    )
    db.add(Coin(symbol="NEWBTC", name="New", is_pre_2021=False, listed_checked=True, market_cap=500.0, current_price_btc=1.0))
    db.add_all(
        [
            Kline(symbol="ETHBTC", timestamp=datetime(2020, 1, 1), open=0.8, high=0.8, low=0.5, close=0.8, volume=1),
            Kline(symbol="ETHBTC", timestamp=datetime(2021, 6, 1), open=0.3, high=0.3, low=0.2, close=0.3, volume=1),
            Kline(symbol="ETHBTC", timestamp=datetime(2022, 6, 1), open=0.5, high=0.5, low=0.4, close=0.5, volume=1),
            Kline(symbol="ETHBTC", timestamp=datetime(2023, 6, 1), open=0.7, high=0.7, low=0.6, close=0.7, volume=1),
            Kline(symbol="NEWBTC", timestamp=datetime(2024, 1, 1), open=2, high=2, low=1, close=2, volume=1),
        ]
    )
    db.commit()
    db.close()

    response = client.get("/api/coins", params={"as_of": "2022-12-31"})
    assert response.status_code == 200
    payload = response.json()
    # NEWBTC has no candles before 2024, so it is excluded from the snapshot.
    assert [coin["symbol"] for coin in payload] == ["ETHBTC"]
    coin = payload[0]
    assert coin["current_price_btc"] == 0.5
    assert coin["all_time_low"] == 0.2
    assert coin["event_low"] == 0.2
    assert coin["price_7d_ago_btc"] == 0.5
    assert coin["price_30d_ago_btc"] == 0.5
    assert coin["distance_pct_event"] == pytest.approx(150.0)
    # Market cap stays current by design.
    assert coin["market_cap"] == 1000.0

    earlier = client.get("/api/coins", params={"as_of": "2020-12-31"}).json()[0]
    assert earlier["current_price_btc"] == 0.8
    assert earlier["all_time_low"] == 0.5
    # No 2021+ candles yet, so the event low falls back to the all-time low.
    assert earlier["event_low"] == 0.5
    assert earlier["distance_pct_event"] == pytest.approx(60.0)

    assert client.get("/api/coins", params={"as_of": "31-12-2022"}).status_code == 422


def test_history_and_prices_in_usd():
    db = SessionLocal()
    db.add(
        Coin(
            symbol="ETHBTC",
            name="Ethereum",
            is_pre_2021=True,
            listed_checked=True,
            market_cap=1000.0,
            current_price_btc=0.05,
        )
    )
    db.add_all(
        [
            Kline(symbol="ETHBTC", timestamp=datetime(2021, 6, 1), open=0.04, high=0.06, low=0.03, close=0.05, volume=10),
            Kline(symbol="ETHBTC", timestamp=datetime(2021, 6, 2), open=0.05, high=0.07, low=0.04, close=0.06, volume=20),
        ]
    )
    db.add_all(
        [
            BtcRate(timestamp=datetime(2021, 6, 1), high=41000, low=39000, close=40000),
            BtcRate(timestamp=datetime(2021, 6, 2), high=43000, low=40500, close=42000),
        ]
    )
    db.add(Meta(key="btc_usd_price", value="42000"))
    db.commit()
    db.close()

    # live USD price on the coin payload
    payload = client.get("/api/coins").json()[0]
    assert payload["current_price_usd"] == pytest.approx(0.05 * 42000)

    # USDT-quoted history converted with the same-day BTC rate
    usd_history = client.get("/api/coins/ETHBTC/history", params={"vs": "usd"}).json()
    assert len(usd_history) == 2
    assert usd_history[0]["close"] == pytest.approx(0.05 * 40000)
    assert usd_history[1]["close"] == pytest.approx(0.06 * 42000)
    assert usd_history[1]["high"] == pytest.approx(0.07 * 42000)

    # BTC parity default is unchanged
    btc_history = client.get("/api/coins/ETHBTC/history").json()
    assert btc_history[1]["close"] == pytest.approx(0.06)

    # meta exposes the current rate
    assert client.get("/api/meta").json()["btc_usd_price"] == pytest.approx(42000)


def test_get_coins_includes_value_score():
    db = SessionLocal()
    db.add(
        Coin(
            symbol="ETHBTC",
            name="Ethereum",
            is_pre_2021=True,
            listed_checked=True,
            market_cap=1_000_000_000,
            volume_24h=10_000_000,
            current_price_btc=1.0,
            distance_pct_event=20.0,
            valuation_pct_1y=10.0,
            valuation_pct_3y=10.0,
            valuation_pct_all=10.0,
            median_dist_3y=-40.0,
            basing_pct_90d=50.0,
            range_position=0.2,
            trend_30d_pct=0.0,
            trend_90d_pct=0.0,
        )
    )
    db.commit()
    db.close()

    payload = client.get("/api/coins").json()[0]

    assert payload["valuation_pct_3y"] == 10.0
    assert payload["value_score"] is not None, {
        key: payload.get(key)
        for key in ("is_stable", "market_cap", "volume_24h", "distance_pct_event", "valuation_pct_3y")
    }
    assert payload["value_parts"]["valuation"] >= 0


def test_get_coins_includes_stable_flag():
    seed_coin("USDSUSDT")
    db = SessionLocal()
    coin = db.get(Coin, "USDSUSDT")
    coin.is_stable = True
    db.commit()
    db.close()

    payload = client.get("/api/coins").json()[0]

    assert payload["is_stable"] is True


def test_get_coins_with_custom_low_window():
    db = SessionLocal()
    db.add(
        Coin(
            symbol="ETHBTC",
            name="Ethereum",
            is_pre_2021=True,
            listed_checked=True,
            market_cap=1000.0,
            current_price_btc=1.0,
            event_low=0.2,
            all_time_low=0.2,
            distance_pct_event=400.0,
            distance_pct_atl=400.0,
        )
    )
    db.add_all(
        [
            Kline(symbol="ETHBTC", timestamp=datetime(2020, 1, 1), open=1, high=1, low=0.5, close=1, volume=1),
            Kline(symbol="ETHBTC", timestamp=datetime(2021, 6, 1), open=1, high=1, low=0.2, close=1, volume=1),
            Kline(symbol="ETHBTC", timestamp=datetime(2022, 6, 1), open=1, high=1, low=0.4, close=1, volume=1),
        ]
    )
    db.commit()
    db.close()

    default_payload = client.get("/api/coins").json()[0]
    assert default_payload["event_low"] == 0.2
    assert default_payload["distance_pct_event"] == pytest.approx(400.0)

    custom_payload = client.get("/api/coins", params={"low_from": "2022-01-01"}).json()[0]
    assert custom_payload["event_low"] == 0.4
    assert custom_payload["distance_pct_event"] == pytest.approx(150.0)

    assert client.get("/api/coins", params={"low_from": "not-a-date"}).status_code == 422


def test_dip_history_series_runs_lows_as_we_go():
    db = SessionLocal()
    db.add(Coin(symbol="ETHBTC", name="Ethereum", is_pre_2021=True, listed_checked=True, market_cap=1000.0))
    db.add_all(
        [
            Kline(symbol="ETHBTC", timestamp=datetime(2020, 1, 1), open=0.8, high=0.8, low=0.5, close=0.8, volume=1),
            Kline(symbol="ETHBTC", timestamp=datetime(2021, 6, 1), open=0.3, high=0.3, low=0.2, close=0.3, volume=1),
            Kline(symbol="ETHBTC", timestamp=datetime(2022, 6, 1), open=0.5, high=0.5, low=0.4, close=0.5, volume=1),
        ]
    )
    db.commit()
    db.close()

    response = client.get("/api/coins/ETHBTC/dip-history")
    assert response.status_code == 200
    points = response.json()
    assert len(points) == 3

    # 2020: no 2021+ candles yet, so the event low falls back to the ATL (0.5).
    assert points[0]["event_low"] == 0.5
    assert points[0]["distance_pct_event"] == pytest.approx(60.0)
    # 2021: the event low becomes 0.2.
    assert points[1]["event_low"] == 0.2
    assert points[1]["distance_pct_event"] == pytest.approx(50.0)
    # 2022: the low stays at 0.2, price recovers to 0.5.
    assert points[2]["event_low"] == 0.2
    assert points[2]["distance_pct_event"] == pytest.approx(150.0)

    assert client.get("/api/coins/ETHBTC/dip-history", params={"limit": 1}).json()[0]["close"] == 0.5
    assert client.get("/api/coins/NOPE/dip-history").status_code == 404


def test_watchlist_crud():
    seed_coin("ETHBTC")

    assert client.get("/api/watchlist").json() == []

    created = client.post("/api/watchlist/ETHBTC", json={"threshold_pct": 25})
    assert created.status_code == 201
    payload = created.json()
    assert payload["symbol"] == "ETHBTC"
    assert payload["base_asset"] == "ETH"
    assert payload["threshold_pct"] == 25
    assert payload["distance_pct_event"] == 25.0

    listing = client.get("/api/watchlist").json()
    assert len(listing) == 1

    updated = client.post("/api/watchlist/ETHBTC", json={"threshold_pct": 10})
    assert updated.json()["threshold_pct"] == 10

    assert client.delete("/api/watchlist/ETHBTC").status_code == 204
    assert client.get("/api/watchlist").json() == []


def test_watchlist_unknown_coin():
    assert client.post("/api/watchlist/NOPE", json={}).status_code == 404
    assert client.delete("/api/watchlist/NOPE").status_code == 404


def test_health_endpoint():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_backtest_endpoint_replays_value_score_history():
    db = SessionLocal()
    db.add(
        Coin(
            symbol="ETHBTC",
            name="Ethereum",
            is_pre_2021=False,
            listed_checked=True,
            market_cap=50_000_000.0,
            volume_24h=1_000_000.0,
            current_price_btc=12.0,
        )
    )
    start = datetime(2021, 1, 1)
    for day in range(1100):
        price = 100.0 - day * 0.08
        db.add(
            Kline(
                symbol="ETHBTC",
                timestamp=start + timedelta(days=day),
                open=price,
                high=price,
                low=price,
                close=price,
                volume=1,
            )
        )
    db.add_all(
        [
            BtcRate(timestamp=datetime(2023, 1, 1), high=1, low=1, close=30000.0),
            BtcRate(timestamp=datetime(2024, 1, 1), high=1, low=1, close=40000.0),
        ]
    )
    db.commit()
    db.close()

    response = client.get(
        "/api/backtest",
        params={
            "start": "2023-01-01",
            "rebalance": "monthly",
            "top_n": 1,
            "min_score": 0,
            "min_market_cap": 0,
            "min_volume": 0,
            "fee_pct": 0,
            "optimize": "true",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["metrics"]["periods"] >= 10
    assert len(payload["curve"]) == payload["metrics"]["periods"] + 1
    assert payload["start"] >= "2023-01-01"
    assert payload["holdings"][0]["picks"][0]["symbol"] == "ETHBTC"
    # BTC/USD went 30k -> 40k inside the window, so the benchmark is +33%.
    assert payload["metrics"]["benchmark_btc_usd_return"] == pytest.approx(1 / 3, abs=0.01)
    assert payload["optimization"]
    assert payload["optimization"][0]["sharpe"] >= payload["optimization"][-1]["sharpe"]
    assert "rotation" in payload["optimization"][0]

    hold = client.get(
        "/api/backtest",
        params={
            "start": "2023-01-01",
            "rotation": "hold",
            "sell_score": 40,
            "min_score": 50,
            "min_market_cap": 0,
            "min_volume": 0,
        },
    )
    assert hold.status_code == 200
    assert hold.json()["rotation"] == "hold"
    assert hold.json()["sell_score"] == 40

    learned = client.get(
        "/api/backtest",
        params={"start": "2023-01-01", "score_model": "learned_v1", "min_score": 50},
    )
    assert learned.status_code == 200
    assert learned.json()["score_model"] == "learned_v1"

    regime = client.get(
        "/api/backtest",
        params={"start": "2023-01-01", "regime_filter": "breadth", "regime_min_breadth": 0.3, "min_score": 50},
    )
    assert regime.status_code == 200
    assert regime.json()["regime_filter"] == "breadth"
    assert regime.json()["regime_min_breadth"] == 0.3

    assert client.get("/api/backtest", params={"start": "2023-01-01", "regime_filter": "moon"}).status_code == 422
    assert client.get("/api/backtest", params={"start": "2023-01-01", "score_model": "nope"}).status_code == 422
    assert client.get("/api/backtest", params={"start": "2023-01-01", "rebalance": "daily"}).status_code == 422
    assert client.get("/api/backtest", params={"start": "2023-01-01", "rotation": "daily"}).status_code == 422
    assert client.get("/api/backtest", params={"start": "2023-01-01", "end": "2022-01-01"}).status_code == 422


def test_api_key_required_when_configured(monkeypatch):
    monkeypatch.setenv("API_KEY", "secret")

    assert client.get("/api/coins").status_code == 401
    assert client.get("/api/coins", headers={"x-api-key": "secret"}).status_code == 200


def test_api_key_disabled_by_default(monkeypatch):
    monkeypatch.delenv("API_KEY", raising=False)

    assert client.get("/api/coins").status_code == 200


def test_rate_limit_returns_429(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "3")

    statuses = [client.get("/api/meta").status_code for _ in range(4)]

    assert statuses == [200, 200, 200, 429]


def test_rate_limit_can_be_disabled(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "0")

    statuses = [client.get("/api/meta").status_code for _ in range(5)]

    assert statuses == [200] * 5
