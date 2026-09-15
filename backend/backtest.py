"""Point-in-time strategy backtesting for the Value Score.

The snapshot builder replays the valuation metrics at fixed rebalance
anchors (using only candles up to each anchor), then the simulator applies
cheap, cache-friendly portfolio rules on top. This split means tuning
top-N / thresholds / fees is instant after the first snapshot build.
"""

import bisect
import logging
import math
import statistics
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from metrics import calculate_coin_stats, calculate_value_scores
from models import BtcRate, Coin, Kline

logger = logging.getLogger(__name__)

FREQUENCY_DAYS = {"weekly": 7, "monthly": 30, "quarterly": 91}
WARMUP_CANDLES = 400  # matches the 3y valuation percentile requirement
MAX_SNAPSHOT_CACHE = 4

_SNAPSHOT_CACHE: dict = {}

STATS_FIELDS = (
    "valuation_pct_1y",
    "valuation_pct_3y",
    "valuation_pct_all",
    "median_dist_1y",
    "median_dist_3y",
    "range_position",
    "days_since_atl",
    "basing_pct_90d",
    "trend_30d_pct",
    "trend_90d_pct",
    "above_sma200",
    "history_days",
)


class BacktestError(ValueError):
    pass


class _SnapshotCoin:
    """Lightweight stand-in so calculate_value_scores can rank a cross-section."""

    __slots__ = ("symbol", "is_stable", "market_cap", "volume_24h", "distance_pct_event", *STATS_FIELDS, "value_score", "value_parts")

    def __init__(self, symbol: str, market_cap: Optional[float], volume_24h: Optional[float]):
        self.symbol = symbol
        self.is_stable = False
        self.market_cap = market_cap
        self.volume_24h = volume_24h
        self.distance_pct_event = None
        self.value_score = None
        self.value_parts = None
        for field in STATS_FIELDS:
            setattr(self, field, None)


def clear_snapshot_cache() -> None:
    _SNAPSHOT_CACHE.clear()


def _advance(cursor: datetime, frequency: str) -> datetime:
    if frequency == "weekly":
        return cursor + timedelta(days=7)
    months = 3 if frequency == "quarterly" else 1
    month = cursor.month - 1 + months
    year = cursor.year + month // 12
    return datetime(year, month % 12 + 1, 1)


def _anchor_dates(start: datetime, end: datetime, frequency: str) -> list:
    if frequency == "weekly":
        cursor = start - timedelta(days=start.weekday())
    else:
        cursor = datetime(start.year, start.month, 1)
    dates = []
    while cursor <= end:
        if cursor >= start:
            dates.append(cursor)
        cursor = _advance(cursor, frequency)
    return dates


def _btc_usd_series(db: DBSession, end: datetime) -> dict:
    rows = (
        db.query(BtcRate.timestamp, BtcRate.close)
        .filter(BtcRate.timestamp <= end)
        .order_by(BtcRate.timestamp.asc())
        .all()
    )
    return {timestamp: close for timestamp, close in rows}


def _rate_at(rates: dict, rate_dates: list, when: datetime) -> Optional[float]:
    if not rate_dates:
        return None
    index = bisect.bisect_right(rate_dates, when) - 1
    if index < 0:
        index = 0
    return rates[rate_dates[index]]


def build_snapshot(db: DBSession, frequency: str, end: datetime, use_cache: bool = True) -> dict:
    if frequency not in FREQUENCY_DAYS:
        raise BacktestError("rebalance must be weekly, monthly or quarterly")

    key = (frequency, end.date().isoformat())
    if use_cache and key in _SNAPSHOT_CACHE:
        return _SNAPSHOT_CACHE[key]

    coins = (
        db.query(Coin)
        .filter(Coin.is_stable.is_(False), Coin.market_cap.isnot(None))
        .all()
    )
    universe = {coin.symbol: coin for coin in coins}
    if not universe:
        raise BacktestError("No eligible coins for a backtest")

    rows = db.execute(
        select(Kline.symbol, Kline.timestamp, Kline.close, Kline.low)
        .where(Kline.symbol.in_(list(universe)), Kline.timestamp <= end)
        .order_by(Kline.symbol, Kline.timestamp)
    ).all()
    if not rows:
        raise BacktestError("No candle history for a backtest")

    series = defaultdict(lambda: ([], [], []))
    for symbol, timestamp, close, low in rows:
        entry = series[symbol]
        entry[0].append(timestamp)
        entry[1].append(close)
        entry[2].append(low)

    first_date = min(entry[0][0] for entry in series.values() if entry[0])
    anchor_start = first_date + timedelta(days=WARMUP_CANDLES)
    dates = _anchor_dates(anchor_start, end, frequency)
    if len(dates) < 2:
        raise BacktestError("Not enough history for this frequency")

    prepared = {}
    for symbol, (timestamps, closes, lows) in series.items():
        if len(timestamps) < WARMUP_CANDLES:
            continue
        size = len(timestamps)
        all_min = [0.0] * size
        event_min = [0.0] * size
        min_close = [0.0] * size
        max_close = [0.0] * size
        atl_index = [-1] * size

        running_all = math.inf
        running_event = math.inf
        running_arg = -1
        running_min_close = math.inf
        running_max_close = -math.inf
        for index in range(size):
            low = lows[index]
            close = closes[index]
            if low < running_all:
                running_all = low
                running_arg = index
            if timestamps[index] >= datetime(2021, 1, 1) and low < running_event:
                running_event = low
            running_min_close = min(running_min_close, close)
            running_max_close = max(running_max_close, close)
            all_min[index] = running_all
            event_min[index] = running_event if running_event < math.inf else running_all
            atl_index[index] = running_arg
            min_close[index] = running_min_close
            max_close[index] = running_max_close

        prepared[symbol] = {
            "timestamps": timestamps,
            "closes": closes,
            "all_min": all_min,
            "event_min": event_min,
            "atl_index": atl_index,
            "min_close": min_close,
            "max_close": max_close,
        }

    rates = _btc_usd_series(db, end)
    rate_dates = sorted(rates)

    entries_by_date = {}
    snapshot_dates = []
    for date in dates:
        snapshot_coins = []
        prices = {}
        for symbol, data in prepared.items():
            index = bisect.bisect_right(data["timestamps"], date) - 1
            if index < WARMUP_CANDLES - 1:
                continue

            closes = data["closes"]
            price = closes[index]
            stats = calculate_coin_stats(closes[: index + 1], data["all_min"][: index + 1])
            if stats["valuation_pct_3y"] is None:
                continue

            coin = universe[symbol]
            snapshot_coin = _SnapshotCoin(symbol, coin.market_cap, coin.volume_24h)
            for field in STATS_FIELDS:
                setattr(snapshot_coin, field, stats[field])
            event_low = data["event_min"][index] or data["all_min"][index]
            if event_low:
                snapshot_coin.distance_pct_event = (price - event_low) / event_low * 100
            snapshot_coins.append(snapshot_coin)
            prices[symbol] = price

        # First pass matches the dashboard universe so the historical scores
        # agree with /api/coins; coins below the default liquidity gates get
        # a fallback score from a gate-free cross-section.
        calculate_value_scores(snapshot_coins)
        official_scores = {coin.symbol: coin.value_score for coin in snapshot_coins}
        calculate_value_scores(snapshot_coins, min_cap=0, min_volume=0)

        entries = {}
        for snapshot_coin in snapshot_coins:
            score = official_scores.get(snapshot_coin.symbol)
            if score is None:
                score = snapshot_coin.value_score
            if score is None:
                continue
            entries[snapshot_coin.symbol] = {
                "score": score,
                "distance": snapshot_coin.distance_pct_event,
                "price": prices[snapshot_coin.symbol],
                "cap": snapshot_coin.market_cap,
                "volume": snapshot_coin.volume_24h,
            }
        entries_by_date[date] = entries
        snapshot_dates.append(date)

    if sum(1 for entries in entries_by_date.values() if entries) < 2:
        raise BacktestError("Not enough scored history for a backtest")

    snapshot = {
        "frequency": frequency,
        "end": end,
        "dates": snapshot_dates,
        "entries": entries_by_date,
        "rates": rates,
        "rate_dates": rate_dates,
    }

    if use_cache:
        _SNAPSHOT_CACHE[key] = snapshot
        if len(_SNAPSHOT_CACHE) > MAX_SNAPSHOT_CACHE:
            oldest = next(iter(_SNAPSHOT_CACHE))
            _SNAPSHOT_CACHE.pop(oldest, None)

    return snapshot


def _weights_for(picks: list, weighting: str) -> dict:
    if not picks:
        return {}
    if weighting == "score":
        total = sum(entry["score"] for _, entry in picks) or 1.0
        return {symbol: entry["score"] / total for symbol, entry in picks}
    if weighting == "market_cap":
        total = sum((entry["cap"] or 0.0) for _, entry in picks)
        if total <= 0:
            return {symbol: 1.0 / len(picks) for symbol, _ in picks}
        return {symbol: (entry["cap"] or 0.0) / total for symbol, entry in picks}
    return {symbol: 1.0 / len(picks) for symbol, _ in picks}


def simulate(
    snapshot: dict,
    *,
    start: datetime,
    end: datetime,
    top_n: int = 5,
    min_score: float = 50.0,
    min_market_cap: float = 10_000_000.0,
    min_volume: float = 250_000.0,
    weighting: str = "equal",
    fill_with_btc: bool = True,
    fee_pct: float = 0.1,
    rotation: str = "rebalance",
    sell_score: Optional[float] = None,
) -> dict:
    """Walk the rebalance anchors and compound the portfolio.

    ``rotation="rebalance"`` resets the book to the top-N cheapest coins at
    every anchor. ``rotation="hold"`` buys as before but only sells a
    position once its score falls below ``sell_score`` (default: the buy
    threshold), so coins are held while they stay cheap and rotated out when
    the cheapness is gone.
    """
    if rotation not in ("rebalance", "hold"):
        raise BacktestError("rotation must be rebalance or hold")
    exit_score = min_score if sell_score is None else sell_score

    dates = [date for date in snapshot["dates"] if start <= date <= end]
    if len(dates) < 2:
        raise BacktestError("The selected window has fewer than two rebalance dates")

    entries_by_date = snapshot["entries"]
    rates = snapshot["rates"]
    rate_dates = snapshot["rate_dates"]

    equity = 1.0
    previous_weights: dict = {}
    curve = [{"date": dates[0], "equity": 1.0, "period_return": 0.0}]
    holdings = []
    period_returns = []
    turnovers = []

    for index in range(len(dates) - 1):
        date = dates[index]
        next_date = dates[index + 1]
        pool = entries_by_date.get(date, {})
        next_pool = entries_by_date.get(next_date, {})

        candidates = [
            (symbol, entry)
            for symbol, entry in pool.items()
            if entry["score"] >= min_score
            and (entry["cap"] or 0.0) >= min_market_cap
            and (entry["volume"] or 0.0) >= min_volume
        ]
        candidates.sort(
            key=lambda item: (
                -item[1]["score"],
                item[1]["distance"] if item[1]["distance"] is not None else math.inf,
            )
        )
        if rotation == "hold" and previous_weights:
            picks = []
            held_symbols = set()
            for symbol in previous_weights:
                entry = pool.get(symbol)
                if entry is not None and entry["score"] >= exit_score:
                    picks.append((symbol, entry))
                    held_symbols.add(symbol)
            free_slots = top_n - len(picks)
            for symbol, entry in candidates:
                if free_slots <= 0:
                    break
                if symbol in held_symbols:
                    continue
                picks.append((symbol, entry))
                held_symbols.add(symbol)
                free_slots -= 1
            picks.sort(key=lambda item: -item[1]["score"])
        else:
            picks = candidates[:top_n]

        weights = _weights_for(picks, weighting)
        if fill_with_btc and picks:
            scale = len(picks) / top_n
            weights = {symbol: weight * scale for symbol, weight in weights.items()}

        period_return = 0.0
        pick_rows = []
        for symbol, entry in picks:
            weight = weights.get(symbol, 0.0)
            price_now = entry["price"]
            price_next = next_pool.get(symbol, {}).get("price", price_now)
            coin_return = (price_next / price_now - 1.0) if price_now else 0.0
            period_return += weight * coin_return
            pick_rows.append(
                {
                    "symbol": symbol,
                    "score": entry["score"],
                    "weight": weight,
                    "period_return": coin_return,
                }
            )

        all_symbols = set(weights) | set(previous_weights)
        traded_notional = sum(abs(weights.get(symbol, 0.0) - previous_weights.get(symbol, 0.0)) for symbol in all_symbols)
        turnover = traded_notional / 2
        fee = traded_notional * fee_pct / 100.0
        period_return -= fee
        equity *= 1.0 + period_return

        period_returns.append(period_return)
        turnovers.append(turnover)
        curve.append({"date": next_date, "equity": equity, "period_return": period_return})
        holdings.append({"date": date, "picks": pick_rows})
        previous_weights = weights

    rate_start = _rate_at(rates, rate_dates, dates[0])
    rate_end = _rate_at(rates, rate_dates, dates[-1])
    for point in curve:
        rate = _rate_at(rates, rate_dates, point["date"]) or rate_start
        if rate_start:
            point["equity_usd"] = point["equity"] * rate / rate_start
            point["benchmark_usd"] = rate / rate_start
        point["date"] = point["date"].isoformat()

    periods = len(period_returns)
    years = max((dates[-1] - dates[0]).days / 365.0, 1 / 365.0)
    mean_return = statistics.mean(period_returns) if period_returns else 0.0
    std_return = statistics.stdev(period_returns) if periods > 1 else 0.0
    periods_per_year = 365.0 / FREQUENCY_DAYS[snapshot["frequency"]]
    sharpe = (mean_return / std_return) * math.sqrt(periods_per_year) if std_return else 0.0
    volatility = std_return * math.sqrt(periods_per_year)

    peak = -math.inf
    max_drawdown = 0.0
    for point in curve:
        peak = max(peak, point["equity"])
        max_drawdown = min(max_drawdown, point["equity"] / peak - 1.0)

    cagr = equity ** (1.0 / years) - 1.0 if equity > 0 else -1.0
    win_rate = (sum(1 for value in period_returns if value > 0) / periods) if periods else 0.0
    avg_holdings = statistics.mean(len(item["picks"]) for item in holdings) if holdings else 0.0
    avg_turnover = statistics.mean(turnovers) if turnovers else 0.0

    metrics = {
        "total_return": round(equity - 1.0, 4),
        "total_return_usd": round(equity * rate_end / rate_start - 1.0, 4) if rate_start and rate_end else None,
        "benchmark_btc_usd_return": round(rate_end / rate_start - 1.0, 4) if rate_start and rate_end else None,
        "cagr": round(cagr, 4),
        "volatility": round(volatility, 4),
        "sharpe": round(sharpe, 3),
        "max_drawdown": round(max_drawdown, 4),
        "calmar": round(cagr / abs(max_drawdown), 3) if max_drawdown < 0 else None,
        "win_rate": round(win_rate, 4),
        "avg_holdings": round(avg_holdings, 2),
        "avg_turnover": round(avg_turnover, 4),
        "periods": periods,
    }

    return {
        "start": dates[0].isoformat(),
        "end": dates[-1].isoformat(),
        "metrics": metrics,
        "curve": curve,
        "holdings": holdings,
    }


def optimize(snapshot: dict, base: dict, limit: int = 5) -> list:
    """Cheap grid search over rotation, top-N, threshold and BTC fill."""
    results = []
    for rotation in ("rebalance", "hold"):
        for top_n in (3, 5, 10):
            for min_score in (40, 50, 60, 70):
                for fill_with_btc in (True, False):
                    params = {
                        **base,
                        "rotation": rotation,
                        "top_n": top_n,
                        "min_score": min_score,
                        "fill_with_btc": fill_with_btc,
                    }
                    try:
                        outcome = simulate(snapshot, **params)
                    except BacktestError:
                        continue
                    results.append(
                        {
                            "rotation": rotation,
                            "top_n": top_n,
                            "min_score": min_score,
                            "fill_with_btc": fill_with_btc,
                            "total_return": outcome["metrics"]["total_return"],
                            "sharpe": outcome["metrics"]["sharpe"],
                            "max_drawdown": outcome["metrics"]["max_drawdown"],
                        }
                    )
    results.sort(key=lambda item: (item["sharpe"], item["total_return"]), reverse=True)
    return results[:limit]
