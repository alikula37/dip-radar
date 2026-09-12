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
