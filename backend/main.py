import json
import logging
import os
import time
from collections import defaultdict, deque
from typing import List, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import schemas
from database import Base, engine, get_db
from fetcher import run_sync_with_lock
from locks import is_locked
from metrics import calculate_bubble_sizes
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


@app.get("/api/coins", response_model=List[schemas.CoinResponse])
def get_coins(db: Session = Depends(get_db)):
    coins = (
        db.query(models.Coin)
        .filter(models.Coin.current_price_btc.isnot(None))
        .order_by(func.coalesce(models.Coin.market_cap, -1).desc())
        .all()
    )
    calculate_bubble_sizes(coins, use_atl=False)
    calculate_bubble_sizes(coins, use_atl=True)
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
