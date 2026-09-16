from fastapi.testclient import TestClient

import main
import signals

client = TestClient(main.app)

WATCH_BODY = {
    "name": "Seeded dip",
    "start": "2023-01-01",
    "rebalance": "weekly",
    "params": {
        "top_n": 1,
        "min_score": 0,
        "min_market_cap": 10_000_000,
        "min_volume": 250_000,
        "weighting": "equal",
        "rotation": "rebalance",
        "profit_sweep_pct": 0,
    },
}


def _fresh_db():
    from database import Base, SessionLocal, engine
    from test_signals import _seed

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    _seed(db)
    db.close()


def test_watch_creation_stores_the_first_signals_and_a_shadow_baseline():
    _fresh_db()

    response = client.post("/api/strategy/watches", json=WATCH_BODY)

    assert response.status_code == 201
    payload = response.json()
    assert payload["watch"]["name"] == "Seeded dip"
    assert payload["watch"]["start_equity"] == payload["watch"]["last_equity"]
    assert payload["watch"]["paper_return"] == 0.0
    actions = {signal["action"] for signal in payload["inserted"]}
    assert actions & {"HOLD", "BUY"}

    history = client.get(f"/api/strategy/watches/{payload['watch']['id']}/signals").json()
    assert history and history[0]["symbol"] == "ETHUSDT"


def test_watch_refresh_is_idempotent_for_the_same_anchor():
    _fresh_db()
    created = client.post("/api/strategy/watches", json=WATCH_BODY).json()
    watch_id = created["watch"]["id"]

    again = client.post(f"/api/strategy/watches/{watch_id}/refresh").json()

    assert again["inserted"] == []


def test_watch_crud_list_and_delete():
    _fresh_db()
    created = client.post("/api/strategy/watches", json=WATCH_BODY).json()
    watch_id = created["watch"]["id"]

    listed = client.get("/api/strategy/watches").json()
    assert [watch["id"] for watch in listed] == [watch_id]

    assert client.delete(f"/api/strategy/watches/{watch_id}").status_code == 204
    assert client.get("/api/strategy/watches").json() == []
    assert client.get(f"/api/strategy/watches/{watch_id}/signals").status_code == 404


def test_watch_live_endpoint_replays_without_storing_and_reports_returns():
    _fresh_db()
    created = client.post("/api/strategy/watches", json=WATCH_BODY).json()
    watch_id = created["watch"]["id"]
    before = client.get(f"/api/strategy/watches/{watch_id}/signals").json()

    live = client.get(f"/api/strategy/watches/{watch_id}/live")

    assert live.status_code == 200
    payload = live.json()
    assert payload["anchor"] == created["watch"]["last_anchor"]
    assert payload["positions"] is not None
    after = client.get(f"/api/strategy/watches/{watch_id}/signals").json()
    assert len(after) == len(before)
    assert all(record["return_since"] == 0.0 for record in after)


def test_actionable_signals_alert_and_holds_do_not(monkeypatch):
    _fresh_db()
    sent = []
    monkeypatch.setattr(signals, "send_alert", lambda message, payload: sent.append(payload) or True)

    response = client.post("/api/strategy/watches", json=WATCH_BODY)

    assert response.status_code == 201
    inserted = response.json()["inserted"]
    assert inserted
    alerted_actions = {payload["action"] for payload in sent}
    assert alerted_actions <= {"BUY", "SELL", "SHORT", "STAY_IN_BTC"}
    assert all(action != "HOLD" for action in alerted_actions)


def test_worker_refresh_covers_active_watches(monkeypatch):
    _fresh_db()
    monkeypatch.setattr(signals, "send_alert", lambda message, payload: True)
    client.post("/api/strategy/watches", json=WATCH_BODY)

    summary = signals.refresh_active_watches()

    assert summary["watches"] == 1
    assert summary["errors"] == 0
    assert summary["signals"] == 0  # same anchor: nothing new
