from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class CoinBase(BaseModel):
    symbol: str
    base_asset: Optional[str] = None
    quote_asset: Optional[str] = None
    name: Optional[str] = None
    coingecko_id: Optional[str] = None
    logo_url: Optional[str] = None
    listing_date: Optional[datetime] = None
    is_pre_2021: bool
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
    last_updated: Optional[datetime] = None


class CoinResponse(CoinBase):
    bubble_size_event: Optional[float] = None
    bubble_size_atl: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


class KlineResponse(BaseModel):
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float

    model_config = ConfigDict(from_attributes=True)


class MetaResponse(BaseModel):
    last_updated: Optional[str] = None
    tracked_coins: int
    sync_in_progress: bool = False
    sync_progress: Optional[dict] = None
