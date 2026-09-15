export interface Coin {
  symbol: string;
  base_asset?: string | null;
  quote_asset?: string | null;
  name: string | null;
  logo_url: string | null;
  listing_date?: string | null;
  is_stable?: boolean;
  current_price_btc: number | null;
  current_price_usd?: number | null;
  price_7d_ago_btc?: number | null;
  price_30d_ago_btc?: number | null;
  price_verified?: boolean | null;
  price_deviation_pct?: number | null;
  event_low: number | null;
  all_time_low: number | null;
  distance_pct_event: number | null;
  distance_pct_atl: number | null;
  bubble_size_event: number | null;
  bubble_size_atl: number | null;
  market_cap: number | null;
  volume_24h: number | null;
  valuation_pct_1y?: number | null;
  valuation_pct_3y?: number | null;
  valuation_pct_all?: number | null;
  median_dist_1y?: number | null;
  median_dist_3y?: number | null;
  range_position?: number | null;
  days_since_atl?: number | null;
  basing_pct_90d?: number | null;
  trend_30d_pct?: number | null;
  trend_90d_pct?: number | null;
  above_sma200?: boolean | null;
  history_days?: number | null;
  value_score?: number | null;
  value_parts?: Record<string, number> | null;
}

export interface Kline {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DipHistoryPoint {
  timestamp: string;
  close: number;
  all_time_low: number;
  event_low: number;
  distance_pct_event: number;
  distance_pct_atl: number;
}

export interface SyncProgress {
  phase: "coins" | "klines" | "metadata" | "done" | "error" | string;
  processed: number;
  total: number;
  message?: string;
  updated_at?: string;
}

export interface Meta {
  last_updated: string | null;
  tracked_coins: number;
  delisted_coins?: number;
  sync_in_progress: boolean;
  sync_progress: SyncProgress | null;
  btc_usd_price?: number | null;
}

export interface Watch {
  symbol: string;
  base_asset?: string | null;
  name?: string | null;
  logo_url?: string | null;
  current_price_btc?: number | null;
  distance_pct_event?: number | null;
  distance_pct_atl?: number | null;
  market_cap?: number | null;
  threshold_pct?: number | null;
  last_distance?: number | null;
  last_alerted_at?: string | null;
  created_at?: string | null;
}

export interface BacktestPoint {
  date: string;
  equity: number;
  period_return: number;
  equity_usd: number | null;
  benchmark_usd: number | null;
}

export interface BacktestPick {
  symbol: string;
  score: number;
  weight: number;
  period_return: number;
  exited?: boolean;
  direction?: 'long' | 'short';
}

export interface BacktestPeriod {
  date: string;
  picks: BacktestPick[];
  risk_on?: boolean;
  ic?: number | null;
}

export interface BacktestTrade {
  symbol: string;
  entry_date: string;
  entry_price: number;
  entry_score: number;
  exit_date: string;
  exit_price: number;
  exit_reason: 'take_profit' | 'trailing_stop' | 'stop_loss' | 'score' | 'rebalance' | 'missing' | 'open' | string;
  return_pct: number;
  days: number;
}

export interface BacktestMetrics {
  total_return: number;
  total_return_usd: number | null;
  benchmark_btc_usd_return: number | null;
  cagr: number;
  volatility: number;
  sharpe: number;
  max_drawdown: number;
  calmar: number | null;
  win_rate: number;
  avg_holdings: number;
  avg_turnover: number;
  avg_short_notional: number;
  avg_long_notional: number;
  funding_cost: number;
  positive_ic_share: number | null;
  positive_years: number;
  positive_rolling_share: number;
  time_in_drawdown: number;
  best_period_share: number;
  periods: number;
}

export interface BacktestResponse {
  requested_start: string;
  requested_end: string;
  start: string;
  end: string;
  rebalance: string;
  top_n: number;
  min_score: number;
  min_market_cap: number;
  min_volume: number;
  weighting: string;
  fill_with_btc: boolean;
  fee_pct: number;
  rotation: string;
  sell_score: number | null;
  min_trend_30d: number | null;
  stop_loss_pct: number | null;
  trailing_stop_pct: number | null;
  take_profit_pct: number | null;
  score_model: string;
  regime_filter: string | null;
  regime_min_breadth: number;
  regime_exposure: number;
  equity_trend_exposure: number | null;
  profit_lock_pct: number | null;
  short_n: number;
  short_max_score: number | null;
  short_funding_apr: number;
  short_exposure: number;
  profit_sweep_pct: number;
  max_holding_periods: number | null;
  invert_score: boolean;
  ic_filter: boolean;
  ic_window: number;
  ic_threshold: number;
  ic_exposure: number;
  metrics: BacktestMetrics;
  curve: BacktestPoint[];
  holdings: BacktestPeriod[];
  trades: BacktestTrade[];
}

export interface BacktestForm {
  start: string;
  end: string;
  rebalance: 'weekly' | 'monthly' | 'quarterly';
  topN: number;
  minScore: number;
  minCap: number;
  minVolume: number;
  weighting: 'equal' | 'score' | 'market_cap';
  fillWithBtc: boolean;
  feePct: number;
  rotation: 'rebalance' | 'hold';
  sellScore: number;
  minTrend: number | null;
  stopLoss: number | null;
  trailingStop: number | null;
  takeProfit: number | null;
  scoreModel: 'rule' | 'learned_v1' | 'learned_v2' | 'learned_v3_regime';
  regimeFilter: 'none' | 'alt_trend' | 'breadth';
  regimeMinBreadth: number;
  regimeExposure: number;
  equityTrendExposure: number | null;
  profitLock: number | null;
  shortN: number;
  shortMaxScore: number | null;
  shortFundingApr: number;
  shortExposure: number;
  profitSweep: number;
  maxHolding: number | null;
  invertScore: boolean;
  icFilter: boolean;
  icWindow: number;
  icThreshold: number;
  icExposure: number;
}

export interface OptimizerFold {
  test_start: string;
  test_end: string;
  metrics: BacktestMetrics;
}

export interface OptimizerCvMetrics {
  mean: number;
  min: number;
  per_fold: OptimizerFold[];
}

export interface OptimizerCandidate {
  params: Record<string, string | number | boolean | null>;
  train_metrics: BacktestMetrics;
  cv_metrics: OptimizerCvMetrics | null;
  holdout_metrics: BacktestMetrics | null;
}

export interface OptimizerResponse {
  optimizer: string;
  objective: string;
  trials: number;
  evaluated: number;
  max_drawdown_limit: number | null;
  rebalance: string;
  score_model: string;
  min_market_cap: number;
  min_volume: number;
  fee_pct: number;
  validation_fraction: number;
  cv_folds: number;
  strictness: string;
  train: { start: string; end: string };
  holdout: { start: string; end: string };
  cv: {
    folds: { train: [string, string]; test: [string, string] }[];
    horizon_anchors: number;
    embargo_anchors: number;
    folds_requested: number;
    candidates_scored: number;
  };
  best: OptimizerCandidate[];
  closest: (OptimizerCandidate & { reason: string }) | null;
  validated: number;
  rejected: { count: number; reasons: Record<string, number> };
  gap_fraction: number;
  optimize_params: string[];
  fixed_params: Record<string, string | number | boolean | null>;
  message: string | null;
}

export interface OptimizerRequest {
  start: string;
  end?: string;
  rebalance: string;
  min_market_cap: number;
  min_volume: number;
  fee_pct: number;
  fill_with_btc: boolean;
  score_model: string;
  objective: string;
  trials: number;
  max_drawdown_limit: number | null;
  validation_fraction: number;
  cv_folds: number;
  strictness: string;
  optimize_params: string[];
  fixed_params: Record<string, string | number | boolean | null>;
}
