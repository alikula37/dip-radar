"""Seed deterministic demo data (no network) for local demos and E2E tests."""

import math
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from database import Base, SessionLocal, engine
from fetcher import update_coin_metrics
from models import Coin, Kline, Meta
from timeutils import utcnow

COINS = [
    ("ETHBTC", "Ethereum", "ethereum", 300_000_000_000.0, 0.032),
    ("BNBBTC", "BNB", "binancecoin", 90_000_000_000.0, 0.0095),
    ("XRPBTC", "XRP", "ripple", 80_000_000_000.0, 0.0000021),
    ("DOTBTC", "Polkadot", "polkadot", 6_000_000_000.0, 0.000013),
    ("LTCBTC", "Litecoin", "litecoin", 5_000_000_000.0, 0.0007),
]


def main(days: int = 180) -> None:
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()
    try:
        if db.query(Coin).count() > 0:
            print("Database already contains coins; skipping demo seed.")
            return

        start = datetime(2024, 1, 1)
        for index, (symbol, name, coingecko_id, market_cap, base_price) in enumerate(COINS):
            coin = Coin(
                symbol=symbol,
                name=name,
                coingecko_id=coingecko_id,
                listing_date=datetime(2016 + index, 1, 1),
                is_pre_2021=True,
                listed_checked=True,
                market_cap=market_cap,
                volume_24h=market_cap / 100,
            )
            db.add(coin)

            for day in range(days):
                timestamp = start + timedelta(days=day)
                wave = 1 + 0.35 * math.sin((day + index * 10) / 18)
                drift = 1 - day / (days * 2)
                close = base_price * wave * drift
                db.add(
                    Kline(
                        symbol=symbol,
                        timestamp=timestamp,
                        open=close,
                        high=close * 1.02,
                        low=close * 0.97,
                        close=close,
                        volume=1000.0,
                    )
                )
            db.commit()
            update_coin_metrics(db, coin)

        db.add(Meta(key="last_updated", value=utcnow().isoformat()))
        db.commit()
        print(f"Seeded {len(COINS)} demo coins with {days} days of candles.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
