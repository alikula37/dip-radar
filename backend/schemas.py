from datetime import datetime
from typing import List, Optional

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
    current_price_usd: Optional[float] = None
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
    delisted_coins: int = 0
    sync_in_progress: bool = False
    sync_progress: Optional[dict] = None
    btc_usd_price: Optional[float] = None


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


class BacktestPoint(BaseModel):
    date: datetime
    equity: float
    period_return: float
    equity_usd: Optional[float] = None
    benchmark_usd: Optional[float] = None


class BacktestPick(BaseModel):
    symbol: str
    score: float
    weight: float
    period_return: float
    exited: bool = False
    direction: str = "long"


class BacktestPeriod(BaseModel):
    date: datetime
    picks: List[BacktestPick]
    risk_on: bool = True


class BacktestTrade(BaseModel):
    symbol: str
    entry_date: str
    entry_price: float
    entry_score: float
    exit_date: str
    exit_price: float
    exit_reason: str
    return_pct: float
    days: int


class BacktestMetrics(BaseModel):
    total_return: float
    total_return_usd: Optional[float] = None
    benchmark_btc_usd_return: Optional[float] = None
    cagr: float
    volatility: float
    sharpe: float
    max_drawdown: float
    calmar: Optional[float] = None
    win_rate: float
    avg_holdings: float
    avg_turnover: float
    avg_short_notional: float = 0.0
    avg_long_notional: float = 0.0
    funding_cost: float = 0.0
    positive_years: float = 0.0
    positive_rolling_share: float = 0.0
    time_in_drawdown: float = 0.0
    best_period_share: float = 0.0
    periods: int


class OptimizerRequest(BaseModel):
    start: str
    end: Optional[str] = None
    rebalance: str = "weekly"
    min_market_cap: float = 10_000_000.0
    min_volume: float = 250_000.0
    fee_pct: float = 0.1
    fill_with_btc: bool = True
    score_model: str = "rule"
    objective: str = "sharpe"
    trials: int = 200
    max_drawdown_limit: Optional[float] = None
    validation_fraction: float = 0.3
    cv_folds: int = 3
    strictness: str = "strict"
    optimize_params: Optional[List[str]] = None
    fixed_params: Optional[dict] = None


class OptimizerCandidate(BaseModel):
    params: dict
    train_metrics: BacktestMetrics
    cv_metrics: Optional[dict] = None
    holdout_metrics: Optional[BacktestMetrics] = None


class OptimizerResponse(BaseModel):
    optimizer: str
    objective: str
    trials: int
    evaluated: int
    max_drawdown_limit: Optional[float] = None
    rebalance: str
    score_model: str
    min_market_cap: float
    min_volume: float
    fee_pct: float
    validation_fraction: float
    cv_folds: int = 3
    strictness: str = "strict"
    train: dict
    holdout: dict
    cv: dict
    best: List[OptimizerCandidate]
    closest: Optional[dict] = None
    validated: int
    rejected: dict
    gap_fraction: float
    optimize_params: List[str]
    fixed_params: dict
    message: Optional[str] = None


class BacktestResponse(BaseModel):
    requested_start: str
    requested_end: str
    start: str
    end: str
    rebalance: str
    score_model: str = "rule"
    top_n: int
    min_score: float
    min_market_cap: float
    min_volume: float
    weighting: str
    fill_with_btc: bool
    fee_pct: float
    rotation: str
    sell_score: Optional[float] = None
    min_trend_30d: Optional[float] = None
    stop_loss_pct: Optional[float] = None
    trailing_stop_pct: Optional[float] = None
    take_profit_pct: Optional[float] = None
    regime_filter: Optional[str] = None
    regime_min_breadth: float = 0.5
    regime_exposure: float = 0.0
    equity_trend_exposure: Optional[float] = None
    profit_lock_pct: Optional[float] = None
    short_n: int = 0
    short_max_score: Optional[float] = None
    short_funding_apr: float = 0.0
    short_exposure: float = 1.0
    profit_sweep_pct: float = 0.0
    max_holding_periods: Optional[int] = None
    invert_score: bool = False
    metrics: BacktestMetrics
    curve: List[BacktestPoint]
    holdings: List[BacktestPeriod]
    trades: List[BacktestTrade]
