"""Data quality report for the research universe.

Usage (from backend/):

    python -m research.data_quality
    python -m research.data_quality --save research/baselines/data_quality.json

Reports universe composition (active/delisted/stable), candle coverage and
gaps, point-in-time market history coverage and liquidity staleness.
"""

import argparse
import json
import os
from datetime import datetime, timezone

from sqlalchemy import text

from research import common

KLINE_GAP_SQL = """
SELECT COUNT(*) AS symbols_with_gaps, COALESCE(SUM(gaps), 0) AS total_gaps
FROM (
    SELECT symbol, COUNT(*) AS gaps
    FROM (
        SELECT symbol,
               julianday(timestamp) - julianday(LAG(timestamp) OVER (PARTITION BY symbol ORDER BY timestamp)) AS gap_days
        FROM klines
    )
    WHERE gap_days > 3
    GROUP BY symbol
)
"""

MARKET_HISTORY_GAP_SQL = """
SELECT COUNT(*) AS symbols_with_gaps, COALESCE(SUM(gaps), 0) AS total_gaps
FROM (
    SELECT symbol, COUNT(*) AS gaps
    FROM (
        SELECT symbol,
               julianday(timestamp) - julianday(LAG(timestamp) OVER (PARTITION BY symbol ORDER BY timestamp)) AS gap_days
        FROM market_history
    )
    WHERE gap_days > 3
    GROUP BY symbol
)
"""


def _scalar(connection, sql: str, **params):
    return connection.execute(text(sql), params).scalar()


def build_report(session) -> dict:
    connection = session.connection()

    universe = {
        "coins_total": _scalar(connection, "SELECT COUNT(*) FROM coins"),
        "active": _scalar(connection, "SELECT COUNT(*) FROM coins WHERE delisted_at IS NULL"),
        "delisted": _scalar(connection, "SELECT COUNT(*) FROM coins WHERE delisted_at IS NOT NULL"),
        "stable": _scalar(connection, "SELECT COUNT(*) FROM coins WHERE is_stable = 1"),
        "with_coingecko_id": _scalar(connection, "SELECT COUNT(*) FROM coins WHERE coingecko_id IS NOT NULL"),
    }
    delisted_symbols = [
        {"symbol": symbol, "delisted_at": str(moment)}
        for symbol, moment in connection.execute(
            text("SELECT symbol, delisted_at FROM coins WHERE delisted_at IS NOT NULL ORDER BY delisted_at")
        ).all()
    ]

    counts = [
        row[0]
        for row in connection.execute(
            text("SELECT COUNT(*) FROM klines GROUP BY symbol")
        ).all()
    ]
    counts.sort()

    def percentile(values, fraction):
        if not values:
            return 0
        return values[min(len(values) - 1, int(fraction * len(values)))]

    gaps = connection.execute(text(KLINE_GAP_SQL)).one()
    klines = {
        "symbols": len(counts),
        "rows": _scalar(connection, "SELECT COUNT(*) FROM klines"),
        "median_candles": percentile(counts, 0.5),
        "p10_candles": percentile(counts, 0.1),
        "symbols_ge_400_candles": sum(1 for value in counts if value >= 400),
        "symbols_ge_1095_candles": sum(1 for value in counts if value >= 1095),
        "symbols_with_gaps": gaps[0],
        "total_gaps": gaps[1],
    }

    market_rows = _scalar(connection, "SELECT COUNT(*) FROM market_history")
    market_symbols = _scalar(connection, "SELECT COUNT(DISTINCT symbol) FROM market_history")
    market_gaps = (
        connection.execute(text(MARKET_HISTORY_GAP_SQL)).one()
        if market_rows
        else (0, 0)
    )
    market_history = {
        "symbols": market_symbols,
        "rows": market_rows,
        "coverage_of_eligible": (
            round(market_symbols / universe["with_coingecko_id"], 3) if universe["with_coingecko_id"] else 0.0
        ),
        "symbols_ge_400_days": _scalar(
            connection,
            "SELECT COUNT(*) FROM (SELECT symbol FROM market_history GROUP BY symbol HAVING COUNT(*) >= 400)",
        ),
        "first_day": str(_scalar(connection, "SELECT MIN(timestamp) FROM market_history")) if market_rows else None,
        "last_day": str(_scalar(connection, "SELECT MAX(timestamp) FROM market_history")) if market_rows else None,
        "symbols_with_gaps": market_gaps[0],
        "total_gaps": market_gaps[1],
    }

    liquidity = {
        "active_with_market_cap": _scalar(
            connection, "SELECT COUNT(*) FROM coins WHERE delisted_at IS NULL AND market_cap IS NOT NULL"
        ),
        "active_stale_over_7d": _scalar(
            connection,
            "SELECT COUNT(*) FROM coins WHERE delisted_at IS NULL "
            "AND (last_updated IS NULL OR last_updated < datetime('now', '-7 day'))",
        ),
        "active_without_price": _scalar(
            connection, "SELECT COUNT(*) FROM coins WHERE delisted_at IS NULL AND current_price_btc IS NULL"
        ),
    }

    return {
        "universe": universe,
        "delisted_symbols": delisted_symbols,
        "klines": klines,
        "market_history": market_history,
        "liquidity": liquidity,
    }


def print_report(report: dict) -> None:
    universe = report["universe"]
    print(
        f"universe: {universe['coins_total']} coins "
        f"({universe['active']} active, {universe['delisted']} delisted, {universe['stable']} stable, "
        f"{universe['with_coingecko_id']} with coingecko_id)"
    )
    klines = report["klines"]
    print(
        f"klines: {klines['symbols']} symbols / {klines['rows']} rows · median {klines['median_candles']} candles · "
        f">=400d {klines['symbols_ge_400_candles']} · gaps {klines['symbols_with_gaps']} symbols "
        f"({klines['total_gaps']} gaps)"
    )
    market = report["market_history"]
    print(
        f"market history: {market['symbols']} symbols / {market['rows']} rows "
        f"({market['coverage_of_eligible'] * 100:.0f}% of eligible) · >=400d {market['symbols_ge_400_days']} · "
        f"{market['first_day']} → {market['last_day']}"
    )
    liquidity = report["liquidity"]
    print(
        f"liquidity: {liquidity['active_with_market_cap']} active with cap · "
        f"{liquidity['active_stale_over_7d']} stale >7d · {liquidity['active_without_price']} without price"
    )
    if report["delisted_symbols"]:
        print(f"delisted: {', '.join(entry['symbol'] for entry in report['delisted_symbols'][:20])}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save", default=None, help="Write the report JSON to this path")
    args = parser.parse_args()

    session = common.db_session()
    try:
        report = build_report(session)
        report["provenance"] = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "git_commit": common.git_commit(),
            "database": common.database_fingerprint(),
            "latest_candle": str(common.latest_candle(session)),
        }
    finally:
        session.close()

    print_report(report)

    if args.save:
        path = os.path.abspath(args.save)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as handle:
            json.dump(report, handle, indent=2, sort_keys=True)
        print(f"\nsaved {path}")


if __name__ == "__main__":
    main()
