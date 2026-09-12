import logging
import os
from typing import List, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
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


@app.get("/api/coins", response_model=List[schemas.CoinResponse])
def get_coins(db: Session = Depends(get_db)):
    coins = (
        db.query(models.Coin)
        .filter(models.Coin.is_pre_2021.is_(True))
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
    count = db.query(models.Coin).filter(models.Coin.is_pre_2021.is_(True)).count()
    return schemas.MetaResponse(
        last_updated=last_updated.value if last_updated else None,
        tracked_coins=count,
        sync_in_progress=is_locked(db),
    )


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
