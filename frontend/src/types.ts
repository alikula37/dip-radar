export interface Coin {
  symbol: string;
  base_asset?: string | null;
  quote_asset?: string | null;
  name: string | null;
  logo_url: string | null;
  current_price_btc: number | null;
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

export interface Meta {
  last_updated: string | null;
  tracked_coins: number;
  sync_in_progress: boolean;
}
