export interface Coin {
  symbol: string;
  base_asset?: string | null;
  quote_asset?: string | null;
  name: string | null;
  logo_url: string | null;
  listing_date?: string | null;
  is_stable?: boolean;
  current_price_btc: number | null;
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
