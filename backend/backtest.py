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
from array import array
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
REGIME_SMA_ANCHORS = 6  # anchors in the alt/BTC index trend window

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

# Point-in-time extras computed from the trailing candles themselves
# (research feature store; not part of the score formula).
EXTRA_FIELDS = (
    "volatility_30d",
    "volatility_90d",
    "drawdown_from_ath",
    "days_since_ath",
    "dollar_volume_30d",
)


def _realized_volatility(closes: list, end_index: int, window: int) -> Optional[float]:
    start = max(1, end_index - window + 1)
    returns = []
    for index in range(start, end_index + 1):
        previous = closes[index - 1]
        current = closes[index]
        if previous > 0 and current > 0:
            returns.append(math.log(current / previous))
    if len(returns) < max(5, window // 3):
        return None
    mean = sum(returns) / len(returns)
    variance = sum((value - mean) ** 2 for value in returns) / (len(returns) - 1)
    return math.sqrt(variance)


def _dollar_volume(volumes: list, closes: list, end_index: int, window: int = 30) -> Optional[float]:
    """Average traded value in BTC terms over the trailing window."""
    start = max(0, end_index - window + 1)
    sample = [volumes[index] * closes[index] for index in range(start, end_index + 1)]
    if not sample:
        return None
    return sum(sample) / len(sample)


class BacktestError(ValueError):
    pass


class _SnapshotCoin:
    """Lightweight stand-in so calculate_value_scores can rank a cross-section."""

    __slots__ = (
        "symbol",
        "is_stable",
        "market_cap",
        "volume_24h",
        "distance_pct_event",
        *STATS_FIELDS,
        *EXTRA_FIELDS,
        "value_score",
        "value_parts",
    )

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
        for field in EXTRA_FIELDS:
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


def regime_warmup_start(start: datetime, frequency: str) -> datetime:
    """Earliest anchor a window needs so the dominance trend is already defined."""
    return start - timedelta(days=(REGIME_SMA_ANCHORS + 2) * FREQUENCY_DAYS[frequency])


def build_snapshot(
    db: DBSession,
    frequency: str,
    end: datetime,
    use_cache: bool = True,
    score_model: str = "rule",
    earliest: Optional[datetime] = None,
) -> dict:
    if frequency not in FREQUENCY_DAYS:
        raise BacktestError("rebalance must be weekly, monthly or quarterly")

    if score_model != "rule":
        from score_models import ScoreModelError, load_model

        try:
            score_artifact = load_model(score_model)
        except ScoreModelError as exc:
            raise BacktestError(str(exc))
    else:
        score_artifact = None

    key = (frequency, end.date().isoformat(), score_model, earliest.date().isoformat() if earliest else None)
    if use_cache and key in _SNAPSHOT_CACHE:
        return _SNAPSHOT_CACHE[key]

    coins = db.query(Coin).filter(Coin.is_stable.is_(False)).all()
    universe = {coin.symbol: coin for coin in coins}
    if not universe:
        raise BacktestError("No eligible coins for a backtest")

    rows = db.execute(
        select(Kline.symbol, Kline.timestamp, Kline.close, Kline.low, Kline.volume)
        .where(Kline.symbol.in_(list(universe)), Kline.timestamp <= end)
        .order_by(Kline.symbol, Kline.timestamp)
    ).all()
    if not rows:
        raise BacktestError("No candle history for a backtest")

    series = defaultdict(lambda: ([], [], [], []))
    for symbol, timestamp, close, low, volume in rows:
        entry = series[symbol]
        entry[0].append(timestamp)
        entry[1].append(close)
        entry[2].append(low)
        entry[3].append(volume or 0.0)

    first_date = min(entry[0][0] for entry in series.values() if entry[0])
    anchor_start = first_date + timedelta(days=WARMUP_CANDLES)
    if earliest is not None:
        # Skipping pre-window anchors keeps cold builds fast; the caller adds a
        # warmup buffer so regime signals are still defined at the window start.
        anchor_start = max(anchor_start, earliest)
    dates = _anchor_dates(anchor_start, end, frequency)
    if len(dates) < 2:
        raise BacktestError("Not enough history for this frequency")

    prepared = {}
    for symbol, (timestamps, closes, lows, volumes) in series.items():
        if len(timestamps) < WARMUP_CANDLES:
            continue
        size = len(timestamps)
        all_min = [0.0] * size
        event_min = [0.0] * size
        min_close = [0.0] * size
        max_close = [0.0] * size
        atl_index = [-1] * size
        ath_index = [-1] * size

        running_all = math.inf
        running_event = math.inf
        running_arg = -1
        running_arg_ath = -1
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
            if close >= running_max_close:
                running_max_close = close
                running_arg_ath = index
            running_min_close = min(running_min_close, close)
            all_min[index] = running_all
            event_min[index] = running_event if running_event < math.inf else running_all
            atl_index[index] = running_arg
            ath_index[index] = running_arg_ath
            min_close[index] = running_min_close
            max_close[index] = running_max_close

        prepared[symbol] = {
            "timestamps": timestamps,
            "closes": closes,
            "volumes": volumes,
            "all_min": all_min,
            "event_min": event_min,
            "atl_index": atl_index,
            "ath_index": ath_index,
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
            high_close = data["max_close"][index]
            snapshot_coin.volatility_30d = _realized_volatility(closes, index, 30)
            snapshot_coin.volatility_90d = _realized_volatility(closes, index, 90)
            snapshot_coin.drawdown_from_ath = (price / high_close - 1.0) if high_close else None
            ath_at = data["ath_index"][index]
            snapshot_coin.days_since_ath = (index - ath_at) if ath_at >= 0 else None
            snapshot_coin.dollar_volume_30d = _dollar_volume(data["volumes"], closes, index)
            snapshot_coins.append(snapshot_coin)
            prices[symbol] = price

        # First pass matches the dashboard universe so the historical scores
        # agree with /api/coins; coins below the default liquidity gates get
        # a fallback score from a gate-free cross-section. A learned artifact
        # scores the same universe with its frozen feature ranks instead.
        if score_artifact is None:
            calculate_value_scores(snapshot_coins)
            official_scores = {coin.symbol: coin.value_score for coin in snapshot_coins}
            calculate_value_scores(snapshot_coins, min_cap=0, min_volume=0)
        else:
            from score_models import apply_model_scores

            apply_model_scores(snapshot_coins, score_artifact)
            official_scores = {coin.symbol: coin.value_score for coin in snapshot_coins}

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
                "trend_30d": snapshot_coin.trend_30d_pct,
                "above_sma200": snapshot_coin.above_sma200,
                "valuation_pct_1y": snapshot_coin.valuation_pct_1y,
                "valuation_pct_3y": snapshot_coin.valuation_pct_3y,
                "valuation_pct_all": snapshot_coin.valuation_pct_all,
                "median_dist_1y": snapshot_coin.median_dist_1y,
                "median_dist_3y": snapshot_coin.median_dist_3y,
                "range_position": snapshot_coin.range_position,
                "days_since_atl": snapshot_coin.days_since_atl,
                "basing_pct_90d": snapshot_coin.basing_pct_90d,
                "trend_90d": snapshot_coin.trend_90d_pct,
                "history_days": snapshot_coin.history_days,
                "volatility_30d": snapshot_coin.volatility_30d,
                "volatility_90d": snapshot_coin.volatility_90d,
                "drawdown_from_ath": snapshot_coin.drawdown_from_ath,
                "days_since_ath": snapshot_coin.days_since_ath,
                "dollar_volume_30d": snapshot_coin.dollar_volume_30d,
            }
        entries_by_date[date] = entries
        snapshot_dates.append(date)

    if sum(1 for entries in entries_by_date.values() if entries) < 2:
        raise BacktestError("Not enough scored history for a backtest")

    # Altcoin dominance proxy from our own universe (no external data): an
    # equal-weight alt/BTC index built only from anchor prices available at
    # each date, plus breadth (share of coins above their 200d SMA). When this
    # keeps falling ("OTHERS.D down"), altcoin strategies in BTC terms bleed,
    # so the simulator can sit in BTC instead.
    regime = {}
    index_level = 1.0
    levels = []
    previous_prices = None
    for date in snapshot_dates:
        entries = entries_by_date[date]
        if previous_prices:
            returns = [
                entries[symbol]["price"] / previous_prices[symbol] - 1.0
                for symbol in entries
                if symbol in previous_prices and previous_prices[symbol]
            ]
            if returns:
                index_level *= 1.0 + sum(returns) / len(returns)
        levels.append(index_level)
        window = levels[-REGIME_SMA_ANCHORS:]
        sma = sum(window) / len(window)
        breadth_values = [
            1.0 if entry.get("above_sma200") else 0.0
            for entry in entries.values()
            if entry.get("above_sma200") is not None
        ]
        regime[date] = {
            "alt_index": index_level,
            "alt_above_sma": (index_level > sma) if len(levels) >= 3 else None,
            "alt_trend": (index_level / sma - 1.0) if sma else None,
            "breadth": (sum(breadth_values) / len(breadth_values)) if breadth_values else None,
        }
        previous_prices = {symbol: entry["price"] for symbol, entry in entries.items()}

    snapshot = {
        "frequency": frequency,
        "end": end,
        "dates": snapshot_dates,
        "entries": entries_by_date,
        "regime": regime,
        "rates": rates,
        "rate_dates": rate_dates,
        "series": {
            symbol: {
                "timestamps": array("d", [timestamp.timestamp() for timestamp in data["timestamps"]]),
                "closes": array("d", data["closes"]),
            }
            for symbol, data in prepared.items()
        },
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


def _first_exit(
    timestamps,
    closes,
    start_index: int,
    end_index: int,
    entry_price: float,
    peak: float,
    stop_loss_pct: Optional[float],
    trailing_stop_pct: Optional[float],
    take_profit_pct: Optional[float],
):
    """First daily close that triggers a risk exit, relative to the position's
    own entry/peak: ``(trigger, peak)`` where trigger is (price, reason, index)."""
    for index in range(start_index, end_index):
        price = closes[index]
        peak = max(peak, price)
        if stop_loss_pct is not None and price <= entry_price * (1.0 - stop_loss_pct / 100.0):
            return (price, "stop_loss", index), peak
        if trailing_stop_pct is not None and price <= peak * (1.0 - trailing_stop_pct / 100.0):
            return (price, "trailing_stop", index), peak
        if take_profit_pct is not None and price >= entry_price * (1.0 + take_profit_pct / 100.0):
            return (price, "take_profit", index), peak
    return None, peak


def _trade(position: dict, exit_date: datetime, exit_price: float, reason: str) -> dict:
    entry_price = position["entry_price"]
    return {
        "symbol": position["symbol"],
        "entry_date": position["entry_date"].isoformat(),
        "entry_price": entry_price,
        "entry_score": position["entry_score"],
        "exit_date": exit_date.isoformat(),
        "exit_price": exit_price,
        "exit_reason": reason,
        "return_pct": (exit_price / entry_price - 1.0) if entry_price else 0.0,
        "days": (exit_date - position["entry_date"]).days,
    }


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
    min_trend_30d: Optional[float] = None,
    stop_loss_pct: Optional[float] = None,
    trailing_stop_pct: Optional[float] = None,
    take_profit_pct: Optional[float] = None,
    regime_filter: Optional[str] = None,
    regime_min_breadth: float = 0.5,
    regime_exposure: float = 0.0,
    equity_trend_exposure: Optional[float] = None,
    profit_lock_pct: Optional[float] = None,
    short_n: int = 0,
    short_max_score: Optional[float] = None,
    short_funding_apr: float = 0.0,
    short_exposure: float = 1.0,
    profit_sweep_pct: float = 0.0,
    max_holding_periods: Optional[int] = None,
) -> dict:
    """Walk the rebalance anchors and compound the portfolio.

    ``rotation="rebalance"`` resets the book to the top-N cheapest coins at
    every anchor. ``rotation="hold"`` buys as before but only sells a
    position once its score falls below ``sell_score`` (default: the buy
    threshold), so coins are held while they stay cheap and rotated out when
    the cheapness is gone. The optional daily risk exits (stop-loss, trailing
    stop, take-profit) sell a position mid-period; the proceeds sit in BTC
    until the next anchor and the symbol is blocked for one rebalance.
    """
    if rotation not in ("rebalance", "hold"):
        raise BacktestError("rotation must be rebalance or hold")
    if regime_filter not in (None, "alt_trend", "breadth"):
        raise BacktestError("regime_filter must be alt_trend or breadth")
    exit_score = min_score if sell_score is None else sell_score
    daily_exits = any(
        value is not None for value in (stop_loss_pct, trailing_stop_pct, take_profit_pct)
    )

    dates = [date for date in snapshot["dates"] if start <= date <= end]
    if len(dates) < 2:
        raise BacktestError("The selected window has fewer than two rebalance dates")

    entries_by_date = snapshot["entries"]
    regime = snapshot.get("regime", {})
    rates = snapshot["rates"]
    rate_dates = snapshot["rate_dates"]
    series = snapshot.get("series", {})

    equity = 1.0
    previous_weights: dict = {}
    blocked_symbols: set = set()
    open_positions: dict = {}
    trades = []
    curve = [{"date": dates[0], "equity": 1.0, "period_return": 0.0}]
    holdings = []
    period_returns = []
    turnovers = []

    equity_history = []
    lock_base = 1.0
    funding_costs = []
    short_notionals = []
    long_notionals = []
    previous_shorts: set = set()

    for index in range(len(dates) - 1):
        date = dates[index]
        next_date = dates[index + 1]
        equity_history.append(equity)
        period_days = max((next_date - date).days, 1)
        pool = entries_by_date.get(date, {})
        next_pool = entries_by_date.get(next_date, {})

        risk_on = True
        if regime_filter:
            info = regime.get(date) or {}
            if regime_filter == "alt_trend":
                risk_on = info.get("alt_above_sma") is not False
            else:
                breadth = info.get("breadth")
                risk_on = breadth is None or breadth >= regime_min_breadth

        candidates = [
            (symbol, entry)
            for symbol, entry in pool.items()
            if entry["score"] >= min_score
            and (entry["cap"] or 0.0) >= min_market_cap
            and (entry["volume"] or 0.0) >= min_volume
            and (
                min_trend_30d is None
                or (
                    entry.get("trend_30d") is not None
                    and entry["trend_30d"] >= min_trend_30d
                )
            )
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
                if symbol in blocked_symbols or symbol in previous_shorts:
                    continue
                entry = pool.get(symbol)
                if entry is not None and entry["score"] >= exit_score:
                    picks.append((symbol, entry))
                    held_symbols.add(symbol)
            free_slots = top_n - len(picks)
            for symbol, entry in candidates:
                if free_slots <= 0:
                    break
                if symbol in held_symbols or symbol in blocked_symbols:
                    continue
                picks.append((symbol, entry))
                held_symbols.add(symbol)
                free_slots -= 1
            picks.sort(key=lambda item: -item[1]["score"])
        else:
            picks = [(symbol, entry) for symbol, entry in candidates if symbol not in blocked_symbols][:top_n]

        if not risk_on and regime_exposure <= 0:
            picks = []

        # Time stop: a position may not be held longer than N anchors — the
        # point is to accumulate BTC with altcoins, not to collect alt coin bags.
        time_exits = set()
        if max_holding_periods is not None and picks:
            kept = []
            for symbol, entry in picks:
                position = open_positions.get(symbol)
                if position is not None and position.get("periods_held", 0) + 1 >= max_holding_periods:
                    time_exits.add(symbol)
                    continue
                kept.append((symbol, entry))
            picks = kept

        weights = _weights_for(picks, weighting)
        if fill_with_btc and picks:
            scale = len(picks) / top_n
            weights = {symbol: weight * scale for symbol, weight in weights.items()}
        # Profit sweep: harvest part of a position's BTC-denominated gain back
        # into BTC, and keep the reduced size (persisted per position).
        if profit_sweep_pct and weights:
            for symbol in list(weights):
                position = open_positions.get(symbol)
                if position is None:
                    continue
                entry_price = position["entry_price"]
                price_now = pool.get(symbol, {}).get("price")
                if not entry_price or not price_now or price_now <= entry_price:
                    continue
                gain = price_now / entry_price - 1.0
                profit_fraction = gain / (1.0 + gain)
                reduction = min(0.9, (profit_sweep_pct / 100.0) * profit_fraction)
                if reduction > 0:
                    position["sweep"] = position.get("sweep", 1.0) * (1.0 - reduction)

        if weights:
            for symbol in list(weights):
                position = open_positions.get(symbol)
                if position is not None:
                    weights[symbol] *= position.get("sweep", 1.0)
            long_notionals.append(sum(weight for weight in weights.values() if weight > 0))

        if not risk_on and regime_exposure > 0:
            exposure = max(0.0, min(1.0, regime_exposure))
            weights = {symbol: weight * exposure for symbol, weight in weights.items()}

        # Equity-curve overlay: shrink exposure while the strategy itself is
        # below its own moving average (protects accumulated gains).
        if equity_trend_exposure is not None and weights:
            window = equity_history[-REGIME_SMA_ANCHORS:]
            average = sum(window) / len(window)
            if len(window) >= 3 and equity < average:
                exposure = max(0.0, min(1.0, equity_trend_exposure))
                weights = {symbol: weight * exposure for symbol, weight in weights.items()}

        # Profit lock: every time the equity doubles above the last lock level,
        # move a slice of the book permanently into BTC.
        if profit_lock_pct is not None and weights and equity >= lock_base * 2.0:
            remaining = 1.0 - max(0.0, min(0.95, profit_lock_pct / 100.0))
            weights = {symbol: weight * remaining for symbol, weight in weights.items()}
            lock_base = equity

        # Short book: the most expensive coins (lowest scores) are shorted at
        # every anchor and held to the next one. Negative signed weights let the
        # return, turnover and fee math stay symmetric with the long side.
        short_symbols = []
        if short_n > 0:
            short_candidates = [
                (symbol, entry)
                for symbol, entry in pool.items()
                if symbol not in weights
                and (entry["cap"] or 0.0) >= min_market_cap
                and (entry["volume"] or 0.0) >= min_volume
                and (short_max_score is None or entry["score"] <= short_max_score)
            ]
            short_candidates.sort(key=lambda item: item[1]["score"])
            short_picks = short_candidates[:short_n]
            short_symbols = [symbol for symbol, _ in short_picks]
            short_scale = max(0.0, min(1.0, short_exposure)) / short_n
            for symbol, _entry in short_picks:
                weights[symbol] = -short_scale

        # Positions dropped at this anchor are sold at the anchor price; the
        # trade log keeps where each position was bought and sold.
        for symbol in list(open_positions):
            if symbol in weights:
                entry = pool.get(symbol)
                if entry is not None:
                    open_positions[symbol]["last_price"] = entry["price"]
                    open_positions[symbol]["peak"] = max(open_positions[symbol]["peak"], entry["price"])
                    open_positions[symbol]["periods_held"] = open_positions[symbol].get("periods_held", 0) + 1
                continue
            position = open_positions.pop(symbol)
            entry = pool.get(symbol)
            exit_price = entry["price"] if entry is not None else position["last_price"]
            if symbol in time_exits:
                reason = "time"
            elif not risk_on:
                reason = "regime"
            elif rotation == "rebalance":
                reason = "rebalance"
            elif entry is None:
                reason = "missing"
            else:
                reason = "score"
            trades.append(_trade(position, date, exit_price, reason))

        for symbol, _long_entry in picks:
            if symbol in open_positions:
                continue
            entry = pool.get(symbol)
            if entry is None:
                continue
            open_positions[symbol] = {
                "symbol": symbol,
                "entry_date": date,
                "entry_price": entry["price"],
                "entry_score": entry["score"],
                "last_price": entry["price"],
                "peak": entry["price"],
                "sweep": 1.0,
                "periods_held": 0,
            }

        day_timestamp = date.timestamp()
        next_timestamp = next_date.timestamp()

        period_return = 0.0
        pick_rows = []
        stopped_symbols = set()
        for symbol in short_symbols:
            entry = pool.get(symbol)
            next_entry = next_pool.get(symbol)
            if entry is None or next_entry is None:
                continue
            price_now = entry["price"]
            price_next = next_entry["price"]
            coin_return = (price_next / price_now - 1.0) if price_now else 0.0
            weight = weights.get(symbol, 0.0)
            period_return += weight * coin_return  # negative weight -> short P&L
            pick_rows.append(
                {
                    "symbol": symbol,
                    "score": entry["score"],
                    "weight": weight,
                    "period_return": -coin_return,
                    "exited": False,
                    "direction": "short",
                }
            )
        for symbol, entry in picks:
            weight = weights.get(symbol, 0.0)
            price_now = entry["price"]
            price_next = next_pool.get(symbol, {}).get("price", price_now)
            exit_trigger = None
            position = open_positions.get(symbol)
            if daily_exits and position is not None:
                data = series.get(symbol)
                if data is not None:
                    start_index = bisect.bisect_right(data["timestamps"], day_timestamp)
                    end_index = bisect.bisect_right(data["timestamps"], next_timestamp)
                    exit_trigger, peak = _first_exit(
                        data["timestamps"],
                        data["closes"],
                        start_index,
                        end_index,
                        position["entry_price"],
                        position["peak"],
                        stop_loss_pct,
                        trailing_stop_pct,
                        take_profit_pct,
                    )
                    position["peak"] = max(position["peak"], peak)
                    position["last_price"] = price_next
            if exit_trigger is not None:
                exit_price, exit_reason, exit_index = exit_trigger
                coin_return = (exit_price / price_now - 1.0) if price_now else 0.0
                stopped_symbols.add(symbol)
                open_positions.pop(symbol, None)
                exit_day = datetime.fromtimestamp(series[symbol]["timestamps"][exit_index])
                trades.append(_trade(position, exit_day, exit_price, exit_reason))
            else:
                coin_return = (price_next / price_now - 1.0) if price_now else 0.0
            period_return += weight * coin_return
            pick_rows.append(
                {
                    "symbol": symbol,
                    "score": entry["score"],
                    "weight": weight,
                    "period_return": coin_return,
                    "exited": exit_trigger is not None,
                    "direction": "long",
                }
            )

        all_symbols = set(weights) | set(previous_weights)
        traded_notional = sum(abs(weights.get(symbol, 0.0) - previous_weights.get(symbol, 0.0)) for symbol in all_symbols)
        turnover = traded_notional / 2
        fee = traded_notional * fee_pct / 100.0
        short_notional = sum(abs(weights.get(symbol, 0.0)) for symbol in short_symbols)
        funding = short_notional * (short_funding_apr / 100.0) * period_days / 365.0
        funding_costs.append(funding)
        short_notionals.append(short_notional)
        period_return -= fee + funding
        equity *= 1.0 + period_return

        period_returns.append(period_return)
        turnovers.append(turnover)
        curve.append({"date": next_date, "equity": equity, "period_return": period_return})
        holdings.append({"date": date, "picks": pick_rows, "risk_on": risk_on})
        previous_weights = weights
        previous_shorts = set(short_symbols)
        blocked_symbols = stopped_symbols | time_exits

    last_pool = entries_by_date.get(dates[-1], {})
    for symbol, position in open_positions.items():
        entry = last_pool.get(symbol)
        exit_price = entry["price"] if entry is not None else position["last_price"]
        trades.append(_trade(position, dates[-1], exit_price, "open"))

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

    # Consistency diagnostics: a single vintage spike followed by flat years
    # looks great on total return but is not repeatable income.
    year_end_equity = {}
    for point in curve:
        year_end_equity[point["date"][:4]] = point["equity"]
    year_returns = []
    previous = 1.0
    for year in sorted(year_end_equity):
        year_returns.append(year_end_equity[year] / previous - 1.0)
        previous = year_end_equity[year]
    positive_years = (
        sum(1 for value in year_returns if value > 0) / len(year_returns) if year_returns else 0.0
    )

    rolling_window = max(4, int(round(periods_per_year)))
    positive_rolling = 0
    rolling_total = 0
    for start_index in range(0, max(0, periods - rolling_window) + 1):
        product = 1.0
        for value in period_returns[start_index : start_index + rolling_window]:
            product *= 1.0 + value
        rolling_total += 1
        positive_rolling += 1 if product > 1.0 else 0
    positive_rolling_share = positive_rolling / rolling_total if rolling_total else 0.0

    peak_equity = -math.inf
    periods_in_drawdown = 0
    for point in curve:
        peak_equity = max(peak_equity, point["equity"])
        if point["equity"] < peak_equity - 1e-12:
            periods_in_drawdown += 1
    time_in_drawdown = periods_in_drawdown / len(curve) if curve else 0.0

    best_count = max(1, int(round(periods * 0.05)))
    positive_returns = sorted((value for value in period_returns if value > 0), reverse=True)
    best_period_share = (
        sum(positive_returns[:best_count]) / sum(positive_returns) if positive_returns else 1.0
    )

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
        "avg_short_notional": round(statistics.mean(short_notionals), 4) if short_notionals else 0.0,
        "avg_long_notional": round(statistics.mean(long_notionals), 4) if long_notionals else 0.0,
        "funding_cost": round(sum(funding_costs), 4) if funding_costs else 0.0,
        "positive_years": round(positive_years, 4),
        "positive_rolling_share": round(positive_rolling_share, 4),
        "time_in_drawdown": round(time_in_drawdown, 4),
        "best_period_share": round(best_period_share, 4),
        "periods": periods,
    }

    return {
        "start": dates[0].isoformat(),
        "end": dates[-1].isoformat(),
        "metrics": metrics,
        "curve": curve,
        "holdings": holdings,
        "trades": trades,
    }
