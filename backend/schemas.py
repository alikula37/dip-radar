from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class CoinBase(BaseModel):
    symbol: str
    name: Optional[str] = None
    coingecko_id: Optional[str] = None
    logo_url: Optional[str] = None
    listing_date: Optional[datetime] = None
    is_pre_2021: bool
    current_price_btc: Optional[float] = None
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

    class Config:
        from_attributes = True

class KlineResponse(BaseModel):
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float

    class Config:
        from_attributes = True

class MetaResponse(BaseModel):
    last_updated: Optional[str] = None
    tracked_coins: int
