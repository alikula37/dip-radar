"""Forward-looking signals from a strategy configuration.

Replays a configuration up to the latest anchor with the exact backtest engine
(so the book, the risk overlays and the exit thresholds match the simulation),
then answers the live questions:

- What does the book look like right now? (positions, weights, BTC share)
- Did any daily exit (stop / trailing / take-profit) fire since the anchor?
- Which coins is the next anchor about to rotate into?

The output is informational: signals are derived from the same point-in-time
scores the backtest uses, and the data vintage is part of the payload.
"""

from datetime import datetime, timedelta

from sqlalchemy import select

from backtest import (
    FREQUENCY_DAYS,
    _anchor_dates,
    _first_exit,
    build_snapshot,
    regime_warmup_start,
    simulate,
)
from models import Kline


def _next_anchor(anchor: datetime, frequency: str) -> datetime:
    dates = _anchor_dates(
        anchor + timedelta(days=1),
        anchor + timedelta(days=FREQUENCY_DAYS[frequency] + 10),
        frequency,
    )
    return dates[0] if dates else anchor + timedelta(days=FREQUENCY_DAYS[frequency])


def _close_series(db, symbols: list, start: datetime, end: datetime) -> dict:
    """Per symbol: (timestamps, closes) for daily exit checks after the anchor."""
    if not symbols:
        return {}
    rows = db.execute(
        select(Kline.symbol, Kline.timestamp, Kline.close)
        .where(Kline.symbol.in_(symbols), Kline.timestamp > start, Kline.timestamp <= end)
        .order_by(Kline.symbol, Kline.timestamp)
    ).all()
    series = {}
    for symbol, timestamp, close in rows:
        entry = series.setdefault(symbol, ([], []))
        entry[0].append(timestamp)
        entry[1].append(close)
    return series


def _latest_prices(db, symbols: list, end: datetime) -> dict:
    """Last close at or before ``end`` for each symbol."""
    if not symbols:
        return {}
    rows = db.execute(
        select(Kline.symbol, Kline.timestamp, Kline.close)
        .where(Kline.symbol.in_(symbols), Kline.timestamp <= end)
        .order_by(Kline.symbol, Kline.timestamp)
    ).all()
    prices = {}
    for symbol, timestamp, close in rows:
        prices[symbol] = (timestamp, close)
    return prices


def strategy_signals(
    db,
    *,
    start: datetime,
    end: datetime,
    frequency: str,
    params: dict,
) -> dict:
    """Replay ``params`` up to the latest anchor and derive the live signals."""
    score_model = params.get("score_model", "rule")
    simulate_params = {key: value for key, value in params.items() if key != "score_model"}
    snapshot = build_snapshot(
        db,
        frequency,
        end,
        score_model=score_model,
        earliest=regime_warmup_start(start, frequency),
        use_cache=False,
    )
    simulation = simulate(snapshot, start=start, end=end, **simulate_params)
    state = simulation["state"]

    anchor = datetime.fromisoformat(state["anchor"])
    next_anchor = _next_anchor(anchor, frequency)
    pool = snapshot["entries"].get(anchor, {})

    symbols = sorted({position["symbol"] for position in state["positions"]} | set(state["shorts"]))
    prices = _latest_prices(db, symbols, end)
    daily = _close_series(db, symbols, anchor, end)

    stop_pct = params.get("stop_loss_pct")
    trailing_pct = params.get("trailing_stop_pct")
    take_profit_pct = params.get("take_profit_pct")

    flat = bool(state["in_btc"])
    positions = []
    for position in [] if flat else state["positions"]:
        symbol = position["symbol"]
        mark = prices.get(symbol)
        price_now = mark[1] if mark else position["last_price"]
        entry_price = position["entry_price"]

        timestamps, closes = daily.get(symbol, ([], []))
        trigger, peak = _first_exit(
            timestamps,
            closes,
            0,
            len(timestamps),
            entry_price=entry_price,
            peak=position["peak"],
            stop_loss_pct=stop_pct,
            trailing_stop_pct=trailing_pct,
            take_profit_pct=take_profit_pct,
        )
        trigger_price, trigger_reason, trigger_index = trigger if trigger else (None, None, None)
        positions.append(
            {
                "symbol": symbol,
                "direction": "long",
                "score": pool.get(symbol, {}).get("score", position["entry_score"]),
                "weight": state["weights"].get(symbol) or 0.0,
                "entry_date": position["entry_date"],
                "entry_price": entry_price,
                "price_now": price_now,
                "pnl_pct": round(price_now / entry_price - 1.0, 4) if entry_price else None,
                "peak": round(peak, 8),
                "sweep": position["sweep"],
                "periods_held": position["periods_held"],
                "stop_price": round(entry_price * (1.0 - stop_pct / 100.0), 8) if stop_pct else None,
                "trailing_stop_price": round(peak * (1.0 - trailing_pct / 100.0), 8) if trailing_pct else None,
                "take_profit_price": round(entry_price * (1.0 + take_profit_pct / 100.0), 8) if take_profit_pct else None,
                "action": "SELL" if trigger_reason else "HOLD",
                "reason": trigger_reason,
                "trigger_date": timestamps[trigger_index].isoformat() if trigger_index is not None else None,
                "trigger_price": trigger_price,
            }
        )
    for symbol in [] if flat else state["shorts"]:
        mark = prices.get(symbol)
        positions.append(
            {
                "symbol": symbol,
                "direction": "short",
                "score": pool.get(symbol, {}).get("score"),
                "weight": state["weights"].get(symbol) or 0.0,
                "entry_date": anchor.isoformat(),
                "entry_price": None,
                "price_now": mark[1] if mark else None,
                "pnl_pct": None,
                "peak": None,
                "sweep": None,
                "periods_held": None,
                "stop_price": None,
                "trailing_stop_price": None,
                "take_profit_price": None,
                "action": "HOLD",
                "reason": None,
                "trigger_date": None,
                "trigger_price": None,
            }
        )

    # Next-anchor watchlist: the strategy's own ranking as of the last anchor,
    # excluding what the book already holds.
    invert = params.get("invert_score", False)
    held = {position["symbol"] for position in positions}
    ranked = sorted(
        ((symbol, entry) for symbol, entry in pool.items() if symbol not in held),
        key=lambda item: item[1]["score"] if invert else -item[1]["score"],
    )
    candidates = [
        {"symbol": symbol, "score": entry["score"], "direction": "long"}
        for symbol, entry in ranked[: max(1, int(params.get("top_n", 5)))]
    ]

    tracked = sorted(
        {position["symbol"] for position in state["positions"]} | set(state["shorts"])
    )
    sell_now = [position for position in positions if position["action"] == "SELL"]
    if state["in_btc"]:
        message = (
            f"The book sits in BTC at the {anchor.date()} anchor ({state['in_btc']}) and holds "
            f"{len(state['positions'])} tracked position(s) at zero exposure; "
            f"the next anchor on {next_anchor.date()} re-scores everything — watchlist below."
        )
    elif sell_now:
        message = (
            f"{len(sell_now)} position(s) hit a daily exit after the {anchor.date()} anchor; "
            f"rotate the rest at the next anchor on {next_anchor.date()}."
        )
    else:
        message = (
            f"The book is live as of the {anchor.date()} anchor; hold the list and rebalance "
            f"at the next anchor on {next_anchor.date()}."
        )

    return {
        "as_of": end.isoformat(),
        "anchor": anchor.isoformat(),
        "next_anchor": next_anchor.isoformat(),
        "rebalance": frequency,
        "start": start.isoformat(),
        "score_model": score_model,
        "state": {
            "equity": state["equity"],
            "long_notional": state["long_notional"],
            "short_notional": state["short_notional"],
            "in_btc": state["in_btc"],
            "tracked": tracked,
            "risk_on": state["risk_on"],
            "ic_risk_on": state["ic_risk_on"],
            "rolling_ic": state["rolling_ic"],
            "equity_brake": state["equity_brake"],
        },
        "positions": positions,
        "candidates": candidates,
        "message": message,
    }
