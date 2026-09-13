import logging
import os

import requests

from models import Coin, Watch
from timeutils import utcnow_naive

logger = logging.getLogger(__name__)

DEFAULT_THRESHOLD_PCT = 20.0


def send_alert(message: str, payload: dict) -> bool:
    """Deliver an alert through the configured webhook and/or Telegram bot."""
    delivered = False

    webhook = os.getenv("ALERT_WEBHOOK_URL")
    if webhook:
        try:
            response = requests.post(webhook, json=payload, timeout=10)
            response.raise_for_status()
            delivered = True
        except requests.RequestException as exc:
            logger.warning("Webhook alert failed: %s", exc)

    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if token and chat_id:
        try:
            response = requests.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": message},
                timeout=10,
            )
            response.raise_for_status()
            delivered = True
        except requests.RequestException as exc:
            logger.warning("Telegram alert failed: %s", exc)

    if not delivered:
        logger.info("Alert (no notifier configured): %s", message)
    return delivered


def check_alerts(db) -> list:
    """Fire alerts when a watched coin crosses below its dip-distance threshold."""
    default_threshold = float(os.getenv("ALERT_THRESHOLD_PCT", str(DEFAULT_THRESHOLD_PCT)))
    triggered = []

    for watch in db.query(Watch).all():
        coin = db.get(Coin, watch.symbol)
        if coin is None or coin.distance_pct_event is None:
            continue

        threshold = watch.threshold_pct if watch.threshold_pct is not None else default_threshold
        previous = watch.last_distance
        current = coin.distance_pct_event

        crossing = previous is None or (previous > threshold >= current)
        watch.last_distance = current

        if not crossing or current > threshold:
            continue

        watch.last_alerted_at = utcnow_naive()
        message = (
            f"Dip alert: {coin.base_asset} is {current:.1f}% from its 2021 low "
            f"(threshold {threshold:.0f}%)."
        )
        triggered.append(
            {
                "symbol": coin.symbol,
                "base_asset": coin.base_asset,
                "name": coin.name,
                "distance_pct_event": current,
                "threshold_pct": threshold,
                "price_btc": coin.current_price_btc,
                "message": message,
                "triggered_at": utcnow_naive().isoformat(),
            }
        )

    if triggered:
        db.commit()

    for alert in triggered:
        alert["delivered"] = send_alert(alert["message"], alert)
        logger.info("Alert: %s (delivered=%s)", alert["message"], alert["delivered"])

    return triggered
