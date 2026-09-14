from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class CoinBase(BaseModel):
    symbol: str
    base_asset: Optional[str] = None
    quote_asset: Optional[str] = None
    name: Optional[str] = None
    coingecko_id: Optional[str] = None
    logo_url: Optional[str] = None
    listing_date: Optional[datetime] = None
    is_pre_2021: bool
    is_stable: bool = False
    current_price_btc: Optional[float] = None
    price_7d_ago_btc: Optional[float] = None
    price_30d_ago_btc: Optional[float] = None
    price_verified: Optional[bool] = None
    price_deviation_pct: Optional[float] = None
    event_low: Optional[float] = None
    all_time_low: Optional[float] = None
    distance_pct_event: Optional[float] = None
    distance_pct_atl: Optional[float] = None
    market_cap: Optional[float] = None
    volume_24h: Optional[float] = None
    valuation_pct_1y: Optional[float] = None
    valuation_pct_3y: Optional[float] = None
    valuation_pct_all: Optional[float] = None
    median_dist_1y: Optional[float] = None
    median_dist_3y: Optional[float] = None
    range_position: Optional[float] = None
    days_since_atl: Optional[int] = None
    basing_pct_90d: Optional[float] = None
    trend_30d_pct: Optional[float] = None
    trend_90d_pct: Optional[float] = None
    above_sma200: Optional[bool] = None
    history_days: Optional[int] = None
    last_updated: Optional[datetime] = None


class CoinResponse(CoinBase):
    bubble_size_event: Optional[float] = None
    bubble_size_atl: Optional[float] = None
    value_score: Optional[float] = None
    value_parts: Optional[dict] = None

    model_config = ConfigDict(from_attributes=True)


class KlineResponse(BaseModel):
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float

    model_config = ConfigDict(from_attributes=True)


class DipHistoryPoint(BaseModel):
    timestamp: datetime
    close: float
    all_time_low: float
    event_low: float
    distance_pct_event: float
    distance_pct_atl: float


class MetaResponse(BaseModel):
    last_updated: Optional[str] = None
    tracked_coins: int
    sync_in_progress: bool = False
    sync_progress: Optional[dict] = None


class WatchCreate(BaseModel):
    threshold_pct: Optional[float] = Field(default=None, ge=0, le=1000)


class WatchResponse(BaseModel):
    symbol: str
    base_asset: Optional[str] = None
    name: Optional[str] = None
    logo_url: Optional[str] = None
    current_price_btc: Optional[float] = None
    distance_pct_event: Optional[float] = None
    distance_pct_atl: Optional[float] = None
    market_cap: Optional[float] = None
    threshold_pct: Optional[float] = None
    last_distance: Optional[float] = None
    last_alerted_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
