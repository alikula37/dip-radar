import json
import logging
import os
import time
import urllib.request as urllib_request
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
from backtest import BacktestError, build_snapshot, regime_warmup_start, simulate
from database import Base, engine, get_db
from fetcher import EVENT_CUTOFF, run_sync_with_lock
from locks import is_locked
from metrics import calculate_bubble_sizes, calculate_coin_stats, calculate_distance_pct, calculate_value_scores
from migrations import run_migrations
from optimizer import optimize_strategy

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
DEFAULT_RATE_LIMIT = 600


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
            # Behind the bundled Next.js proxy every browser shares the
            # container IP, so prefer the forwarded client address.
            forwarded_for = request.headers.get("x-forwarded-for")
            if forwarded_for:
                client = forwarded_for.split(",")[0].strip() or client
            if not rate_limiter.allow(client, limit):
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests"},
                    headers={"Retry-After": str(RATE_LIMIT_WINDOW_SECONDS)},
                )

    return await call_next(request)


def _meta_value(db: Session, key: str) -> Optional[str]:
    row = db.query(models.Meta).filter(models.Meta.key == key).first()
    return row.value if row else None


def _current_btc_usd(db: Session) -> Optional[float]:
    raw = _meta_value(db, "btc_usd_price")
    try:
        return float(raw) if raw else None
    except ValueError:
        return None


def _btc_usd_at(db: Session, cutoff: datetime) -> Optional[float]:
    return (
        db.query(models.BtcRate.close)
        .filter(models.BtcRate.timestamp <= cutoff)
        .order_by(models.BtcRate.timestamp.desc())
        .limit(1)
        .scalar()
    )


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


VERSION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "VERSION")
_UPDATE_REPO = os.getenv("UPDATE_REPO", "alikula37/dip-radar")
_UPDATE_CHECK = os.getenv("UPDATE_CHECK", "1") != "0"
_UPDATE_CACHE: dict = {"checked_at": None, "latest": None, "url": None}
UPDATE_CACHE_SECONDS = 6 * 3600


def local_version() -> str:
    try:
        with open(VERSION_FILE) as handle:
            return handle.read().strip() or "dev"
    except OSError:
        return "dev"


def _is_newer(latest: str, current: str) -> bool:
    def parts(value: str) -> list:
        cleaned = value.lstrip("v").split("-")[0]
        return [int(piece) for piece in cleaned.split(".") if piece.isdigit()]

    try:
        return parts(latest) > parts(current)
    except ValueError:
        return False


@app.get("/api/version", response_model=schemas.VersionResponse)
def get_version():
    """Report the running version and whether a newer GitHub release exists."""
    current = local_version()
    instructions = "docker compose pull && docker compose up -d --build"
    response = {
        "current": current,
        "latest": None,
        "update_available": None,
        "release_url": None,
        "instructions": instructions,
    }
    if not _UPDATE_CHECK:
        return response

    now = datetime.utcnow()
    checked_at = _UPDATE_CACHE.get("checked_at")
    if checked_at is None or (now - checked_at).total_seconds() > UPDATE_CACHE_SECONDS:
        latest, url = None, None
        try:
            request = urllib_request.Request(
                f"https://api.github.com/repos/{_UPDATE_REPO}/releases/latest",
                headers={"Accept": "application/vnd.github+json", "User-Agent": "dip-radar"},
            )
            with urllib_request.urlopen(request, timeout=5) as payload:
                data = json.loads(payload.read().decode())
                latest = (data.get("tag_name") or "").strip() or None
                url = data.get("html_url")
        except Exception:
            latest, url = None, None
        _UPDATE_CACHE.update({"checked_at": now, "latest": latest, "url": url})

    latest = _UPDATE_CACHE.get("latest")
    response["latest"] = latest
    response["release_url"] = _UPDATE_CACHE.get("url")
    # None = the check could not run (offline / rate limited); the UI stays quiet.
    response["update_available"] = _is_newer(latest, current) if latest else None
    return response


@app.get("/api/score-models", response_model=List[schemas.ScoreModelResponse])
def get_score_models():
    """Score models with their feature importances for the Strategy Lab panel."""
    from score_models import FEATURE_INFO, RULE_FEATURES, available_models, load_model

    models = [
        schemas.ScoreModelResponse(
            version="rule",
            label="Rule-based value score",
            experimental=False,
            features=[
                schemas.ScoreModelFeature(
                    name=feature["name"],
                    label=feature["label"],
                    description=feature["description"],
                    weight=feature["weight"],
                    direction=feature["direction"],
                )
                for feature in RULE_FEATURES
            ],
        )
    ]
    for version in available_models():
        artifact = load_model(version)
        features = artifact.get("features") or [
            {
                "name": name,
                "label": FEATURE_INFO.get(name, {}).get("label", name),
                "description": FEATURE_INFO.get(name, {}).get("description", ""),
                "weight": weight,
                "direction": artifact.get("feature_directions", {}).get(name, 1),
            }
            for name, weight in artifact["weights"].items()
        ]
        models.append(
            schemas.ScoreModelResponse(
                version=version,
                label=f"Learned score ({version})",
                experimental=True,
                trained_until=artifact.get("trained_until"),
                validation=artifact.get("validation"),
                features=[schemas.ScoreModelFeature(**feature) for feature in features],
            )
        )
    return models


@app.get("/api/strategy/signals", response_model=schemas.StrategySignalsResponse)
def get_strategy_signals(
    start: str = Query(..., description="Replay start date (YYYY-MM-DD)"),
    end: Optional[str] = Query(default=None, description="As-of date, defaults to the latest candle"),
    rebalance: str = Query(default="weekly", pattern="^(weekly|monthly|quarterly)$"),
    top_n: int = Query(default=5, ge=1, le=25),
    min_score: float = Query(default=50.0, ge=0, le=100),
    min_market_cap: float = Query(default=10_000_000.0, ge=0),
    max_market_cap: Optional[float] = Query(default=None),
    min_volume: float = Query(default=250_000.0, ge=0),
    weighting: str = Query(default="equal", pattern="^(equal|score|market_cap)$"),
    fill_with_btc: bool = Query(default=True),
    fee_pct: float = Query(default=0.1, ge=0, le=5),
    rotation: str = Query(default="rebalance", pattern="^(rebalance|hold)$"),
    sell_score: Optional[float] = Query(default=None, ge=0, le=100),
    min_trend_30d: Optional[float] = Query(default=None, ge=-100, le=100),
    stop_loss_pct: Optional[float] = Query(default=None, ge=0, le=95),
    trailing_stop_pct: Optional[float] = Query(default=None, ge=0, le=95),
    take_profit_pct: Optional[float] = Query(default=None, ge=0, le=10000),
    regime_filter: Optional[str] = Query(default=None, pattern="^(alt_trend|breadth)$"),
    regime_min_breadth: float = Query(default=0.5, ge=0, le=1),
    regime_exposure: float = Query(default=0.0, ge=0, le=1),
    equity_trend_exposure: Optional[float] = Query(default=None, ge=0, le=1),
    profit_lock_pct: Optional[float] = Query(default=None, ge=0, le=95),
    short_n: int = Query(default=0, ge=0, le=25),
    short_max_score: Optional[float] = Query(default=None, ge=0, le=100),
    short_funding_apr: float = Query(default=0.0, ge=0, le=100),
    short_exposure: float = Query(default=1.0, ge=0, le=1),
    profit_sweep_pct: float = Query(default=0.0, ge=0, le=100),
    max_holding_periods: Optional[int] = Query(default=None, ge=1, le=500),
    invert_score: bool = Query(default=False),
    ic_filter: bool = Query(default=False),
    ic_window: int = Query(default=6, ge=2, le=52),
    ic_threshold: float = Query(default=0.0, ge=-1, le=1),
    ic_exposure: float = Query(default=0.35, ge=0, le=1),
    score_model: str = Query(default="rule"),
    db: Session = Depends(get_db),
):
    """Replay a strategy configuration to the latest anchor and return live signals."""
    import signals as signals_module

    try:
        start_at = datetime.strptime(start, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=422, detail="start must be YYYY-MM-DD")

    if end:
        try:
            end_at = datetime.strptime(end, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="end must be YYYY-MM-DD")
    else:
        latest = db.query(func.max(models.Kline.timestamp)).scalar()
        if latest is None:
            raise HTTPException(status_code=404, detail="No price history yet")
        end_at = latest

    if end_at <= start_at:
        raise HTTPException(status_code=422, detail="end must be after start")

    params = {
        "top_n": top_n,
        "min_score": min_score,
        "min_market_cap": min_market_cap,
        "max_market_cap": max_market_cap,
        "min_volume": min_volume,
        "weighting": weighting,
        "fill_with_btc": fill_with_btc,
        "fee_pct": fee_pct,
        "rotation": rotation,
        "sell_score": sell_score,
        "min_trend_30d": min_trend_30d,
        "stop_loss_pct": stop_loss_pct,
        "trailing_stop_pct": trailing_stop_pct,
        "take_profit_pct": take_profit_pct,
        "regime_filter": regime_filter,
        "regime_min_breadth": regime_min_breadth,
        "regime_exposure": regime_exposure,
        "equity_trend_exposure": equity_trend_exposure,
        "profit_lock_pct": profit_lock_pct,
        "short_n": short_n,
        "short_max_score": short_max_score,
        "short_funding_apr": short_funding_apr,
        "short_exposure": short_exposure,
        "profit_sweep_pct": profit_sweep_pct,
        "max_holding_periods": max_holding_periods,
        "invert_score": invert_score,
        "ic_filter": ic_filter,
        "ic_window": ic_window,
        "ic_threshold": ic_threshold,
        "ic_exposure": ic_exposure,
        "score_model": score_model,
    }
    try:
        return signals_module.strategy_signals(
            db,
            start=start_at,
            end=end_at,
            frequency=rebalance,
            params=params,
        )
    except BacktestError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def _watch_payload(model) -> schemas.StrategyWatchResponse:
    config = json.loads(model.params_json)
    paper_return = None
    if model.start_equity and model.last_equity:
        paper_return = round(model.last_equity / model.start_equity - 1.0, 4)
    return schemas.StrategyWatchResponse(
        id=model.id,
        name=model.name,
        active=model.active,
        start=config["start"],
        end=config.get("end"),
        rebalance=config.get("rebalance", "weekly"),
        score_model=config.get("params", {}).get("score_model", "rule"),
        start_equity=model.start_equity,
        last_equity=model.last_equity,
        paper_return=paper_return,
        last_anchor=model.last_anchor.isoformat() if model.last_anchor else None,
        last_refreshed_at=model.last_refreshed_at.isoformat() if model.last_refreshed_at else None,
    )


@app.get("/api/strategy/watches", response_model=List[schemas.StrategyWatchResponse])
def list_strategy_watches(db: Session = Depends(get_db)):
    """Saved strategy configurations whose signals the worker tracks."""
    watches = (
        db.query(models.StrategyWatch).order_by(models.StrategyWatch.created_at.desc()).all()
    )
    return [_watch_payload(watch) for watch in watches]


@app.post(
    "/api/strategy/watches",
    response_model=schemas.StrategyWatchRefreshResponse,
    status_code=201,
)
def create_strategy_watch(payload: schemas.StrategyWatchRequest, db: Session = Depends(get_db)):
    """Save a strategy configuration and emit its first signal set."""
    import signals as signals_module

    if payload.rebalance not in ("weekly", "monthly", "quarterly"):
        raise HTTPException(status_code=422, detail="rebalance must be weekly, monthly or quarterly")
    try:
        start_at = datetime.strptime(payload.start, "%Y-%m-%d")
        end_at = datetime.strptime(payload.end, "%Y-%m-%d") if payload.end else None
    except ValueError:
        raise HTTPException(status_code=422, detail="dates must be YYYY-MM-DD")
    if end_at is not None and end_at <= start_at:
        raise HTTPException(status_code=422, detail="end must be after start")
    try:
        params = signals_module.normalize_params(payload.params)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    watch = models.StrategyWatch(
        name=payload.name,
        params_json=json.dumps(
            {
                "start": start_at.isoformat(),
                "end": end_at.isoformat() if end_at else None,
                "rebalance": payload.rebalance,
                "params": params,
            }
        ),
    )
    db.add(watch)
    db.commit()
    db.refresh(watch)

    try:
        result = signals_module.refresh_watch(db, watch)
    except (BacktestError, ValueError) as exc:
        db.delete(watch)
        db.commit()
        raise HTTPException(status_code=422, detail=str(exc))

    inserted = (
        db.query(models.StrategySignal)
        .filter(models.StrategySignal.watch_id == watch.id)
        .order_by(models.StrategySignal.id)
        .all()
    )
    return schemas.StrategyWatchRefreshResponse(
        watch=_watch_payload(watch),
        anchors=result["payload"]["state"],
        inserted=[
            schemas.StrategySignalRecord(
                id=row.id,
                date=row.date.isoformat(),
                action=row.action,
                symbol=row.symbol or "",
                reason=row.reason,
                weight=row.weight,
                score=row.score,
                price=row.price,
                equity=row.equity,
                message=row.message,
                return_since=row.return_since,
            )
            for row in inserted
        ],
    )


@app.delete("/api/strategy/watches/{watch_id}", status_code=204)
def delete_strategy_watch(watch_id: int, db: Session = Depends(get_db)):
    watch = db.get(models.StrategyWatch, watch_id)
    if watch is None:
        raise HTTPException(status_code=404, detail="Watch not found")
    db.query(models.StrategySignal).filter(models.StrategySignal.watch_id == watch_id).delete()
    db.delete(watch)
    db.commit()


@app.post("/api/strategy/watches/{watch_id}/refresh", response_model=schemas.StrategyWatchRefreshResponse)
def refresh_strategy_watch(watch_id: int, db: Session = Depends(get_db)):
    """Recompute the watch now and store any new signals."""
    import signals as signals_module

    watch = db.get(models.StrategyWatch, watch_id)
    if watch is None:
        raise HTTPException(status_code=404, detail="Watch not found")
    try:
        result = signals_module.refresh_watch(db, watch)
    except (BacktestError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    rows = []
    if result["inserted"]:
        rows = (
            db.query(models.StrategySignal)
            .filter(models.StrategySignal.watch_id == watch_id)
            .order_by(models.StrategySignal.id.desc())
            .limit(len(result["inserted"]))
            .all()
        )
    return schemas.StrategyWatchRefreshResponse(
        watch=_watch_payload(watch),
        anchors=result["payload"]["state"],
        inserted=[
            schemas.StrategySignalRecord(
                id=row.id,
                date=row.date.isoformat(),
                action=row.action,
                symbol=row.symbol or "",
                reason=row.reason,
                weight=row.weight,
                score=row.score,
                price=row.price,
                equity=row.equity,
                message=row.message,
                return_since=row.return_since,
            )
            for row in reversed(rows)
        ],
    )


@app.get("/api/strategy/watches/{watch_id}/live", response_model=schemas.StrategySignalsResponse)
def get_watch_live_signals(watch_id: int, db: Session = Depends(get_db)):
    """Replay the watch's configuration to the latest anchor without storing anything."""
    import signals as signals_module

    watch = db.get(models.StrategyWatch, watch_id)
    if watch is None:
        raise HTTPException(status_code=404, detail="Watch not found")
    try:
        return signals_module.watch_payload(db, watch)
    except (BacktestError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.get(
    "/api/strategy/watches/{watch_id}/signals",
    response_model=List[schemas.StrategySignalRecord],
)
def get_strategy_watch_signals(
    watch_id: int,
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    watch = db.get(models.StrategyWatch, watch_id)
    if watch is None:
        raise HTTPException(status_code=404, detail="Watch not found")
    rows = (
        db.query(models.StrategySignal)
        .filter(models.StrategySignal.watch_id == watch_id)
        .order_by(models.StrategySignal.date.desc(), models.StrategySignal.id.desc())
        .limit(limit)
        .all()
    )
    return [
        schemas.StrategySignalRecord(
            id=row.id,
            date=row.date.isoformat(),
            action=row.action,
            symbol=row.symbol or "",
            reason=row.reason,
            weight=row.weight,
            score=row.score,
            price=row.price,
            equity=row.equity,
            message=row.message,
            return_since=row.return_since,
        )
        for row in rows
    ]


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
        .filter(models.Coin.delisted_at.is_(None))
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

    btc_usd = _btc_usd_at(db, cutoff) if cutoff is not None else _current_btc_usd(db)
    if btc_usd:
        for coin in coins:
            if coin.current_price_btc:
                coin.current_price_usd = round(coin.current_price_btc * btc_usd, 10)

    calculate_bubble_sizes(coins, use_atl=False)
    calculate_bubble_sizes(coins, use_atl=True)
    calculate_value_scores(coins)
    return coins


@app.get("/api/coins/{symbol}/history", response_model=List[schemas.KlineResponse])
def get_coin_history(
    symbol: str,
    limit: int = Query(default=365, ge=1, le=5000),
    vs: str = Query(default="btc", pattern="^(btc|usd)$"),
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

    ascending = list(reversed(klines))

    if vs == "btc":
        return ascending

    rates = dict(
        db.query(models.BtcRate.timestamp, models.BtcRate.close)
        .order_by(models.BtcRate.timestamp.asc())
        .all()
    )
    if not rates:
        raise HTTPException(status_code=404, detail="USD rates not available yet")

    rate_dates = sorted(rates)
    rate: Optional[float] = None
    index = 0
    converted = []
    for kline in ascending:
        while index < len(rate_dates) and rate_dates[index] <= kline.timestamp:
            rate = rates[rate_dates[index]]
            index += 1
        if rate is None:
            continue
        converted.append(
            schemas.KlineResponse(
                timestamp=kline.timestamp,
                open=kline.open * rate,
                high=kline.high * rate,
                low=kline.low * rate,
                close=kline.close * rate,
                volume=kline.volume * rate,
            )
        )
    return converted


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


@app.get("/api/backtest", response_model=schemas.BacktestResponse)
def run_backtest(
    start: str = Query(..., description="Backtest start date (YYYY-MM-DD)"),
    end: Optional[str] = Query(default=None, description="Backtest end date (YYYY-MM-DD), defaults to the latest candle"),
    rebalance: str = Query(default="monthly", pattern="^(weekly|monthly|quarterly)$"),
    top_n: int = Query(default=5, ge=1, le=25),
    min_score: float = Query(default=50.0, ge=0, le=100),
    min_market_cap: float = Query(default=10_000_000.0, ge=0),
    max_market_cap: Optional[float] = Query(default=None),
    min_volume: float = Query(default=250_000.0, ge=0),
    weighting: str = Query(default="equal", pattern="^(equal|score|market_cap)$"),
    fill_with_btc: bool = Query(default=True),
    fee_pct: float = Query(default=0.1, ge=0, le=5),
    rotation: str = Query(default="rebalance", pattern="^(rebalance|hold)$", description="rebalance = reset to top-N each period, hold = keep until the score drops"),
    sell_score: Optional[float] = Query(default=None, ge=0, le=100, description="Exit threshold for rotation=hold (default: min_score)"),
    min_trend_30d: Optional[float] = Query(default=None, ge=-100, le=100, description="Only buy coins whose 30d trend is at least this (avoids free-falls)"),
    stop_loss_pct: Optional[float] = Query(default=None, ge=0, le=95, description="Sell when the price drops this much below entry (checked daily)"),
    trailing_stop_pct: Optional[float] = Query(default=None, ge=0, le=95, description="Sell when the price drops this much from its peak since entry"),
    take_profit_pct: Optional[float] = Query(default=None, ge=0, le=10000, description="Sell when the price rises this much above entry"),
    regime_filter: Optional[str] = Query(default=None, pattern="^(alt_trend|breadth)$", description="Sit in BTC when altcoin dominance/breadth is deteriorating"),
    regime_min_breadth: float = Query(default=0.5, ge=0, le=1, description="Minimum share of coins above their 200d SMA for regime_filter=breadth"),
    regime_exposure: float = Query(default=0.0, ge=0, le=1, description="Exposure kept while risk-off (0 = move fully to BTC)"),
    equity_trend_exposure: Optional[float] = Query(default=None, ge=0, le=1, description="Shrink exposure while the strategy's own equity is below its moving average"),
    profit_lock_pct: Optional[float] = Query(default=None, ge=0, le=95, description="Move this share of the book to BTC every time equity doubles"),
    short_n: int = Query(default=0, ge=0, le=25, description="Number of most-expensive coins to short each period (market-neutral sleeve)"),
    short_max_score: Optional[float] = Query(default=None, ge=0, le=100, description="Only short coins whose score is at most this value"),
    short_funding_apr: float = Query(default=0.0, ge=0, le=100, description="Annual funding cost charged on the short notional"),
    short_exposure: float = Query(default=1.0, ge=0, le=1, description="Short book size relative to the long book (1 = dollar neutral)"),
    profit_sweep_pct: float = Query(default=0.0, ge=0, le=100, description="Share of a position's BTC profit harvested back to BTC each rebalance"),
    max_holding_periods: Optional[int] = Query(default=None, ge=1, le=500, description="Force positions back to BTC after this many rebalances"),
    invert_score: bool = Query(default=False, description="Flip the factor: long the most expensive coins and short the cheapest (momentum side)"),
    ic_filter: bool = Query(default=False, description="Measure the score's own rolling information coefficient and shrink exposure when it is weak"),
    ic_window: int = Query(default=6, ge=2, le=52, description="Anchors in the rolling IC window"),
    ic_threshold: float = Query(default=0.0, ge=-1, le=1, description="Rolling IC below this means risk-off"),
    ic_exposure: float = Query(default=0.35, ge=0, le=1, description="Exposure kept while the factor IC is weak"),
    score_model: str = Query(default="rule", description="Score to rank coins: rule (default) or a learned artifact version"),
    db: Session = Depends(get_db),
):
    """Replays the Value Score at historical rebalance dates and simulates the portfolio."""
    try:
        start_at = datetime.strptime(start, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=422, detail="start must be YYYY-MM-DD")

    if end:
        try:
            end_at = datetime.strptime(end, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="end must be YYYY-MM-DD")
    else:
        latest = db.query(func.max(models.Kline.timestamp)).scalar()
        if latest is None:
            raise HTTPException(status_code=404, detail="No price history yet")
        end_at = latest

    if end_at <= start_at:
        raise HTTPException(status_code=422, detail="end must be after start")

    params = {
        "top_n": top_n,
        "min_score": min_score,
        "min_market_cap": min_market_cap,
        "max_market_cap": max_market_cap,
        "min_volume": min_volume,
        "weighting": weighting,
        "fill_with_btc": fill_with_btc,
        "fee_pct": fee_pct,
        "rotation": rotation,
        "sell_score": sell_score,
        "min_trend_30d": min_trend_30d,
        "stop_loss_pct": stop_loss_pct,
        "trailing_stop_pct": trailing_stop_pct,
        "take_profit_pct": take_profit_pct,
        "regime_filter": regime_filter,
        "regime_min_breadth": regime_min_breadth,
        "regime_exposure": regime_exposure,
        "equity_trend_exposure": equity_trend_exposure,
        "profit_lock_pct": profit_lock_pct,
        "short_n": short_n,
        "short_max_score": short_max_score,
        "short_funding_apr": short_funding_apr,
        "short_exposure": short_exposure,
        "profit_sweep_pct": profit_sweep_pct,
        "max_holding_periods": max_holding_periods,
        "invert_score": invert_score,
        "ic_filter": ic_filter,
        "ic_window": ic_window,
        "ic_threshold": ic_threshold,
        "ic_exposure": ic_exposure,
    }

    try:
        snapshot = build_snapshot(
            db,
            rebalance,
            end_at,
            score_model=score_model,
            earliest=regime_warmup_start(start_at, rebalance),
        )
        outcome = simulate(snapshot, start=start_at, end=end_at, **params)
    except BacktestError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {
        "requested_start": start,
        "requested_end": end_at.date().isoformat(),
        "rebalance": rebalance,
        "score_model": score_model,
        **params,
        **outcome,
    }


@app.post("/api/backtest/optimize", response_model=schemas.OptimizerResponse)
def optimize_backtest(payload: schemas.OptimizerRequest, db: Session = Depends(get_db)):
    """Search strategy parameters with nested validation (search/CV/holdout)."""
    try:
        start_at = datetime.strptime(payload.start, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=422, detail="start must be YYYY-MM-DD")

    if payload.end:
        try:
            end_at = datetime.strptime(payload.end, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="end must be YYYY-MM-DD")
    else:
        latest = db.query(func.max(models.Kline.timestamp)).scalar()
        if latest is None:
            raise HTTPException(status_code=404, detail="No price history yet")
        end_at = latest

    if end_at <= start_at:
        raise HTTPException(status_code=422, detail="end must be after start")

    try:
        snapshot = build_snapshot(
            db,
            payload.rebalance,
            end_at,
            score_model=payload.score_model,
            earliest=regime_warmup_start(start_at, payload.rebalance),
        )
        result = optimize_strategy(
            snapshot,
            start=start_at,
            end=end_at,
            min_market_cap=payload.min_market_cap,
            max_market_cap=payload.max_market_cap,
            min_volume=payload.min_volume,
            fee_pct=payload.fee_pct,
            fill_with_btc=payload.fill_with_btc,
            objective=payload.objective,
            trials=payload.trials,
            max_drawdown_limit=payload.max_drawdown_limit,
            validation_fraction=payload.validation_fraction,
            cv_folds=payload.cv_folds,
            strictness=payload.strictness,
            optimize_params=payload.optimize_params,
            fixed_params=payload.fixed_params,
            seed=7,
        )
    except BacktestError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {
        **result,
        "rebalance": payload.rebalance,
        "score_model": payload.score_model,
        "min_market_cap": payload.min_market_cap,
        "max_market_cap": payload.max_market_cap,
        "min_volume": payload.min_volume,
        "fee_pct": payload.fee_pct,
        "validation_fraction": payload.validation_fraction,
        "cv_folds": payload.cv_folds,
        "strictness": payload.strictness,
    }


@app.get("/api/meta", response_model=schemas.MetaResponse)
def get_meta(db: Session = Depends(get_db)):
    last_updated = db.query(models.Meta).filter(models.Meta.key == "last_updated").first()
    progress = db.query(models.Meta).filter(models.Meta.key == "sync_progress").first()
    count = (
        db.query(models.Coin)
        .filter(models.Coin.current_price_btc.isnot(None), models.Coin.delisted_at.is_(None))
        .count()
    )
    delisted = db.query(models.Coin).filter(models.Coin.delisted_at.isnot(None)).count()

    sync_progress = None
    if progress and progress.value:
        try:
            sync_progress = json.loads(progress.value)
        except ValueError:
            sync_progress = None

    return schemas.MetaResponse(
        last_updated=last_updated.value if last_updated else None,
        tracked_coins=count,
        delisted_coins=delisted,
        sync_in_progress=is_locked(db),
        sync_progress=sync_progress,
        btc_usd_price=_current_btc_usd(db),
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
