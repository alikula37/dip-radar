"""Point-in-time feature store keyed by rebalance date.

One row per (rebalance anchor, symbol) with only information that was
available at that anchor:

- Value Score components and point-in-time extras from ``build_snapshot``
  (which never reads candles after the anchor),
- market cap / volume from ``market_history`` (the last known day at or before
  the anchor, when the ingestion has run),
- BTC regime features from ``btc_rates``.

Today's liquidity snapshot is kept in explicitly named ``cap_current`` /
``volume_current`` columns so it can never be mistaken for a feature.

Usage (from backend/):

    python -m research.feature_store --frequency monthly
    python -m research.feature_store --frequency monthly --save research/artifacts/features_monthly.jsonl
"""

import argparse
import json
import os
from bisect import bisect_right
from datetime import timedelta

from research import common

FEATURE_COLUMNS = (
    "score",
    "distance",
    "trend_30d",
    "trend_90d",
    "above_sma200",
    "valuation_pct_1y",
    "valuation_pct_3y",
    "valuation_pct_all",
    "median_dist_1y",
    "median_dist_3y",
    "range_position",
    "basing_pct_90d",
    "days_since_atl",
    "history_days",
    "volatility_30d",
    "volatility_90d",
    "drawdown_from_ath",
    "days_since_ath",
    "dollar_volume_30d",
)

PIT_LIQUIDITY_COLUMNS = ("market_cap_pit", "volume_pit")

BTC_REGIME_COLUMNS = ("btc_return_30d", "btc_return_90d", "btc_above_sma200")


def market_history_index(session) -> dict:
    """Per symbol: parallel lists of dates / market caps / volumes."""
    from models import MarketHistory

    rows = (
        session.query(
            MarketHistory.symbol,
            MarketHistory.timestamp,
            MarketHistory.market_cap,
            MarketHistory.volume_24h,
        )
        .order_by(MarketHistory.symbol, MarketHistory.timestamp)
        .all()
    )
    series = {}
    for symbol, timestamp, market_cap, volume in rows:
        entry = series.setdefault(symbol, ([], [], []))
        entry[0].append(timestamp)
        entry[1].append(market_cap)
        entry[2].append(volume)
    return series


def _pit_value(series, anchor):
    if not series:
        return None, None
    index = bisect_right(series[0], anchor) - 1
    if index < 0:
        return None, None
    return series[1][index], series[2][index]


def btc_features(rates: dict, rate_dates: list, anchor) -> dict:
    """Market-wide regime features as of the anchor (no future rates)."""
    if not rate_dates:
        return dict.fromkeys(BTC_REGIME_COLUMNS)
    index = bisect_right(rate_dates, anchor) - 1
    if index < 0:
        return dict.fromkeys(BTC_REGIME_COLUMNS)

    current = rates[rate_dates[index]]

    def return_over(days):
        target = bisect_right(rate_dates, anchor - timedelta(days=days)) - 1
        if target < 0:
            return None
        past = rates[rate_dates[target]]
        return (current / past - 1.0) if past else None

    window = rate_dates[max(0, index - 199) : index + 1]
    average = sum(rates[moment] for moment in window) / len(window)
    return {
        "btc_return_30d": return_over(30),
        "btc_return_90d": return_over(90),
        "btc_above_sma200": current > average if average else None,
    }


def build_feature_rows(session, frequency: str, end=None, use_cache: bool = True) -> list:
    from backtest import build_snapshot

    if end is None:
        end = common.latest_candle(session)
    snapshot = build_snapshot(session, frequency, end, use_cache=use_cache)
    market = market_history_index(session)
    rates = snapshot["rates"]
    rate_dates = snapshot["rate_dates"]

    rows = []
    for date in snapshot["dates"]:
        regime = btc_features(rates, rate_dates, date)
        for symbol, entry in snapshot["entries"][date].items():
            market_cap_pit, volume_pit = _pit_value(market.get(symbol), date)
            row = {
                "date": date.date().isoformat(),
                "symbol": symbol,
                "cap_current": entry["cap"],
                "volume_current": entry["volume"],
                "market_cap_pit": market_cap_pit,
                "volume_pit": volume_pit,
            }
            for column in FEATURE_COLUMNS:
                row[column] = entry.get(column)
            row.update(regime)
            rows.append(row)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frequency", default="monthly", choices=["weekly", "monthly", "quarterly"])
    parser.add_argument("--save", default=None, help="Write rows as JSONL to this path")
    args = parser.parse_args()

    session = common.db_session()
    try:
        rows = build_feature_rows(session, args.frequency)
    finally:
        session.close()

    dates = sorted({row["date"] for row in rows})
    symbols = {row["symbol"] for row in rows}
    covered = sum(1 for row in rows if row["market_cap_pit"] is not None)
    print(
        f"{args.frequency}: {len(rows)} rows · {len(dates)} anchors ({dates[0]} → {dates[-1]}) · "
        f"{len(symbols)} symbols · point-in-time liquidity coverage {covered / len(rows) * 100:.0f}%"
    )

    if args.save:
        path = os.path.abspath(args.save)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as handle:
            for row in rows:
                handle.write(json.dumps(row, sort_keys=True) + "\n")
        print(f"saved {path}")


if __name__ == "__main__":
    main()
