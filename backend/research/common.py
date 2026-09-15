"""Shared plumbing for reproducible Value Score research.

Imports of the application modules are intentionally lazy so the harness can
be imported (and its helpers unit-tested) without touching a database.
"""

import hashlib
import os
import subprocess
import sys
import tempfile

os.environ.setdefault("DB_DIR", os.path.join(tempfile.gettempdir(), "dip-radar-research"))
os.environ.setdefault("LOG_LEVEL", "WARNING")

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def db_session():
    from database import SessionLocal

    return SessionLocal()


def database_path() -> str:
    from database import SQLALCHEMY_DATABASE_URL

    return SQLALCHEMY_DATABASE_URL.replace("sqlite:///", "")


def database_fingerprint() -> dict:
    """SHA-256 of the database file so results can be tied to an exact snapshot."""
    path = database_path()
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return {"path": path, "sha256": digest.hexdigest()[:16], "bytes": os.path.getsize(path)}


def latest_candle(session):
    from sqlalchemy import func

    from models import Kline

    return session.query(func.max(Kline.timestamp)).scalar()


def tracked_coins(session) -> int:
    from models import Coin

    return session.query(Coin).count()


def git_commit():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=BACKEND_DIR,
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except Exception:
        return None


def load_snapshot(frequency: str):
    """Build a point-in-time snapshot for the whole available history.

    Note: entry liquidity filters use the *current* market cap/volume rows
    (the database has no point-in-time liquidity yet); see research/README.md.
    """
    from backtest import build_snapshot

    session = db_session()
    try:
        end = latest_candle(session)
        return build_snapshot(session, frequency, end)
    finally:
        session.close()


def forward_return_pairs(snapshot: dict, step: int = 1, min_universe: int = 30):
    """Yield (anchor_date, symbols, forward_returns) for tradable cross-sections."""
    dates = snapshot["dates"]
    entries = snapshot["entries"]
    for index in range(len(dates) - step):
        pool = entries[dates[index]]
        future = entries[dates[index + step]]
        symbols = [
            symbol
            for symbol in pool
            if symbol in future and pool[symbol]["price"] and future[symbol]["price"]
        ]
        if len(symbols) < min_universe:
            continue
        returns = [future[symbol]["price"] / pool[symbol]["price"] - 1.0 for symbol in symbols]
        yield dates[index], symbols, returns


def ic_series(snapshot: dict, signal, step: int = 1, min_universe: int = 30) -> list:
    from research.stats import spearman

    values = []
    for date, symbols, returns in forward_return_pairs(snapshot, step, min_universe):
        pool = snapshot["entries"][date]
        ic = spearman([signal(pool[symbol]) for symbol in symbols], returns)
        if ic is not None:
            values.append(ic)
    return values


def quintile_spread_series(snapshot: dict, signal, step: int = 1, min_universe: int = 30) -> list:
    spreads = []
    for date, symbols, returns in forward_return_pairs(snapshot, step, min_universe):
        pool = snapshot["entries"][date]
        ordered = sorted(zip([signal(pool[symbol]) for symbol in symbols], returns))
        top = max(1, len(ordered) // 5)
        spreads.append(
            sum(value for _, value in ordered[-top:]) / top - sum(value for _, value in ordered[:top]) / top
        )
    return spreads
