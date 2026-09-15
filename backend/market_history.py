"""Point-in-time daily market history ingestion (CoinGecko -> market_history).

Run inside the backend container or locally against a database copy:

    python -m market_history --limit 20          # small validation run
    python -m market_history                     # every coin with a coingecko_id
    python -m market_history --symbols ETHBTC FTTUSDT --delay 0
"""

import argparse
import logging
import time
from datetime import datetime, timezone

from sqlalchemy import func

from fetcher import CoinGeckoClient, CoinGeckoError
from models import Coin, MarketHistory

logger = logging.getLogger(__name__)

DEFAULT_DELAY_SECONDS = 2.5  # the free CoinGecko tier allows ~30 calls/minute


def daily_rows(payload: dict) -> list:
    """Normalize a market_chart payload to one UTC-midnight row per day."""
    prices = {int(ts): float(value) for ts, value in payload.get("prices", []) if value}
    caps = {int(ts): float(value) for ts, value in payload.get("market_caps", []) if value}
    volumes = {int(ts): float(value) for ts, value in payload.get("total_volumes", []) if value}

    rows = {}
    for timestamp_ms in sorted(prices):
        moment = datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).replace(
            tzinfo=None, hour=0, minute=0, second=0, microsecond=0
        )
        rows[moment] = {
            "timestamp": moment,
            "price_usd": prices[timestamp_ms],
            "market_cap": caps.get(timestamp_ms),
            "volume_24h": volumes.get(timestamp_ms),
        }
    return [rows[moment] for moment in sorted(rows)]


def upsert_market_history(db, symbol: str, rows: list) -> tuple:
    """Insert missing days and refresh changed values; returns (inserted, updated)."""
    existing = {
        row.timestamp: row
        for row in db.query(MarketHistory).filter(MarketHistory.symbol == symbol).all()
    }
    inserted = 0
    updated = 0
    for row in rows:
        current = existing.get(row["timestamp"])
        if current is None:
            db.add(MarketHistory(symbol=symbol, **row))
            inserted += 1
            continue
        values = (current.price_usd, current.market_cap, current.volume_24h)
        expected = (row["price_usd"], row["market_cap"], row["volume_24h"])
        if values != expected:
            current.price_usd = row["price_usd"]
            current.market_cap = row["market_cap"]
            current.volume_24h = row["volume_24h"]
            updated += 1
    db.commit()
    return inserted, updated


def sync_market_history(
    db,
    client,
    symbols=None,
    delay: float = DEFAULT_DELAY_SECONDS,
    limit=None,
    progress=None,
) -> dict:
    """Fetch and store daily USD history for tracked coins (delisted included)."""
    coins = (
        db.query(Coin)
        .filter(Coin.coingecko_id.isnot(None))
        .order_by(func.coalesce(Coin.market_cap, -1).desc(), Coin.symbol)
        .all()
    )
    if symbols:
        wanted = set(symbols)
        coins = [coin for coin in coins if coin.symbol in wanted]
    if limit:
        coins = coins[:limit]

    summary = {"coins": 0, "inserted": 0, "updated": 0, "failed": []}
    hinted = False
    for index, coin in enumerate(coins, start=1):
        try:
            payload = client.fetch_market_chart(coin.coingecko_id)
            rows = daily_rows(payload)
            inserted, updated = upsert_market_history(db, coin.symbol, rows)
        except (CoinGeckoError, ValueError, TypeError) as exc:
            if "401" in str(exc) and not hinted:
                logger.warning(
                    "CoinGecko market_chart requires an API key; set COINGECKO_API_KEY "
                    "(free Demo key) to ingest point-in-time history."
                )
                hinted = True
            logger.warning("Market history failed for %s: %s", coin.symbol, exc)
            summary["failed"].append(coin.symbol)
            continue

        summary["coins"] += 1
        summary["inserted"] += inserted
        summary["updated"] += updated
        if progress:
            progress(coin.symbol, index, len(coins), len(rows))
        if delay and index < len(coins):
            time.sleep(delay)
    return summary


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s:%(name)s:%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbols", nargs="+", help="Only these symbols (default: all with a coingecko_id)")
    parser.add_argument("--limit", type=int, help="Stop after N coins (handy for a first run)")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY_SECONDS, help="Seconds between coins")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    from database import Base, SessionLocal, engine

    Base.metadata.create_all(bind=engine)

    def progress(symbol, index, total, rows):
        if not args.quiet:
            print(f"[{index}/{total}] {symbol}: {rows} days")

    db = SessionLocal()
    try:
        summary = sync_market_history(
            db,
            CoinGeckoClient(),
            symbols=args.symbols,
            delay=args.delay,
            limit=args.limit,
            progress=progress,
        )
    finally:
        db.close()

    print(
        f"coins={summary['coins']} inserted={summary['inserted']} "
        f"updated={summary['updated']} failed={len(summary['failed'])}"
    )
    if summary["failed"]:
        print("failed:", ", ".join(summary["failed"]))


if __name__ == "__main__":
    main()
