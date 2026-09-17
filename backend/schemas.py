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
    dip_touches: Optional[int] = None
    dip_bounces: Optional[int] = None
    dip_bounce_avg: Optional[float] = None
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


class StrategySignalPosition(BaseModel):
    symbol: str
    direction: str
    score: Optional[float] = None
    weight: Optional[float] = None
    entry_date: Optional[str] = None
    entry_price: Optional[float] = None
    price_now: Optional[float] = None
    pnl_pct: Optional[float] = None
    peak: Optional[float] = None
    sweep: Optional[float] = None
    periods_held: Optional[int] = None
    stop_price: Optional[float] = None
    trailing_stop_price: Optional[float] = None
    take_profit_price: Optional[float] = None
    action: str = "HOLD"
    reason: Optional[str] = None
    trigger_date: Optional[str] = None
    trigger_price: Optional[float] = None


class StrategySignalCandidate(BaseModel):
    symbol: str
    score: float
    direction: str = "long"


class StrategySignalsState(BaseModel):
    equity: float
    long_notional: float
    short_notional: float
    in_btc: Optional[str] = None
    tracked: List[str] = []
    risk_on: bool = True
    ic_risk_on: bool = True
    rolling_ic: Optional[float] = None
    equity_brake: bool = False


class StrategySignalsResponse(BaseModel):
    as_of: str
    anchor: str
    next_anchor: str
    rebalance: str
    start: str
    score_model: str = "rule"
    state: StrategySignalsState
    positions: List[StrategySignalPosition]
    candidates: List[StrategySignalCandidate]
    message: str


class StrategyWatchRequest(BaseModel):
    name: str
    start: str
    end: Optional[str] = None
    rebalance: str = "weekly"
    params: dict = {}


class StrategyWatchResponse(BaseModel):
    id: int
    name: str
    active: bool
    start: str
    end: Optional[str] = None
    rebalance: str
    score_model: str = "rule"
    start_equity: Optional[float] = None
    last_equity: Optional[float] = None
    paper_return: Optional[float] = None
    last_anchor: Optional[str] = None
    last_refreshed_at: Optional[str] = None


class StrategySignalRecord(BaseModel):
    id: int
    date: str
    action: str
    symbol: str = ""
    reason: Optional[str] = None
    weight: Optional[float] = None
    score: Optional[float] = None
    price: Optional[float] = None
    equity: Optional[float] = None
    message: Optional[str] = None
    return_since: Optional[float] = None


class StrategyWatchRefreshResponse(BaseModel):
    watch: StrategyWatchResponse
    anchors: dict
    inserted: List[StrategySignalRecord]


class ScoreModelFeature(BaseModel):
    name: str
    label: str
    description: str = ""
    weight: float
    direction: int = 1


class ScoreModelResponse(BaseModel):
    version: str
    label: str
    experimental: bool = False
    trained_until: Optional[str] = None
    validation: Optional[dict] = None
    features: List[ScoreModelFeature]


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
    ic: Optional[float] = None
    in_btc: Optional[str] = None


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
    positive_ic_share: Optional[float] = None
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
    max_market_cap: Optional[float] = None
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
    passed: bool = False
    reason: Optional[str] = None


class OptimizerResponse(BaseModel):
    optimizer: str
    objective: str
    trials: int
    evaluated: int
    max_drawdown_limit: Optional[float] = None
    rebalance: str
    score_model: str
    min_market_cap: float
    max_market_cap: Optional[float] = None
    min_volume: float
    fee_pct: float
    validation_fraction: float
    cv_folds: int = 3
    strictness: str = "strict"
    train: dict
    holdout: dict
    cv: dict
    best: List[OptimizerCandidate]
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
    max_market_cap: Optional[float] = None
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
    ic_filter: bool = False
    ic_window: int = 6
    ic_threshold: float = 0.0
    ic_exposure: float = 0.35
    metrics: BacktestMetrics
    curve: List[BacktestPoint]
    holdings: List[BacktestPeriod]
    trades: List[BacktestTrade]
