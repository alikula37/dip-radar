"""Recover coins that were delisted before the archive existed.

Binance's public data mirror (data.binance.vision) keeps every spot symbol
that ever traded, keyless. This module discovers mirror symbols that are no
longer in exchangeInfo and can ingest their daily candles from the monthly
archives, creating archived ``Coin`` rows (``delisted_at`` set) so backtests
stop being survivorship-biased.

Usage (from backend/):

    python -m binance_mirror --discover                  # report candidates only
    python -m binance_mirror --discover --limit 50
    python -m binance_mirror --sync FTTBTC --since 2020-01
    python -m binance_mirror --sync-from-candidates --limit 10
"""

import argparse
import csv
import io
import logging
import re
import time
import zipfile
from datetime import datetime, timedelta, timezone

from models import Coin, Kline, split_symbol  # noqa: F401  (Kline re-exported for tests)

logger = logging.getLogger(__name__)

MIRROR_BASE = "https://data.binance.vision"
S3_LISTING_URL = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
PREFIX = "data/spot/daily/klines/"
MONTHLY_PATH = "data/spot/monthly/klines/{symbol}/1d/{symbol}-1d-{year:04d}-{month:02d}.zip"

# Binance leveraged tokens (ETHUP, BTCDOWN, …) are not spot coins; legacy
# renamed pairs (BCHABC for BCH, …) would double-count an active coin.
LEVERAGED_SUFFIXES = ("UP", "DOWN", "BULL", "BEAR")
FIAT_BASES = {
    "AUD",
    "BRL",
    "EUR",
    "GBP",
    "IDRT",
    "RUB",
    "TRY",
    "UAH",
    "USD",
    "ZAR",
}

_PREFIX_RE = re.compile(r"<Prefix>" + re.escape(PREFIX) + r"([^<]+?)/</Prefix>")
_KEY_RE = re.compile(r"<Key>([^<]+)</Key>")
_TRUNCATED_RE = re.compile(r"<IsTruncated>true</IsTruncated>")
_MARKER_RE = re.compile(r"<NextMarker>([^<]+)</NextMarker>")


class MirrorError(RuntimeError):
    pass


class MirrorClient:
    """Minimal HTTP client for the S3 listing and the monthly kline archives."""

    def __init__(self, session=None, sleep=time.sleep, listing_url: str = S3_LISTING_URL, base_url: str = MIRROR_BASE):
        from fetcher import build_http_session

        self.session = session or build_http_session()
        self.sleep = sleep
        self.listing_url = listing_url
        self.base_url = base_url

    def list_symbols(self, max_pages: int = 20) -> list:
        symbols = []
        marker = None
        for _ in range(max_pages):
            params = {"delimiter": "/", "prefix": PREFIX}
            if marker:
                params["marker"] = marker
            response = self.session.get(self.listing_url, params=params, timeout=(5, 60))
            if response.status_code != 200:
                raise MirrorError(f"Listing failed with HTTP {response.status_code}")
            body = response.text
            symbols.extend(_PREFIX_RE.findall(body))
            if not _TRUNCATED_RE.search(body):
                break
            marker_match = _MARKER_RE.search(body)
            if not marker_match:
                break
            marker = marker_match.group(1)
            self.sleep(0.2)
        return sorted(set(symbols))

    def list_months(self, symbol: str, max_pages: int = 3) -> list:
        """Available monthly archives for a symbol: [(year, month), …]."""
        months = set()
        marker = None
        for _ in range(max_pages):
            params = {"prefix": f"data/spot/monthly/klines/{symbol}/1d/"}
            if marker:
                params["marker"] = marker
            response = self.session.get(self.listing_url, params=params, timeout=(5, 60))
            if response.status_code != 200:
                raise MirrorError(f"Monthly listing failed with HTTP {response.status_code}")
            body = response.text
            for key in _KEY_RE.findall(body):
                match = re.search(r"-1d-(\d{4})-(\d{2})\.zip$", key)
                if match:
                    months.add((int(match.group(1)), int(match.group(2))))
            if not _TRUNCATED_RE.search(body):
                break
            marker_match = _MARKER_RE.search(body)
            if not marker_match:
                break
            marker = marker_match.group(1)
            self.sleep(0.2)
        return sorted(months)

    def fetch_month(self, symbol: str, year: int, month: int):
        """Return the monthly CSV rows for a symbol, or None when missing."""
        url = f"{self.base_url}/{MONTHLY_PATH.format(symbol=symbol, year=year, month=month)}"
        response = self.session.get(url, timeout=(5, 120))
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise MirrorError(f"{symbol} {year}-{month:02d} failed with HTTP {response.status_code}")
        archive = zipfile.ZipFile(io.BytesIO(response.content))
        name = next((entry for entry in archive.namelist() if entry.endswith(".csv")), None)
        if name is None:
            return None
        rows = []
        with archive.open(name) as handle:
            for row in csv.reader(io.TextIOWrapper(handle, encoding="utf-8")):
                if not row or not row[0].strip():
                    continue
                if not row[0].strip().isdigit():
                    continue  # header row
                open_time = int(row[0].strip())
                if open_time > 10**14:
                    open_time //= 1000  # newer archives use microseconds
                # Match the Binance API row typing (open time is an integer).
                rows.append([open_time] + row[1:])
        return rows


def discover_delisted(active_symbols, mirror_symbols, quotes=("BTC", "USDT"), excluded_bases=()):
    """Mirror symbols absent from exchangeInfo, one preferred pair per base.

    Leveraged tokens on active underlyings and legacy tickers that contain an
    active base (BCHABC vs BCH) are filtered out.
    """
    active = set(active_symbols)
    active_bases = {split_symbol(symbol)[0].upper() for symbol in active if split_symbol(symbol)[1] in quotes}
    excluded = {base.upper() for base in excluded_bases} | FIAT_BASES

    preferred = {}
    for symbol in mirror_symbols:
        base, quote = split_symbol(symbol)
        if quote not in quotes or not base:
            continue
        base = base.upper()
        if base in excluded or base in active_bases or symbol in active:
            continue
        if any(
            base.endswith(suffix) and base[: -len(suffix)] in active_bases
            for suffix in LEVERAGED_SUFFIXES
        ):
            continue
        if any(len(active_base) >= 3 and active_base in base for active_base in active_bases):
            continue
        current = preferred.get(base)
        if current is None or (current[1] == "USDT" and quote == "BTC"):
            preferred[base] = (symbol, quote)
    return sorted(symbol for symbol, _ in preferred.values())


def _monthly_range(since: datetime, until: datetime):
    cursor = datetime(since.year, since.month, 1)
    while cursor <= until:
        yield cursor.year, cursor.month
        cursor = datetime(cursor.year + (cursor.month // 12), cursor.month % 12 + 1, 1)


def _first_timestamp(rows):
    return datetime.fromtimestamp(int(rows[0][0]) / 1000, tz=timezone.utc).replace(tzinfo=None)


def _last_day(rows):
    moment = datetime.fromtimestamp(int(rows[-1][0]) / 1000, tz=timezone.utc).replace(tzinfo=None)
    return moment.replace(hour=0, minute=0, second=0, microsecond=0)


def _fetch_listed_months(client, symbol: str, months: list, workers: int = 8, delay: float = 0.0) -> list:
    """Download the given (year, month) archives concurrently and sort by time."""
    from concurrent.futures import ThreadPoolExecutor

    def fetch(month):
        if delay:
            time.sleep(delay)
        return client.fetch_month(symbol, month[0], month[1])

    rows = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        for month_rows in executor.map(fetch, months):
            if month_rows:
                rows.extend(month_rows)
    rows.sort(key=lambda row: row[0])
    return rows


def sync_delisted(
    db,
    client: MirrorClient,
    symbols,
    since: datetime,
    until: datetime = None,
    btc_rates=None,
    delay: float = 0.2,
    workers: int = 8,
    progress=None,
):
    """Create archived coins and ingest their daily candles from the mirror."""
    from fetcher import EVENT_CUTOFF, convert_usdt_klines_to_btc, update_coin_metrics, upsert_klines

    until = until or datetime.now(timezone.utc).replace(tzinfo=None)
    summary = {"coins": 0, "months": 0, "rows": 0, "failed": []}

    for index, symbol in enumerate(symbols, start=1):
        quote = split_symbol(symbol)[1]
        collected = []
        collected_months = 0
        empty_streak = 0

        months = None
        listed = False
        lister = getattr(client, "list_months", None)
        if lister is not None:
            try:
                months = [
                    (year, month)
                    for year, month in lister(symbol)
                    if (year, month) >= (since.year, since.month)
                ]
                listed = bool(months)
            except MirrorError as exc:
                logger.warning("Monthly listing failed for %s: %s", symbol, exc)
                months = None
        if not months:
            months = list(_monthly_range(since, until))

        if listed and workers > 1:
            try:
                collected = _fetch_listed_months(client, symbol, months, workers=workers, delay=delay)
            except MirrorError as exc:
                logger.warning("Parallel fetch failed for %s: %s", symbol, exc)
                collected = []
            collected_months = len(months) if collected else 0
        else:
            for year, month in months:
                try:
                    rows = client.fetch_month(symbol, year, month)
                except MirrorError as exc:
                    logger.warning("Mirror fetch failed for %s %s-%02d: %s", symbol, year, month, exc)
                    summary["failed"].append(symbol)
                    rows = None
                if rows:
                    collected.extend(rows)
                    collected_months += 1
                    empty_streak = 0
                else:
                    empty_streak += 1
                    if collected and empty_streak >= 3:
                        break
                if delay:
                    time.sleep(delay)

        if not collected:
            summary["failed"].append(symbol)
            if progress:
                progress(symbol, index, len(symbols), 0)
            continue

        if quote == "USDT":
            if not btc_rates:
                logger.warning("Skipping %s: USDT pairs need BTC rates", symbol)
                summary["failed"].append(symbol)
                if progress:
                    progress(symbol, index, len(symbols), 0)
                continue
            collected = convert_usdt_klines_to_btc(collected, btc_rates)
            if not collected:
                summary["failed"].append(symbol)
                if progress:
                    progress(symbol, index, len(symbols), 0)
                continue

        first_seen = _first_timestamp(collected)
        last_day = _last_day(collected)
        coin = db.get(Coin, symbol)
        if coin is None:
            coin = Coin(symbol=symbol)
            db.add(coin)
        coin.listing_date = coin.listing_date or first_seen
        coin.is_pre_2021 = first_seen < EVENT_CUTOFF
        coin.listed_checked = True
        coin.delisted_at = last_day + timedelta(days=1)
        db.commit()

        upsert_klines(db, symbol, collected)
        update_coin_metrics(db, coin)

        summary["coins"] += 1
        summary["months"] += collected_months
        summary["rows"] += len(collected)
        if progress:
            progress(symbol, index, len(symbols), len(collected))

    return summary


def _active_symbols():
    from fetcher import BinanceClient

    return [pair["symbol"] for pair in BinanceClient().fetch_symbols()]


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s:%(name)s:%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--discover", action="store_true", help="List delisted candidates (no writes)")
    parser.add_argument("--sync", nargs="+", help="Symbols to ingest from the mirror")
    parser.add_argument("--sync-from-candidates", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--since", default="2017-08", help="First month to fetch (YYYY-MM)")
    parser.add_argument("--delay", type=float, default=0.2)
    parser.add_argument("--workers", type=int, default=8, help="Concurrent archive downloads per symbol")
    args = parser.parse_args()

    client = MirrorClient()
    mirror_symbols = client.list_symbols()
    active = _active_symbols()
    from fetcher import EXCLUDED_BASES, STABLE_BASES

    candidates = discover_delisted(active, mirror_symbols, excluded_bases=STABLE_BASES | EXCLUDED_BASES)
    print(f"mirror symbols: {len(mirror_symbols)} · active: {len(active)} · delisted candidates: {len(candidates)}")
    if args.limit:
        candidates = candidates[: args.limit]
    if args.discover or args.sync_from_candidates:
        print("candidates:", ", ".join(candidates[:80]) + (" …" if len(candidates) > 80 else ""))

    if not (args.sync or args.sync_from_candidates):
        return

    symbols = args.sync or candidates
    year, month = (int(part) for part in args.since.split("-"))
    since = datetime(year, month, 1)

    from database import Base, SessionLocal, engine
    from fetcher import BinanceClient, fetch_btc_daily_rates

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        btc_rates = {}
        if any(split_symbol(symbol)[1] == "USDT" for symbol in symbols):
            try:
                btc_rates = fetch_btc_daily_rates(BinanceClient())
            except Exception as exc:  # pragma: no cover - network dependent
                logger.warning("Cannot load BTC rates, USDT pairs will be skipped: %s", exc)
        summary = sync_delisted(
            db,
            client,
            symbols,
            since,
            btc_rates=btc_rates,
            delay=args.delay,
            workers=args.workers,
            progress=lambda symbol, index, total, rows: print(f"[{index}/{total}] {symbol}: {rows} rows"),
        )
    finally:
        db.close()

    print(
        f"ingested {summary['coins']} coins · {summary['months']} monthly files · "
        f"{summary['rows']} candles · failed {len(summary['failed'])}"
    )
    if summary["failed"]:
        print("failed:", ", ".join(sorted(set(summary["failed"]))))


if __name__ == "__main__":
    main()
