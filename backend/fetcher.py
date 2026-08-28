import requests
import time
from datetime import datetime, timezone
import logging
from sqlalchemy.orm import Session
from models import Coin, Kline, Meta
from metrics import calculate_distance_pct

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BINANCE_API_URL = "https://api.binance.com/api/v3"
COINGECKO_API_URL = "https://api.coingecko.com/api/v3"

def fetch_binance_symbols():
    try:
        res = requests.get(f"{BINANCE_API_URL}/exchangeInfo")
        res.raise_for_status()
        data = res.json()
        symbols = []
        for s in data.get("symbols", []):
            if s["quoteAsset"] == "BTC" and s["status"] == "TRADING":
                symbols.append(s["symbol"])
        return symbols
    except Exception as e:
        logger.error(f"Error fetching symbols: {e}")
        return []

def fetch_first_kline(symbol: str):
    try:
        res = requests.get(f"{BINANCE_API_URL}/klines", params={
            "symbol": symbol,
            "interval": "1d",
            "limit": 1,
            "startTime": 0
        })
        if res.status_code == 429 or res.status_code == 418:
            retry_after = int(res.headers.get("Retry-After", 5))
            time.sleep(retry_after)
            return fetch_first_kline(symbol)
        res.raise_for_status()
        data = res.json()
        if data:
            return data[0]
        return None
    except Exception as e:
        logger.error(f"Error fetching first kline for {symbol}: {e}")
        return None

def fetch_klines(symbol: str, start_time: int = None, limit: int = 1000):
    try:
        params = {
            "symbol": symbol,
            "interval": "1d",
            "limit": limit
        }
        if start_time:
            params["startTime"] = start_time
            
        res = requests.get(f"{BINANCE_API_URL}/klines", params=params)
        if res.status_code == 429 or res.status_code == 418:
            retry_after = int(res.headers.get("Retry-After", 5))
            time.sleep(retry_after)
            return fetch_klines(symbol, start_time, limit)
            
        res.raise_for_status()
        return res.json()
    except Exception as e:
        logger.error(f"Error fetching klines for {symbol}: {e}")
        return []

def sync_coins(db: Session):
    logger.info("Starting sync_coins...")
    symbols = fetch_binance_symbols()
    cutoff_date = datetime(2021, 1, 1, tzinfo=timezone.utc)
    
    for symbol in symbols:
        coin = db.query(Coin).filter(Coin.symbol == symbol).first()
        if not coin:
            first_kline = fetch_first_kline(symbol)
            if first_kline:
                listing_ts = first_kline[0]
                listing_date = datetime.fromtimestamp(listing_ts / 1000, tz=timezone.utc)
                is_pre_2021 = listing_date < cutoff_date
                
                if is_pre_2021:
                    coin = Coin(
                        symbol=symbol,
                        listing_date=listing_date,
                        is_pre_2021=True
                    )
                    db.add(coin)
                    db.commit()
            time.sleep(0.1) # Rate limit protection

def sync_klines(db: Session):
    logger.info("Starting sync_klines...")
    coins = db.query(Coin).filter(Coin.is_pre_2021 == True).all()
    
    for coin in coins:
        last_kline = db.query(Kline).filter(Kline.symbol == coin.symbol).order_by(Kline.timestamp.desc()).first()
        start_time = int(last_kline.timestamp.timestamp() * 1000) + 1 if last_kline else 0
        
        while True:
            klines = fetch_klines(coin.symbol, start_time=start_time)
            if not klines:
                break
                
            for k in klines:
                ts = datetime.fromtimestamp(k[0] / 1000, tz=timezone.utc)
                kline = Kline(
                    symbol=coin.symbol,
                    timestamp=ts,
                    open=float(k[1]),
                    high=float(k[2]),
                    low=float(k[3]),
                    close=float(k[4]),
                    volume=float(k[5])
                )
                db.add(kline)
            
            db.commit()
            start_time = klines[-1][0] + 1
            if len(klines) < 1000:
                break
            time.sleep(0.1)
            
        # Update metrics
        all_klines = db.query(Kline).filter(Kline.symbol == coin.symbol).order_by(Kline.timestamp.asc()).all()
        if all_klines:
            current_price = all_klines[-1].close
            all_time_low = min(k.low for k in all_klines)
            
            # Event low (lowest since 2021-01-01)
            event_klines = [k for k in all_klines if k.timestamp >= datetime(2021, 1, 1, tzinfo=timezone.utc)]
            event_low = min(k.low for k in event_klines) if event_klines else all_time_low
            
            coin.current_price_btc = current_price
            coin.all_time_low = all_time_low
            coin.event_low = event_low
            coin.distance_pct_atl = calculate_distance_pct(current_price, all_time_low)
            coin.distance_pct_event = calculate_distance_pct(current_price, event_low)
            coin.last_updated = datetime.utcnow()
            db.commit()

def fetch_coingecko_list():
    try:
        res = requests.get(f"{COINGECKO_API_URL}/coins/list")
        res.raise_for_status()
        return res.json()
    except Exception as e:
        logger.error(f"Error fetching coingecko list: {e}")
        return []

def sync_coingecko(db: Session):
    logger.info("Starting sync_coingecko...")
    cg_list = fetch_coingecko_list()
    if not cg_list:
        return
        
    cg_map = {c["symbol"].lower(): c["id"] for c in cg_list}
    
    coins = db.query(Coin).filter(Coin.is_pre_2021 == True).all()
    cg_ids = []
    for coin in coins:
        base_symbol = coin.symbol[:-3].lower() # Remove BTC
        if base_symbol in cg_map:
            coin.coingecko_id = cg_map[base_symbol]
            cg_ids.append(coin.coingecko_id)
    db.commit()
    
    # Fetch market data in batches
    batch_size = 250
    for i in range(0, len(cg_ids), batch_size):
        batch = cg_ids[i:i+batch_size]
        try:
            res = requests.get(f"{COINGECKO_API_URL}/coins/markets", params={
                "vs_currency": "usd",
                "ids": ",".join(batch)
            })
            if res.status_code == 429:
                time.sleep(60)
                continue
            res.raise_for_status()
            markets = res.json()
            for m in markets:
                coin = db.query(Coin).filter(Coin.coingecko_id == m["id"]).first()
                if coin:
                    coin.name = m.get("name")
                    coin.logo_url = m.get("image")
                    coin.market_cap = m.get("market_cap")
                    coin.volume_24h = m.get("total_volume")
            db.commit()
        except Exception as e:
            logger.error(f"Error fetching coingecko markets: {e}")
        time.sleep(2) # Rate limit protection

def run_all_syncs(db: Session):
    sync_coins(db)
    sync_klines(db)
    sync_coingecko(db)
    
    meta = db.query(Meta).filter(Meta.key == "last_updated").first()
    if not meta:
        meta = Meta(key="last_updated")
        db.add(meta)
    meta.value = datetime.utcnow().isoformat()
    db.commit()
