import json
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

import requests
from requests.adapters import HTTPAdapter
from sqlalchemy import func, or_
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session as DBSession
from urllib3.util.retry import Retry

from alerts import check_alerts
from database import SessionLocal
from locks import release_lock, try_acquire_lock
from metrics import calculate_coin_stats, calculate_distance_pct
from models import BtcRate, Coin, Kline, Meta
from timeutils import from_millis, to_millis, utcnow, utcnow_naive

logger = logging.getLogger(__name__)

# Binance serves the same public market data from these hosts. The second one
# is a dedicated market-data endpoint that is reachable from networks where
# api.binance.com is blocked. No third-party proxies are used.
BINANCE_BASE_URLS = (
    "https://api.binance.com/api/v3",
    "https://data-api.binance.vision/api/v3",
)

COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3"
COINGECKO_MARKETS_BATCH_SIZE = 250
COINGECKO_PRICE_BATCH_SIZE = 100
# CoinGecko categories whose members are pegged assets rather than altcoins.
STABLE_CATEGORIES = ("stablecoins", "tokenized-gold")
# Local fallback for coins without a CoinGecko category match.
STABLE_SYMBOLS = {
    "DAI",
    "U",
    "USTC",
    "FRAX",
    "GUSD",
    "LUSD",
    "SUSD",
    "TUSD",
    "BUSD",
    "USDP",
    "USDD",
    "USDR",
    "PYUSD",
    "FDUSD",
    "EURS",
    "EURT",
    "EURC",
    "CEUR",
    "AGEUR",
    "XAUT",
    "PAXG",
    "KAU",
    "XAUM",
    "ALUSD",
    "MIM",
    "CUSD",
    "USDX",
    "USDY",
}
STABLE_NAME_PATTERN = re.compile(r"\b(usd|stables?|stablecoin|dollar|gold|euro)\b", re.IGNORECASE)


def is_probably_stable(symbol: str, name: str = None) -> bool:
    """Heuristic for pegged assets (stables, tokenized gold) by symbol/name."""
    if not symbol:
        return False
    base = symbol.upper()
    if base in STABLE_SYMBOLS or "USD" in base:
        return True
    return bool(name and STABLE_NAME_PATTERN.search(name))
# Coins are synced concurrently; Binance rate limits are respected by the
# client, which sleeps on 429/418 responses.
SYNC_FETCH_WORKERS = int(os.getenv("SYNC_FETCH_WORKERS", "4"))
# A Binance price is considered verified when it is within this percentage of
# the independent CoinGecko price.
PRICE_VERIFY_TOLERANCE_PCT = float(os.getenv("PRICE_VERIFY_TOLERANCE_PCT", "5"))

EVENT_CUTOFF = datetime(2021, 1, 1)
BACKFILL_TOLERANCE = timedelta(days=2)
# Coins listed after 2021 are tracked when their market cap is at least this
# value; pre-2021 coins are always tracked.
MIN_TRACKED_MARKET_CAP = float(os.getenv("MIN_TRACKED_MARKET_CAP", "10000000"))
TRACKED_QUOTES = ("BTC", "USDT")
STABLE_BASES = {
    "USDC",
    "BUSD",
    "TUSD",
    "USDP",
    "DAI",
    "FDUSD",
    "USDE",
    "USD1",
    "XUSD",
    "USDY",
    "BFUSD",
    "EUR",
    "EURI",
    "AEUR",
    "GBP",
    "TRY",
    "BRL",
    "ARS",
    "BIDR",
    "IDRT",
    "BKRW",
    "NGN",
    "RUB",
    "UAH",
    "ZAR",
}
EXCLUDED_BASES = {"BTC", "WBTC"}
KLINES_LIMIT = 1000
UPSERT_CHUNK_SIZE = 200
REQUEST_DELAY = float(os.getenv("SYNC_REQUEST_DELAY", "0.15"))
COINGECKO_BATCH_DELAY = float(os.getenv("COINGECKO_BATCH_DELAY", "2"))
MAX_RETRY_WAIT = 120.0


class ProviderError(RuntimeError):
    pass


class BinanceError(ProviderError):
    pass


class CoinGeckoError(ProviderError):
    pass


def build_http_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=(500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def parse_retry_after(value, default: float = 10.0) -> float:
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        seconds = default
    return max(0.0, min(seconds, MAX_RETRY_WAIT))


class BinanceClient:
    """Minimal Binance REST client with automatic host fallback."""

    def __init__(self, session: requests.Session = None, sleep=time.sleep, base_urls=None):
        self.session = session or build_http_session()
        self.sleep = sleep
        self.base_urls = tuple(base_urls or BINANCE_BASE_URLS)

    def _get(self, path: str, params: dict = None, attempts: int = 2) -> requests.Response:
        errors = []
        for _ in range(attempts):
            for base_url in self.base_urls:
                url = f"{base_url}/{path}"
                try:
                    response = self.session.get(url, params=params, timeout=(5, 30))
                except requests.RequestException as exc:
                    errors.append(f"{base_url}: {exc}")
                    continue

                if response.status_code in (418, 429):
                    retry_after = parse_retry_after(response.headers.get("Retry-After"), default=10.0)
                    logger.warning(
                        "Binance rate limited (%s) on %s; waiting %.1fs",
                        response.status_code,
                        base_url,
                        retry_after,
                    )
                    errors.append(f"{base_url}: HTTP {response.status_code}")
                    self.sleep(retry_after)
                    continue

                if response.status_code >= 400:
                    errors.append(f"{base_url}: HTTP {response.status_code}")
                    continue

                return response

        raise BinanceError("; ".join(errors) or "Binance request failed")

    def fetch_symbols(self) -> list:
        """Return tradeable BTC/USDT pairs, preferring the BTC pair per asset.

        Coins that only trade against USDT are still tracked; their candles are
        converted to BTC parity later using BTCUSDT daily rates.
        """
        data = self._get("exchangeInfo").json()
        preferred = {}

        for entry in data.get("symbols", []):
            if entry.get("status") != "TRADING":
                continue
            base = entry.get("baseAsset")
            quote = entry.get("quoteAsset")
            if not base or quote not in TRACKED_QUOTES:
                continue
            if base in STABLE_BASES or base in EXCLUDED_BASES:
                continue

            current = preferred.get(base)
            if current is None or (current["quote"] == "USDT" and quote == "BTC"):
                preferred[base] = {"symbol": entry["symbol"], "base": base, "quote": quote}

        return sorted(preferred.values(), key=lambda pair: pair["symbol"])

    def fetch_first_kline(self, symbol: str):
        rows = self._get(
            "klines",
            {"symbol": symbol, "interval": "1d", "limit": 1, "startTime": 0},
        ).json()
        return rows[0] if rows else None

    def fetch_klines(self, symbol: str, start_time: int = 0, limit: int = KLINES_LIMIT) -> list:
        params = {"symbol": symbol, "interval": "1d", "limit": limit}
        if start_time is not None:
            # startTime=0 explicitly requests history from the listing date;
            # omitting it makes Binance return the *latest* `limit` candles.
            params["startTime"] = start_time
        return self._get("klines", params).json()


class CoinGeckoClient:
    """Minimal CoinGecko client for coin metadata and market caps."""

    def __init__(self, session: requests.Session = None, sleep=time.sleep, base_url: str = None):
        self.session = session or build_http_session()
        self.sleep = sleep
        self.base_url = base_url or COINGECKO_BASE_URL

    def _get(self, path: str, params: dict = None, attempts: int = 3) -> requests.Response:
        last_error = None
        for _ in range(attempts):
            try:
                response = self.session.get(f"{self.base_url}/{path}", params=params, timeout=(5, 30))
            except requests.RequestException as exc:
                last_error = exc
                continue

            if response.status_code == 429:
                retry_after = parse_retry_after(response.headers.get("Retry-After"), default=30.0)
                logger.warning("CoinGecko rate limited; waiting %.1fs", retry_after)
                last_error = CoinGeckoError("HTTP 429")
                self.sleep(retry_after)
                continue

            try:
                response.raise_for_status()
            except requests.HTTPError as exc:
                last_error = exc
                continue
            return response

        raise CoinGeckoError(str(last_error) if last_error else "CoinGecko request failed")

    def fetch_coin_list(self) -> list:
        return self._get("coins/list").json()

    def fetch_markets(self, ids: list) -> list:
        return self._get(
            "coins/markets",
            {
                "vs_currency": "usd",
                "ids": ",".join(ids),
                "per_page": COINGECKO_MARKETS_BATCH_SIZE,
                "page": 1,
            },
        ).json()

    def fetch_btc_prices(self, ids: list) -> dict:
        """BTC-denominated prices keyed by CoinGecko id (keyless endpoint)."""
        prices = {}
        for batch in chunked(ids, COINGECKO_PRICE_BATCH_SIZE):
            data = self._get("simple/price", {"ids": ",".join(batch), "vs_currencies": "btc"}).json()
            for coin_id, values in data.items():
                price = (values or {}).get("btc")
                if isinstance(price, (int, float)) and price > 0:
                    prices[coin_id] = float(price)
            self.sleep(COINGECKO_BATCH_DELAY)
        return prices

    def fetch_category_ids(self, category: str, max_pages: int = 3) -> set:
        """All CoinGecko ids that belong to a category (paged)."""
        ids = set()
        for page in range(1, max_pages + 1):
            data = self._get(
                "coins/markets",
                {
                    "vs_currency": "usd",
                    "category": category,
                    "per_page": COINGECKO_MARKETS_BATCH_SIZE,
                    "page": page,
                },
            ).json()
            if not data:
                break
            ids.update(coin.get("id") for coin in data if coin.get("id"))
            if len(data) < COINGECKO_MARKETS_BATCH_SIZE:
                break
            self.sleep(COINGECKO_BATCH_DELAY)
        return ids


def chunked(items: list, size: int):
    for index in range(0, len(items), size):
        yield items[index : index + size]


def upsert_klines(db: DBSession, symbol: str, rows: list) -> int:
    """Insert daily candles, updating existing (symbol, timestamp) pairs.

    Idempotent: re-fetching the current in-progress candle only updates it
    instead of creating duplicate rows.
    """
    if not rows:
        return 0

    values = [
        {
            "symbol": symbol,
            "timestamp": from_millis(row[0]),
            "open": float(row[1]),
            "high": float(row[2]),
            "low": float(row[3]),
            "close": float(row[4]),
            "volume": float(row[5]),
        }
        for row in rows
    ]

    for chunk in chunked(values, UPSERT_CHUNK_SIZE):
        statement = sqlite_insert(Kline).values(chunk)
        statement = statement.on_conflict_do_update(
            index_elements=[Kline.symbol, Kline.timestamp],
            set_={
                "open": statement.excluded.open,
                "high": statement.excluded.high,
                "low": statement.excluded.low,
                "close": statement.excluded.close,
                "volume": statement.excluded.volume,
            },
        )
        db.execute(statement)

    db.commit()
    return len(values)


def _close_before(db: DBSession, symbol: str, cutoff: datetime):
    return (
        db.query(Kline.close)
        .filter(Kline.symbol == symbol, Kline.timestamp <= cutoff)
        .order_by(Kline.timestamp.desc())
        .limit(1)
        .scalar()
    )


def update_coin_metrics(db: DBSession, coin: Coin) -> None:
    all_time_low = db.query(func.min(Kline.low)).filter(Kline.symbol == coin.symbol).scalar()
    event_low = (
        db.query(func.min(Kline.low))
        .filter(Kline.symbol == coin.symbol, Kline.timestamp >= EVENT_CUTOFF)
        .scalar()
    )
    latest = (
        db.query(Kline.timestamp, Kline.close)
        .filter(Kline.symbol == coin.symbol)
        .order_by(Kline.timestamp.desc())
        .limit(1)
        .first()
    )

    if latest is None or all_time_low is None:
        return

    current_price = latest.close
    latest_timestamp = latest.timestamp
    if event_low is None:
        event_low = all_time_low

    coin.current_price_btc = current_price
    coin.price_7d_ago_btc = _close_before(db, coin.symbol, latest_timestamp - timedelta(days=7))
    coin.price_30d_ago_btc = _close_before(db, coin.symbol, latest_timestamp - timedelta(days=30))
    coin.all_time_low = all_time_low
    coin.event_low = event_low
    coin.distance_pct_atl = calculate_distance_pct(current_price, all_time_low)
    coin.distance_pct_event = calculate_distance_pct(current_price, event_low)
    coin.last_updated = utcnow_naive()

    series = (
        db.query(Kline.close, Kline.low)
        .filter(Kline.symbol == coin.symbol)
        .order_by(Kline.timestamp.asc())
        .all()
    )
    stats = calculate_coin_stats([row[0] for row in series], [row[1] for row in series])
    for key, value in stats.items():
        setattr(coin, key, value)

    db.commit()


def sync_coins(db: DBSession, client: BinanceClient, progress=None) -> int:
    logger.info("Starting sync_coins...")
    pairs = client.fetch_symbols()
    created = 0

    for index, pair in enumerate(pairs, start=1):
        symbol = pair["symbol"]
        if db.get(Coin, symbol) is None:
            try:
                first_kline = client.fetch_first_kline(symbol)
            except BinanceError as exc:
                logger.warning("Skipping %s: %s", symbol, exc)
                first_kline = None

            if first_kline:
                listing_date = from_millis(first_kline[0])
                coin = Coin(
                    symbol=symbol,
                    listing_date=listing_date,
                    is_pre_2021=listing_date < EVENT_CUTOFF,
                    listed_checked=True,
                )
                db.add(coin)
                db.commit()
                created += 1
                time.sleep(REQUEST_DELAY)

        if progress:
            progress("coins", index, len(pairs))

    logger.info("sync_coins done: %s new symbols (of %s tracked pairs).", created, len(pairs))
    return created


def fetch_btc_daily_rates(client: BinanceClient) -> dict:
    """Daily BTCUSDT high/low/close keyed by candle open time (ms)."""
    rates = {}
    start_time = 0

    while True:
        rows = client.fetch_klines("BTCUSDT", start_time=start_time)
        if not rows:
            break
        for row in rows:
            rates[row[0]] = (float(row[2]), float(row[3]), float(row[4]))
        if len(rows) < KLINES_LIMIT:
            break
        next_start = rows[-1][0] + 1
        if next_start <= start_time:
            break
        start_time = next_start
        time.sleep(REQUEST_DELAY)

    return rates


def convert_usdt_klines_to_btc(rows: list, btc_rates: dict) -> list:
    """Convert USDT-quoted candles to BTC parity using BTCUSDT daily rates.

    Ratio bounds are exact for the day: low_usdt/high_btc <= ratio <= high_usdt/low_btc.
    """
    converted = []
    for row in rows:
        rate = btc_rates.get(row[0])
        if not rate:
            continue
        btc_high, btc_low, btc_close = rate
        if not btc_high or not btc_low or not btc_close:
            continue

        open_usdt, high_usdt, low_usdt, close_usdt = (
            float(row[1]),
            float(row[2]),
            float(row[3]),
            float(row[4]),
        )
        quote_volume = float(row[5]) * close_usdt

        converted.append(
            [
                row[0],
                open_usdt / btc_close,
                high_usdt / btc_low,
                low_usdt / btc_high,
                close_usdt / btc_close,
                quote_volume / btc_close,
            ]
        )
    return converted


def _sync_coin_klines(db: DBSession, coin: Coin, client: BinanceClient, btc_rates) -> None:
    quote = coin.quote_asset
    if quote == "USDT" and not btc_rates:
        return

    first_timestamp = db.query(func.min(Kline.timestamp)).filter(Kline.symbol == coin.symbol).scalar()
    last_timestamp = db.query(func.max(Kline.timestamp)).filter(Kline.symbol == coin.symbol).scalar()

    # Backfill when stored history starts noticeably after the listing date
    # (e.g. databases created by older versions that only kept the latest
    # 1000 candles).
    needs_backfill = first_timestamp is None or (
        coin.listing_date is not None and first_timestamp > coin.listing_date + BACKFILL_TOLERANCE
    )
    start_time = 0 if needs_backfill else to_millis(last_timestamp)

    while True:
        raw_rows = client.fetch_klines(coin.symbol, start_time=start_time)
        if not raw_rows:
            break

        next_start = raw_rows[-1][0] + 1
        rows = convert_usdt_klines_to_btc(raw_rows, btc_rates) if quote == "USDT" else raw_rows
        if rows:
            upsert_klines(db, coin.symbol, rows)

        if len(raw_rows) < KLINES_LIMIT:
            break
        if next_start <= start_time:
            break

        start_time = next_start
        time.sleep(REQUEST_DELAY)

    update_coin_metrics(db, coin)


def _sync_coin_worker(session_factory, symbol: str, client: BinanceClient, btc_rates) -> None:
    db = session_factory()
    try:
        coin = db.get(Coin, symbol)
        if coin is None:
            return
        _sync_coin_klines(db, coin, client, btc_rates)
    except BinanceError as exc:
        logger.warning("Skipping klines for %s: %s", symbol, exc)
    except Exception as exc:  # one bad coin must not kill the pool
        logger.warning("Unexpected error while syncing %s: %s", symbol, exc)
    finally:
        db.close()


def upsert_btc_rates(db: DBSession, rates: dict) -> int:
    """Persist daily BTCUSDT candles for USD conversions (idempotent)."""
    if not rates:
        return 0

    values = [
        {"timestamp": from_millis(millis), "high": high, "low": low, "close": close}
        for millis, (high, low, close) in rates.items()
    ]
    for chunk in chunked(values, UPSERT_CHUNK_SIZE):
        statement = sqlite_insert(BtcRate).values(chunk)
        statement = statement.on_conflict_do_update(
            index_elements=[BtcRate.timestamp],
            set_={
                "high": statement.excluded.high,
                "low": statement.excluded.low,
                "close": statement.excluded.close,
            },
        )
        db.execute(statement)
    db.commit()
    return len(values)


def sync_klines(
    db: DBSession,
    client: BinanceClient,
    progress=None,
    workers: int = 1,
    session_factory=None,
) -> None:
    logger.info("Starting sync_klines...")
    coins = (
        db.query(Coin)
        .filter(or_(Coin.is_pre_2021.is_(True), Coin.market_cap >= MIN_TRACKED_MARKET_CAP))
        .all()
    )
    btc_rates = None

    if any(coin.quote_asset == "USDT" for coin in coins):
        logger.info("Fetching BTCUSDT daily rates for parity conversion...")
        try:
            btc_rates = fetch_btc_daily_rates(client)
        except BinanceError as exc:
            logger.warning("Cannot load BTC rates, skipping USDT pairs: %s", exc)
            btc_rates = {}

    if btc_rates:
        try:
            upsert_btc_rates(db, btc_rates)
            latest_rate = btc_rates[max(btc_rates)]
            set_meta(db, "btc_usd_price", str(latest_rate[2]))
        except Exception:
            logger.exception("Could not persist BTC rates; continuing without USD conversion.")

    parallel = workers > 1 and session_factory is not None

    if parallel:
        logger.info("Syncing %s coins with %s workers...", len(coins), workers)
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [
                executor.submit(_sync_coin_worker, session_factory, coin.symbol, client, btc_rates)
                for coin in coins
            ]
            for index, future in enumerate(as_completed(futures), start=1):
                future.result()
                if progress:
                    progress("klines", index, len(coins))
    else:
        for index, coin in enumerate(coins, start=1):
            try:
                _sync_coin_klines(db, coin, client, btc_rates)
            except BinanceError as exc:
                logger.warning("Skipping klines for %s: %s", coin.symbol, exc)
            finally:
                if progress:
                    progress("klines", index, len(coins))

    logger.info("sync_klines done for %s coins.", len(coins))


MAX_CANDIDATES_PER_SYMBOL = 25


def _market_cap(market: dict) -> float:
    cap = market.get("market_cap")
    return cap if isinstance(cap, (int, float)) else -1.0


def _resolve_ambiguous(
    db: DBSession,
    client: CoinGeckoClient,
    ambiguous: list,
) -> None:
    """Pick the most likely id for symbols mapping to multiple CoinGecko ids.

    Candles come from Binance, so the Binance BTC price is the strongest
    signal: prefer the candidate whose CoinGecko price is closest. Market cap
    ranking is the fallback when prices are unavailable.
    """
    candidate_ids = []
    for _, candidates in ambiguous:
        for candidate in candidates:
            if candidate not in candidate_ids:
                candidate_ids.append(candidate)

    caps = {}
    for batch in chunked(candidate_ids, COINGECKO_MARKETS_BATCH_SIZE):
        try:
            markets = client.fetch_markets(batch)
        except CoinGeckoError as exc:
            logger.warning("Could not rank CoinGecko candidates: %s", exc)
            continue
        for market in markets:
            caps[market.get("id")] = _market_cap(market)
        time.sleep(COINGECKO_BATCH_DELAY)

    prices = {}
    try:
        prices = client.fetch_btc_prices(candidate_ids)
    except CoinGeckoError as exc:
        logger.warning("Could not fetch candidate prices: %s", exc)

    for coin, candidates in ambiguous:
        reference = coin.current_price_btc
        if reference:
            matching = [
                candidate
                for candidate in candidates
                if prices.get(candidate)
                and abs(prices[candidate] - reference) / reference * 100 <= PRICE_VERIFY_TOLERANCE_PCT * 2
            ]
            if matching:
                # When several ids match on price (e.g. bridged/wrapped
                # variants), prefer the largest market cap.
                best = max(matching, key=lambda candidate: caps.get(candidate, -1.0))
                coin.coingecko_id = best
                logger.info(
                    "Resolved %s to CoinGecko id '%s' by price (of %s)",
                    coin.symbol,
                    best,
                    ", ".join(candidates),
                )
                continue

        ranked = sorted(candidates, key=lambda candidate: caps.get(candidate, -1.0), reverse=True)
        coin.coingecko_id = ranked[0]
        logger.info(
            "Resolved %s to CoinGecko id '%s' by market cap (of %s)",
            coin.symbol,
            ranked[0],
            ", ".join(candidates),
        )
    db.commit()


def sync_coingecko(db: DBSession, client: CoinGeckoClient, progress=None) -> None:
    logger.info("Starting sync_coingecko...")
    try:
        coin_list = client.fetch_coin_list()
    except CoinGeckoError as exc:
        logger.warning("Skipping CoinGecko metadata sync: %s", exc)
        return

    symbol_map = {}
    for entry in coin_list:
        symbol = entry.get("symbol", "").lower()
        coin_id = entry.get("id")
        if not symbol or not coin_id:
            continue
        candidates = symbol_map.setdefault(symbol, [])
        if coin_id not in candidates and len(candidates) < MAX_CANDIDATES_PER_SYMBOL:
            candidates.append(coin_id)

    coins = db.query(Coin).all()
    ambiguous = []
    for coin in coins:
        candidates = symbol_map.get(coin.base_asset.lower(), [])
        if not candidates:
            continue

        if len(candidates) == 1:
            if not coin.coingecko_id or coin.price_verified is False:
                coin.coingecko_id = candidates[0]
            continue

        # Multiple symbols collide: re-resolve deterministically every sync
        # (price match first, then market cap) so bridged/wrapped variants
        # never win over the canonical token.
        ambiguous.append((coin, candidates))
    db.commit()

    if ambiguous:
        _resolve_ambiguous(db, client, ambiguous)

    cg_ids = []
    for coin in coins:
        if coin.coingecko_id and coin.coingecko_id not in cg_ids:
            cg_ids.append(coin.coingecko_id)

    batches = list(chunked(cg_ids, COINGECKO_MARKETS_BATCH_SIZE))
    for index, batch in enumerate(batches, start=1):
        try:
            markets = client.fetch_markets(batch)
        except CoinGeckoError as exc:
            logger.warning("Skipping CoinGecko markets batch: %s", exc)
            continue

        by_id = {market.get("id"): market for market in markets}
        for coin in db.query(Coin).filter(Coin.coingecko_id.in_(batch)).all():
            market = by_id.get(coin.coingecko_id)
            if not market:
                continue
            coin.name = market.get("name") or coin.name
            coin.logo_url = market.get("image") or coin.logo_url
            coin.market_cap = market.get("market_cap")
            coin.volume_24h = market.get("total_volume")
        db.commit()
        time.sleep(COINGECKO_BATCH_DELAY)
        if progress:
            progress("metadata", index, len(batches))

    logger.info("sync_coingecko done for %s coins.", len(cg_ids))


def sync_stable_flags(db: DBSession, client: CoinGeckoClient) -> int:
    """Flag stablecoins and tokenized-gold style pegged assets.

    Primary signal: CoinGecko category membership. Fallback: symbol/name
    heuristic so assets without a mapped id are still caught.
    """
    stable_ids = set()
    for category in STABLE_CATEGORIES:
        try:
            stable_ids |= client.fetch_category_ids(category)
        except CoinGeckoError as exc:
            logger.warning("Could not load category '%s': %s", category, exc)

    coins = db.query(Coin).all()
    marked = 0
    for coin in coins:
        flagged = bool(coin.coingecko_id and coin.coingecko_id in stable_ids) or is_probably_stable(
            coin.base_asset, coin.name
        )
        coin.is_stable = flagged
        if flagged:
            marked += 1
    db.commit()

    logger.info("sync_stable_flags done: %s/%s coins flagged as stable/pegged.", marked, len(coins))
    return marked


def set_meta(db: DBSession, key: str, value: str) -> None:
    meta = db.get(Meta, key)
    if meta is None:
        meta = Meta(key=key)
        db.add(meta)
    meta.value = value
    db.commit()


def write_sync_progress(db: DBSession, phase: str, processed: int, total: int) -> None:
    payload = {
        "phase": phase,
        "processed": processed,
        "total": total,
        "updated_at": utcnow().isoformat(),
    }
    set_meta(db, "sync_progress", json.dumps(payload))


def verify_prices(db: DBSession, client: CoinGeckoClient) -> int:
    """Cross-check Binance BTC prices against CoinGecko (keyless endpoint)."""
    logger.info("Starting verify_prices...")
    coins = db.query(Coin).filter(Coin.current_price_btc.isnot(None), Coin.coingecko_id.isnot(None)).all()
    if not coins:
        return 0

    coin_ids = sorted({coin.coingecko_id for coin in coins})
    try:
        reference_prices = client.fetch_btc_prices(coin_ids)
    except CoinGeckoError as exc:
        logger.warning("Price verification skipped: %s", exc)
        return 0

    verified = 0
    for coin in coins:
        reference = reference_prices.get(coin.coingecko_id)
        if not reference or not coin.current_price_btc:
            coin.price_verified = None
            coin.price_deviation_pct = None
            continue
        deviation = abs(reference - coin.current_price_btc) / coin.current_price_btc * 100
        coin.price_deviation_pct = round(deviation, 2)
        coin.price_verified = deviation <= PRICE_VERIFY_TOLERANCE_PCT
        if coin.price_verified:
            verified += 1

    db.commit()
    set_meta(db, "prices_verified_at", utcnow().isoformat())
    logger.info(
        "verify_prices done: %s/%s coins within %.1f%%.",
        verified,
        len(coins),
        PRICE_VERIFY_TOLERANCE_PCT,
    )
    return verified


def run_all_syncs(
    db: DBSession,
    binance: BinanceClient = None,
    coingecko: CoinGeckoClient = None,
) -> None:
    client = binance or BinanceClient()
    cg_client = coingecko or CoinGeckoClient()

    state = {"last_write": 0.0}

    def progress(phase: str, processed: int, total: int) -> None:
        now = time.monotonic()
        # Throttle writes: at most one update per second, always keep the last.
        if processed < total and now - state["last_write"] < 1.0:
            return
        state["last_write"] = now
        write_sync_progress(db, phase, processed, total)

    sync_coins(db, client, progress)
    # Metadata (market caps) must run before klines so the market-cap
    # threshold can gate post-2021 coins on the very first sync.
    sync_coingecko(db, cg_client, progress)
    sync_stable_flags(db, cg_client)
    sync_klines(
        db,
        client,
        progress,
        workers=SYNC_FETCH_WORKERS,
        session_factory=SessionLocal if SYNC_FETCH_WORKERS > 1 else None,
    )
    verify_prices(db, cg_client)
    write_sync_progress(db, "done", 1, 1)
    set_meta(db, "last_updated", utcnow().isoformat())


def run_sync_with_lock() -> bool:
    """Run a full sync guarded by a cross-process lock.

    Returns False when another sync is already running.
    """
    db = SessionLocal()
    try:
        if not try_acquire_lock(db):
            logger.info("Another sync is already running; skipping.")
            return False
        try:
            run_all_syncs(db)
            try:
                check_alerts(db)
            except Exception:
                logger.exception("Alert evaluation failed; continuing.")
            set_meta(db, "last_sync_status", "success")
            return True
        except Exception as exc:
            set_meta(db, "last_sync_status", f"error: {exc}")
            set_meta(
                db,
                "sync_progress",
                json.dumps(
                    {
                        "phase": "error",
                        "processed": 0,
                        "total": 1,
                        "message": str(exc),
                        "updated_at": utcnow().isoformat(),
                    }
                ),
            )
            raise
        finally:
            release_lock(db)
    finally:
        db.close()
