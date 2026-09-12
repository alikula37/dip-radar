from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Integer,
    String,
    UniqueConstraint,
)

from database import Base
from timeutils import utcnow_naive

QUOTE_ASSETS = ("USDT", "BTC")


def split_symbol(symbol: str):
    """Split an exchange symbol into (base_asset, quote_asset)."""
    for quote in QUOTE_ASSETS:
        if symbol.endswith(quote):
            return symbol[: -len(quote)], quote
    return symbol, None


class Coin(Base):
    __tablename__ = "coins"

    symbol = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=True)
    coingecko_id = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)

    listing_date = Column(DateTime, nullable=True)
    is_pre_2021 = Column(Boolean, default=False, nullable=False)
    listed_checked = Column(Boolean, default=False, nullable=False)

    current_price_btc = Column(Float, nullable=True)
    price_7d_ago_btc = Column(Float, nullable=True)
    price_30d_ago_btc = Column(Float, nullable=True)
    price_verified = Column(Boolean, nullable=True)
    price_deviation_pct = Column(Float, nullable=True)
    event_low = Column(Float, nullable=True)  # Lowest since 2021-01-01 or listing
    all_time_low = Column(Float, nullable=True)  # Lowest since listing

    distance_pct_event = Column(Float, nullable=True)
    distance_pct_atl = Column(Float, nullable=True)

    market_cap = Column(Float, nullable=True)
    volume_24h = Column(Float, nullable=True)

    last_updated = Column(DateTime, default=utcnow_naive)

    @property
    def quote_asset(self):
        return split_symbol(self.symbol)[1]

    @property
    def base_asset(self):
        return split_symbol(self.symbol)[0]


class Kline(Base):
    __tablename__ = "klines"
    __table_args__ = (
        UniqueConstraint("symbol", "timestamp", name="uq_kline_symbol_timestamp"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    symbol = Column(String, index=True, nullable=False)
    timestamp = Column(DateTime, index=True, nullable=False)
    open = Column(Float)
    high = Column(Float)
    low = Column(Float)
    close = Column(Float)
    volume = Column(Float)


class Meta(Base):
    __tablename__ = "meta"

    key = Column(String, primary_key=True)
    value = Column(String)


class SyncLock(Base):
    __tablename__ = "sync_locks"

    name = Column(String, primary_key=True)
    acquired_at = Column(DateTime)
    expires_at = Column(DateTime)
