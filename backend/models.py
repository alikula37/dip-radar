from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime
from database import Base
from datetime import datetime

class Coin(Base):
    __tablename__ = "coins"

    symbol = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=True)
    coingecko_id = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    
    listing_date = Column(DateTime, nullable=True)
    is_pre_2021 = Column(Boolean, default=False)
    
    current_price_btc = Column(Float, nullable=True)
    event_low = Column(Float, nullable=True) # Lowest since 2021-01-01 or listing
    all_time_low = Column(Float, nullable=True) # Lowest since listing
    
    distance_pct_event = Column(Float, nullable=True)
    distance_pct_atl = Column(Float, nullable=True)
    
    market_cap = Column(Float, nullable=True)
    volume_24h = Column(Float, nullable=True)
    
    last_updated = Column(DateTime, default=datetime.utcnow)

class Kline(Base):
    __tablename__ = "klines"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    symbol = Column(String, index=True)
    timestamp = Column(DateTime, index=True)
    open = Column(Float)
    high = Column(Float)
    low = Column(Float)
    close = Column(Float)
    volume = Column(Float)

class Meta(Base):
    __tablename__ = "meta"
    
    key = Column(String, primary_key=True)
    value = Column(String)
