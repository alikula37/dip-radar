from datetime import datetime, timedelta

from fastapi.testclient import TestClient

import main
from backtest import build_snapshot, simulate
from models import Coin, Kline

client = TestClient(main.app)

START = datetime(2021, 1, 1)
DAYS = 1100


def _price(index: int) -> float:
    return 100.0 - 0.05 * index


def _seed(db):
    coin = Coin(
        symbol="ETHUSDT",
        is_pre_2021=False,
        listed_checked=True,
        market_cap=50_000_000.0,
        volume_24h=1_000_000.0,
        current_price_btc=_price(DAYS - 1),
    )
    db.add(coin)
    for day in range(DAYS):
        price = _price(day)
        db.add(
            Kline(
                symbol="ETHUSDT",
                timestamp=START + timedelta(days=day),
                open=price,
                high=price,
                low=price,
                close=price,
                volume=1_000_000.0,
            )
        )
    db.commit()


SIGNAL_PARAMS = {
    "top_n": 1,
    "min_score": 0,
    "min_market_cap": 10_000_000,
    "min_volume": 250_000,
    "weighting": "equal",
    "fill_with_btc": True,
    "fee_pct": 0.1,
    "rotation": "rebalance",
    "regime_min_breadth": 0.5,
    "regime_exposure": 0.0,
    "short_n": 0,
    "short_funding_apr": 0.0,
    "short_exposure": 1.0,
    "profit_sweep_pct": 0,
    "invert_score": False,
    "ic_filter": False,
    "ic_window": 6,
    "ic_threshold": 0.0,
    "ic_exposure": 0.35,
    "score_model": "rule",
}


def _seed_pair(db):
    """ETHUSDT (falling) + RICHUSDT (rising): gives shorts and breadth something to work with."""
    _seed(db)
    db.add(
        Coin(
            symbol="RICHUSDT",
            is_pre_2021=False,
            listed_checked=True,
            market_cap=50_000_000.0,
            volume_24h=1_000_000.0,
            current_price_btc=1.0 + 0.05 * (DAYS - 1),
        )
    )
    for day in range(DAYS):
        price = 1.0 + 0.05 * day
        db.add(
            Kline(
                symbol="RICHUSDT",
                timestamp=START + timedelta(days=day),
                open=price,
                high=price,
                low=price,
                close=price,
                volume=1_000_000.0,
            )
        )
    db.commit()


def test_short_positions_carry_entry_price_and_pnl():
    from database import Base, SessionLocal, engine

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    _seed_pair(db)
    db.close()

    response = client.get(
        "/api/strategy/signals",
        params={
            **SIGNAL_PARAMS,
            "start": "2023-01-01",
            "rebalance": "weekly",
            "short_n": "1",
            "short_max_score": "100",
            "top_n": "1",
        },
    )

    assert response.status_code == 200
    positions = response.json()["positions"]
    shorts = [position for position in positions if position["direction"] == "short"]
    assert shorts, positions
    assert shorts[0]["entry_price"] and shorts[0]["price_now"]
    assert shorts[0]["pnl_pct"] is not None
    assert shorts[0]["entry_date"]


def test_signals_endpoint_reports_the_live_book_and_next_anchor():
    from database import Base, SessionLocal, engine

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    _seed(db)
    db.close()

    response = client.get(
        "/api/strategy/signals",
        params={"start": "2023-01-01", "rebalance": "weekly", **SIGNAL_PARAMS},
    )

    assert response.status_code == 200
    payload = response.json()
    anchor = datetime.fromisoformat(payload["anchor"])
    next_anchor = datetime.fromisoformat(payload["next_anchor"])
    assert next_anchor == anchor + timedelta(days=7)
    assert payload["positions"], "the strategy holds a position in the seeded dip"
    position = payload["positions"][0]
    assert position["symbol"] == "ETHUSDT"
    assert position["action"] == "HOLD"
    assert position["entry_price"] and position["price_now"]
    assert payload["state"]["long_notional"] > 0
    assert payload["candidates"] == []
    assert payload["score_model"] == "rule"


def test_signals_stay_flat_when_the_regime_is_off():
    from database import Base, SessionLocal, engine

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    _seed_pair(db)
    db.close()

    response = client.get(
        "/api/strategy/signals",
        params={
            **SIGNAL_PARAMS,
            "start": "2023-01-01",
            "rebalance": "weekly",
            "regime_filter": "breadth",
            "regime_min_breadth": "1.0",
            "regime_exposure": "0.0",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["state"]["in_btc"] == "regime"
    assert payload["positions"] == []
    # Risk-off from the first anchor: the strategy never opened a position.
    assert payload["state"]["tracked"] == []
    assert "sits in BTC" in payload["message"]


def test_signals_match_the_backtest_state_exactly():
    from database import Base, SessionLocal, engine

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    _seed(db)

    start = datetime(2023, 1, 1)
    end = START + timedelta(days=DAYS - 1)
    snapshot = build_snapshot(db, "weekly", end, use_cache=False)
    simulate_params = {key: value for key, value in SIGNAL_PARAMS.items() if key != "score_model"}
    simulation = simulate(snapshot, start=start, end=end, **simulate_params)
    db.close()

    response = client.get(
        "/api/strategy/signals",
        params={"start": "2023-01-01", "rebalance": "weekly", **SIGNAL_PARAMS},
    )
    payload = response.json()

    assert payload["anchor"] == simulation["state"]["anchor"]
    assert payload["state"]["long_notional"] == simulation["state"]["long_notional"]
    assert payload["state"]["short_notional"] == simulation["state"]["short_notional"]
    assert payload["state"]["in_btc"] == simulation["state"]["in_btc"]
    signal_symbols = sorted(position["symbol"] for position in payload["positions"])
    state_symbols = sorted(position["symbol"] for position in simulation["state"]["positions"])
    assert signal_symbols == state_symbols
    for position in payload["positions"]:
        assert position["entry_price"] == next(
            entry["entry_price"]
            for entry in simulation["state"]["positions"]
            if entry["symbol"] == position["symbol"]
        )


def test_signals_report_daily_exits_after_the_anchor():
    from database import Base, SessionLocal, engine

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    _seed(db)
    db.close()

    response = client.get(
        "/api/strategy/signals",
        params={
            "start": "2023-01-01",
            "rebalance": "weekly",
            "stop_loss_pct": 1.0,
            **SIGNAL_PARAMS,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    exited = [position for position in payload["positions"] if position["action"] == "SELL"]
    # The seeded series falls ~0.05 per day, so a 1% stop fires within days.
    assert exited, payload["message"]
    assert exited[0]["reason"] == "stop_loss"
    assert exited[0]["trigger_date"] and exited[0]["trigger_price"]
