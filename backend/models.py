from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
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
    is_stable = Column(Boolean, default=False, nullable=False)
    delisted_at = Column(DateTime, nullable=True)

    current_price_btc = Column(Float, nullable=True)
    price_7d_ago_btc = Column(Float, nullable=True)
    price_30d_ago_btc = Column(Float, nullable=True)
    price_verified = Column(Boolean, nullable=True)
    price_deviation_pct = Column(Float, nullable=True)
    valuation_pct_1y = Column(Float, nullable=True)
    valuation_pct_3y = Column(Float, nullable=True)
    valuation_pct_all = Column(Float, nullable=True)
    median_dist_1y = Column(Float, nullable=True)
    median_dist_3y = Column(Float, nullable=True)
    range_position = Column(Float, nullable=True)
    days_since_atl = Column(Integer, nullable=True)
    basing_pct_90d = Column(Float, nullable=True)
    dip_touches = Column(Integer, nullable=True)
    dip_bounces = Column(Integer, nullable=True)
    dip_bounce_avg = Column(Float, nullable=True)
    trend_30d_pct = Column(Float, nullable=True)
    trend_90d_pct = Column(Float, nullable=True)
    above_sma200 = Column(Boolean, nullable=True)
    history_days = Column(Integer, nullable=True)
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


class BtcRate(Base):
    """Daily BTCUSDT candles used to convert BTC parity values to USD."""

    __tablename__ = "btc_rates"

    timestamp = Column(DateTime, primary_key=True)
    high = Column(Float)
    low = Column(Float)
    close = Column(Float)


class MarketHistory(Base):
    """Daily point-in-time USD market data (CoinGecko) per tracked coin.

    Kept separate from ``Kline`` (BTC parity) so research features can use the
    liquidity that actually existed on a historical date instead of today's
    market cap/volume snapshot.
    """

    __tablename__ = "market_history"
    __table_args__ = (
        UniqueConstraint("symbol", "timestamp", name="uq_market_history_symbol_timestamp"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    symbol = Column(String, index=True, nullable=False)
    timestamp = Column(DateTime, index=True, nullable=False)
    price_usd = Column(Float, nullable=True)
    market_cap = Column(Float, nullable=True)
    volume_24h = Column(Float, nullable=True)


class StrategyWatch(Base):
    """A saved strategy configuration whose signals the worker tracks.

    ``params_json`` carries the full signal parameter dict; ``start_equity``
    freezes the simulated equity at creation so the watch can report a paper
    return without trusting any external state.
    """

    __tablename__ = "strategy_watches"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String, nullable=False)
    params_json = Column(Text, nullable=False)
    active = Column(Boolean, default=True, nullable=False)
    start_equity = Column(Float, nullable=True)
    last_equity = Column(Float, nullable=True)
    last_anchor = Column(DateTime, nullable=True)
    last_refreshed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)


class StrategySignal(Base):
    """One stored, deduplicated signal per watch, date, action and symbol."""

    __tablename__ = "strategy_signals"
    __table_args__ = (
        UniqueConstraint("watch_id", "date", "action", "symbol", name="uq_strategy_signal"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    watch_id = Column(Integer, ForeignKey("strategy_watches.id"), index=True, nullable=False)
    date = Column(DateTime, index=True, nullable=False)
    action = Column(String, nullable=False)
    symbol = Column(String, nullable=False, default="")
    reason = Column(String, nullable=True)
    weight = Column(Float, nullable=True)
    score = Column(Float, nullable=True)
    price = Column(Float, nullable=True)
    equity = Column(Float, nullable=True)
    message = Column(Text, nullable=True)
    # Paper move of the watch's own book since this signal, recomputed on every
    # refresh from the current replay curve (so flat weeks read 0.00% instead of
    # drifting with data vintages).
    return_since = Column(Float, nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)


class Watch(Base):
    __tablename__ = "watchlist"

    symbol = Column(String, primary_key=True)
    threshold_pct = Column(Float, nullable=True)  # None -> ALERT_THRESHOLD_PCT
    created_at = Column(DateTime, default=utcnow_naive)
    last_distance = Column(Float, nullable=True)
    last_alerted_at = Column(DateTime, nullable=True)
