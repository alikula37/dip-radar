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
}

export interface BacktestPeriod {
  date: string;
  picks: BacktestPick[];
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
  periods: number;
}

export interface BacktestOptimizeRow {
  rotation: string;
  top_n: number;
  min_score: number;
  fill_with_btc: boolean;
  total_return: number;
  sharpe: number;
  max_drawdown: number;
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
  metrics: BacktestMetrics;
  curve: BacktestPoint[];
  holdings: BacktestPeriod[];
  optimization: BacktestOptimizeRow[] | null;
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
  optimize: boolean;
}
