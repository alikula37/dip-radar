from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

import main
from database import Base, SessionLocal, engine
from models import Coin, Kline, Meta, SyncLock
from timeutils import utcnow_naive

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    main.rate_limiter.hits.clear()
    yield
    main.rate_limiter.hits.clear()


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
    assert payload["sync_in_progress"] is False
    assert payload["last_updated"] == "2026-01-01T00:00:00+00:00"
    assert payload["sync_progress"]["phase"] == "klines"
    assert payload["sync_progress"]["processed"] == 10


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
