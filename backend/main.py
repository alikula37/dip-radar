import json
import logging
import os
import time
from collections import OrderedDict, defaultdict, deque
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import models
import schemas
from database import Base, engine, get_db
from fetcher import EVENT_CUTOFF, run_sync_with_lock
from locks import is_locked
from metrics import calculate_bubble_sizes, calculate_coin_stats, calculate_distance_pct, calculate_value_scores
from migrations import run_migrations

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s:%(name)s:%(message)s",
)
logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)
run_migrations(engine)

app = FastAPI(title="Dip Radar API", version="2.0.0")

cors_origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

RATE_LIMIT_WINDOW_SECONDS = 60
DEFAULT_RATE_LIMIT = 120


class SlidingWindowLimiter:
    def __init__(self, window_seconds: int = RATE_LIMIT_WINDOW_SECONDS):
        self.window_seconds = window_seconds
        self.hits = defaultdict(deque)

    def allow(self, key: str, limit: int) -> bool:
        now = time.monotonic()
        window = self.hits[key]
        while window and window[0] <= now - self.window_seconds:
            window.popleft()
        if len(window) >= limit:
            return False
        window.append(now)
        return True


rate_limiter = SlidingWindowLimiter()


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        api_key = os.getenv("API_KEY")
        if api_key and request.headers.get("x-api-key") != api_key:
            return JSONResponse(status_code=401, content={"detail": "Invalid or missing API key"})

        limit = int(os.getenv("RATE_LIMIT_PER_MINUTE", str(DEFAULT_RATE_LIMIT)))
        if limit > 0:
            client = request.client.host if request.client else "unknown"
            if not rate_limiter.allow(client, limit):
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests"},
                    headers={"Retry-After": str(RATE_LIMIT_WINDOW_SECONDS)},
                )

    return await call_next(request)


_AS_OF_CACHE: "OrderedDict[tuple, dict]" = OrderedDict()
_AS_OF_CACHE_SIZE = 24


def _closes_until(db: Session, cutoff: datetime) -> dict:
    ranked = (
        select(
            models.Kline.symbol,
            models.Kline.close,
            func.row_number()
            .over(partition_by=models.Kline.symbol, order_by=models.Kline.timestamp.desc())
            .label("rank"),
        )
        .where(models.Kline.timestamp <= cutoff)
        .subquery()
    )
    return dict(db.execute(select(ranked.c.symbol, ranked.c.close).where(ranked.c.rank == 1)).all())


def _as_of_metrics(db: Session, cutoff: datetime, event_start: datetime) -> dict:
    """Price/lows per symbol computed up to a historical cutoff date."""
    key = (cutoff.isoformat(), event_start.isoformat())
    cached = _AS_OF_CACHE.get(key)
    if cached is not None:
        _AS_OF_CACHE.move_to_end(key)
        return cached

    metrics = {
        "price": _closes_until(db, cutoff),
        "price_7d": _closes_until(db, cutoff - timedelta(days=7)),
        "price_30d": _closes_until(db, cutoff - timedelta(days=30)),
        "atl": dict(
            db.query(models.Kline.symbol, func.min(models.Kline.low))
            .filter(models.Kline.timestamp <= cutoff)
            .group_by(models.Kline.symbol)
            .all()
        ),
        "event_low": dict(
            db.query(models.Kline.symbol, func.min(models.Kline.low))
            .filter(models.Kline.timestamp >= event_start, models.Kline.timestamp <= cutoff)
            .group_by(models.Kline.symbol)
            .all()
        ),
    }

    # History-based stats (valuation percentiles, basing, trend) as of D.
    closes_by_symbol: dict = defaultdict(list)
    lows_by_symbol: dict = defaultdict(list)
    for symbol, close, low in db.execute(
        select(models.Kline.symbol, models.Kline.close, models.Kline.low)
        .where(models.Kline.timestamp <= cutoff)
        .order_by(models.Kline.symbol, models.Kline.timestamp)
    ).all():
        closes_by_symbol[symbol].append(close)
        lows_by_symbol[symbol].append(low)
    metrics["stats"] = {
        symbol: calculate_coin_stats(closes, lows_by_symbol[symbol])
        for symbol, closes in closes_by_symbol.items()
    }

    _AS_OF_CACHE[key] = metrics
    if len(_AS_OF_CACHE) > _AS_OF_CACHE_SIZE:
        _AS_OF_CACHE.popitem(last=False)
    return metrics


@app.get("/api/coins", response_model=List[schemas.CoinResponse])
def get_coins(
    low_from: Optional[str] = Query(default=None, description="Custom reference window start (YYYY-MM-DD)"),
    as_of: Optional[str] = Query(default=None, description="Historical snapshot date (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
):
    cutoff = None
    if as_of:
        try:
            cutoff = datetime.strptime(as_of, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="as_of must be YYYY-MM-DD")

    event_start = None
    if low_from:
        try:
            event_start = datetime.strptime(low_from, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="low_from must be YYYY-MM-DD")

    coins = (
        db.query(models.Coin)
        .filter(models.Coin.current_price_btc.isnot(None))
        .order_by(func.coalesce(models.Coin.market_cap, -1).desc())
        .all()
    )

    if cutoff is not None:
        metrics = _as_of_metrics(db, cutoff, event_start or datetime(2021, 1, 1))
        result = []
        for coin in coins:
            price = metrics["price"].get(coin.symbol)
            if price is None:
                continue

            coin.current_price_btc = price
            coin.price_7d_ago_btc = metrics["price_7d"].get(coin.symbol)
            coin.price_30d_ago_btc = metrics["price_30d"].get(coin.symbol)
            all_time_low = metrics["atl"].get(coin.symbol)
            event_low = metrics["event_low"].get(coin.symbol) or all_time_low
            if all_time_low is not None:
                coin.all_time_low = all_time_low
            if event_low is not None:
                coin.event_low = event_low
            coin.distance_pct_event = calculate_distance_pct(price, event_low)
            coin.distance_pct_atl = calculate_distance_pct(price, all_time_low)
            stats = metrics["stats"].get(coin.symbol)
            if stats:
                for key, value in stats.items():
                    setattr(coin, key, value)
            result.append(coin)
        coins = result
    elif event_start is not None:
        custom_lows = dict(
            db.query(models.Kline.symbol, func.min(models.Kline.low))
            .filter(models.Kline.timestamp >= event_start)
            .group_by(models.Kline.symbol)
            .all()
        )
        for coin in coins:
            low = custom_lows.get(coin.symbol)
            if low is not None:
                coin.event_low = low
                coin.distance_pct_event = calculate_distance_pct(coin.current_price_btc, low)

    calculate_bubble_sizes(coins, use_atl=False)
    calculate_bubble_sizes(coins, use_atl=True)
    calculate_value_scores(coins)
    return coins


@app.get("/api/coins/{symbol}/history", response_model=List[schemas.KlineResponse])
def get_coin_history(
    symbol: str,
    limit: int = Query(default=365, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    klines = (
        db.query(models.Kline)
        .filter(models.Kline.symbol == symbol)
        .order_by(models.Kline.timestamp.desc())
        .limit(limit)
        .all()
    )
    if not klines:
        raise HTTPException(status_code=404, detail="History not found")
    return list(reversed(klines))


@app.get("/api/coins/{symbol}/dip-history", response_model=List[schemas.DipHistoryPoint])
def get_dip_history(
    symbol: str,
    limit: int = Query(default=365, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    """Distance-from-dip series computed on a running basis for one coin."""
    klines = (
        db.query(models.Kline)
        .filter(models.Kline.symbol == symbol)
        .order_by(models.Kline.timestamp.asc())
        .all()
    )
    if not klines:
        raise HTTPException(status_code=404, detail="History not found")

    points = []
    all_time_low = None
    event_low = None

    for kline in klines:
        all_time_low = kline.low if all_time_low is None else min(all_time_low, kline.low)
        if kline.timestamp >= EVENT_CUTOFF:
            event_low = kline.low if event_low is None else min(event_low, kline.low)
        effective_event_low = event_low if event_low is not None else all_time_low

        points.append(
            schemas.DipHistoryPoint(
                timestamp=kline.timestamp,
                close=kline.close,
                all_time_low=all_time_low,
                event_low=effective_event_low,
                distance_pct_event=calculate_distance_pct(kline.close, effective_event_low),
                distance_pct_atl=calculate_distance_pct(kline.close, all_time_low),
            )
        )

    return points[-limit:]


@app.get("/api/meta", response_model=schemas.MetaResponse)
def get_meta(db: Session = Depends(get_db)):
    last_updated = db.query(models.Meta).filter(models.Meta.key == "last_updated").first()
    progress = db.query(models.Meta).filter(models.Meta.key == "sync_progress").first()
    count = db.query(models.Coin).filter(models.Coin.current_price_btc.isnot(None)).count()

    sync_progress = None
    if progress and progress.value:
        try:
            sync_progress = json.loads(progress.value)
        except ValueError:
            sync_progress = None

    return schemas.MetaResponse(
        last_updated=last_updated.value if last_updated else None,
        tracked_coins=count,
        sync_in_progress=is_locked(db),
        sync_progress=sync_progress,
    )


def _watch_response(watch: models.Watch, coin: Optional[models.Coin]) -> schemas.WatchResponse:
    return schemas.WatchResponse(
        symbol=watch.symbol,
        base_asset=coin.base_asset if coin else None,
        name=coin.name if coin else None,
        logo_url=coin.logo_url if coin else None,
        current_price_btc=coin.current_price_btc if coin else None,
        distance_pct_event=coin.distance_pct_event if coin else None,
        distance_pct_atl=coin.distance_pct_atl if coin else None,
        market_cap=coin.market_cap if coin else None,
        threshold_pct=watch.threshold_pct,
        last_distance=watch.last_distance,
        last_alerted_at=watch.last_alerted_at,
        created_at=watch.created_at,
    )


@app.get("/api/watchlist", response_model=List[schemas.WatchResponse])
def get_watchlist(db: Session = Depends(get_db)):
    watches = db.query(models.Watch).order_by(models.Watch.created_at.desc()).all()
    return [_watch_response(watch, db.get(models.Coin, watch.symbol)) for watch in watches]


@app.post("/api/watchlist/{symbol}", response_model=schemas.WatchResponse, status_code=201)
def add_watch(symbol: str, payload: schemas.WatchCreate, db: Session = Depends(get_db)):
    coin = db.get(models.Coin, symbol)
    if coin is None:
        raise HTTPException(status_code=404, detail="Coin not found")

    watch = db.get(models.Watch, symbol)
    if watch is None:
        watch = models.Watch(symbol=symbol)
        db.add(watch)
    watch.threshold_pct = payload.threshold_pct
    db.commit()
    db.refresh(watch)
    return _watch_response(watch, coin)


@app.delete("/api/watchlist/{symbol}", status_code=204)
def remove_watch(symbol: str, db: Session = Depends(get_db)):
    watch = db.get(models.Watch, symbol)
    if watch is None:
        raise HTTPException(status_code=404, detail="Coin is not watched")
    db.delete(watch)
    db.commit()


@app.post("/api/refresh", status_code=202)
def refresh_data(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    if is_locked(db):
        raise HTTPException(status_code=409, detail="A sync is already in progress")

    # The task opens its own session; the request-scoped session is closed
    # as soon as the response is sent.
    background_tasks.add_task(run_sync_with_lock)
    return {"message": "Refresh started in background"}


@app.get("/health")
def health() -> Optional[dict]:
    return {"status": "ok"}
