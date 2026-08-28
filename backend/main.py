from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
import models, schemas
from database import engine, get_db, Base
from metrics import calculate_bubble_sizes
from fetcher import run_all_syncs

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Dip Radar API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/coins", response_model=List[schemas.CoinResponse])
def get_coins(db: Session = Depends(get_db)):
    coins = db.query(models.Coin).filter(models.Coin.is_pre_2021 == True).all()
    calculate_bubble_sizes(coins, use_atl=False)
    calculate_bubble_sizes(coins, use_atl=True)
    return coins

@app.get("/api/coins/{symbol}/history", response_model=List[schemas.KlineResponse])
def get_coin_history(symbol: str, db: Session = Depends(get_db)):
    klines = db.query(models.Kline).filter(models.Kline.symbol == symbol).order_by(models.Kline.timestamp.asc()).all()
    if not klines:
        raise HTTPException(status_code=404, detail="History not found")
    return klines

@app.get("/api/meta", response_model=schemas.MetaResponse)
def get_meta(db: Session = Depends(get_db)):
    meta = db.query(models.Meta).filter(models.Meta.key == "last_updated").first()
    count = db.query(models.Coin).filter(models.Coin.is_pre_2021 == True).count()
    return schemas.MetaResponse(
        last_updated=meta.value if meta else None,
        tracked_coins=count
    )

@app.post("/api/refresh")
def refresh_data(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    background_tasks.add_task(run_all_syncs, db)
    return {"message": "Refresh started in background"}
