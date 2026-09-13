
import alerts
from models import Coin, Watch


class FakeResponse:
    def raise_for_status(self):
        return None


def test_check_alerts_triggers_on_threshold_crossing(db, monkeypatch):
    sent = []
    monkeypatch.setattr(alerts, "send_alert", lambda message, payload: sent.append(payload) or True)
    monkeypatch.delenv("ALERT_THRESHOLD_PCT", raising=False)

    db.add(
        Coin(
            symbol="ETHBTC",
            is_pre_2021=True,
            listed_checked=True,
            distance_pct_event=30.0,
            current_price_btc=0.03,
        )
    )
    db.add(Watch(symbol="ETHBTC", threshold_pct=20.0, last_distance=30.0))
    db.commit()

    assert alerts.check_alerts(db) == []

    coin = db.get(Coin, "ETHBTC")
    coin.distance_pct_event = 15.0
    db.commit()

    triggered = alerts.check_alerts(db)
    assert len(triggered) == 1
    assert triggered[0]["symbol"] == "ETHBTC"
    assert triggered[0]["threshold_pct"] == 20.0
    assert triggered[0]["delivered"] is True
    assert sent and sent[0]["symbol"] == "ETHBTC"

    # No repeat while the coin stays below the threshold.
    assert alerts.check_alerts(db) == []

    # Re-crossing after recovering above the threshold alerts again.
    coin.distance_pct_event = 40.0
    assert alerts.check_alerts(db) == []
    coin.distance_pct_event = 18.0
    assert len(alerts.check_alerts(db)) == 1


def test_check_alerts_uses_default_threshold_and_first_time(db, monkeypatch):
    monkeypatch.setattr(alerts, "send_alert", lambda message, payload: False)
    monkeypatch.setenv("ALERT_THRESHOLD_PCT", "25")

    db.add(Coin(symbol="ETHBTC", is_pre_2021=True, listed_checked=True, distance_pct_event=10.0))
    db.add(Watch(symbol="ETHBTC", threshold_pct=None))
    db.commit()

    triggered = alerts.check_alerts(db)

    assert len(triggered) == 1
    assert triggered[0]["threshold_pct"] == 25.0
    assert triggered[0]["delivered"] is False


def test_send_alert_posts_to_webhook(monkeypatch):
    calls = []

    def fake_post(url, json=None, timeout=None):
        calls.append((url, json))
        return FakeResponse()

    monkeypatch.setattr(alerts.requests, "post", fake_post)
    monkeypatch.setenv("ALERT_WEBHOOK_URL", "https://example.com/hook")
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)

    assert alerts.send_alert("hello", {"symbol": "ETHBTC"}) is True
    assert calls == [("https://example.com/hook", {"symbol": "ETHBTC"})]


def test_send_alert_posts_to_telegram(monkeypatch):
    calls = []

    def fake_post(url, json=None, timeout=None):
        calls.append((url, json))
        return FakeResponse()

    monkeypatch.setattr(alerts.requests, "post", fake_post)
    monkeypatch.delenv("ALERT_WEBHOOK_URL", raising=False)
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token123")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "42")

    assert alerts.send_alert("hello", {"symbol": "ETHBTC"}) is True
    assert calls == [
        (
            "https://api.telegram.org/bottoken123/sendMessage",
            {"chat_id": "42", "text": "hello"},
        )
    ]


def test_send_alert_without_configuration_returns_false(monkeypatch):
    monkeypatch.delenv("ALERT_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)

    assert alerts.send_alert("hello", {"symbol": "ETHBTC"}) is False
