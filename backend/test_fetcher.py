from datetime import datetime

import pytest
import requests
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker

import fetcher
from database import Base
from models import Coin, Kline
from timeutils import to_millis


class FakeResponse:
    def __init__(self, status_code=200, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.headers = headers or {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")


class FakeSession:
    """Routes requests to a responder callable and records every call."""

    def __init__(self, responder):
        self.responder = responder
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params))
        result = self.responder(url, params)
        if isinstance(result, Exception):
            raise result
        return result


class FakeBinance:
    def __init__(self, symbols=None, first_klines=None, klines=None):
        self.symbols = symbols or []
        self.first_klines = first_klines or {}
        self.klines = klines or {}
        self.first_kline_calls = []
        self.kline_calls = []

    def fetch_symbols(self):
        return self.symbols

    def fetch_first_kline(self, symbol):
        self.first_kline_calls.append(symbol)
        return self.first_klines.get(symbol)

    def fetch_klines(self, symbol, start_time=0, limit=fetcher.KLINES_LIMIT):
        self.kline_calls.append((symbol, start_time))
        return self.klines.get(symbol, [])


class FakeCoinGecko:
    def __init__(self, coin_list=None, markets=None, prices=None, category_ids=None):
        self.coin_list = coin_list or []
        self.markets = markets or {}
        self.prices = prices or {}
        self.category_ids = category_ids or {}
        self.market_batches = []
        self.price_batches = []
        self.category_calls = []

    def fetch_coin_list(self):
        return self.coin_list

    def fetch_markets(self, ids):
        self.market_batches.append(list(ids))
        return [self.markets[cg_id] for cg_id in ids if cg_id in self.markets]

    def fetch_btc_prices(self, ids):
        self.price_batches.append(list(ids))
        return {coin_id: self.prices[coin_id] for coin_id in ids if coin_id in self.prices}

    def fetch_category_ids(self, category, max_pages=3):
        self.category_calls.append(category)
        return set(self.category_ids.get(category, set()))


def make_kline_row(timestamp_ms, open_, high, low, close, volume=1.0):
    return [timestamp_ms, str(open_), str(high), str(low), str(close), str(volume)]


def test_binance_client_falls_back_to_market_data_host():
    def responder(url, params):
        if "api.binance.com" in url:
            raise requests.ConnectionError("blocked")
        return FakeResponse(payload={"symbols": []})

    session = FakeSession(responder)
    client = fetcher.BinanceClient(session=session, sleep=lambda _: None)

    assert client.fetch_symbols() == []
    assert any("data-api.binance.vision" in url for url, _ in session.calls)


def test_binance_client_waits_on_rate_limit_then_uses_fallback():
    slept = []

    def responder(url, params):
        if "api.binance.com" in url:
            return FakeResponse(status_code=429, headers={"Retry-After": "3"})
        return FakeResponse(
            payload={
                "symbols": [
                    {"symbol": "ETHBTC", "baseAsset": "ETH", "quoteAsset": "BTC", "status": "TRADING"}
                ]
            }
        )

    session = FakeSession(responder)
    client = fetcher.BinanceClient(session=session, sleep=slept.append)

    assert client.fetch_symbols() == [{"symbol": "ETHBTC", "base": "ETH", "quote": "BTC"}]
    assert slept == [3.0]


def test_binance_fetch_symbols_prefers_btc_and_skips_stables():
    payload = {
        "symbols": [
            {"symbol": "ETHBTC", "baseAsset": "ETH", "quoteAsset": "BTC", "status": "TRADING"},
            {"symbol": "ETHUSDT", "baseAsset": "ETH", "quoteAsset": "USDT", "status": "TRADING"},
            {"symbol": "XLMUSDT", "baseAsset": "XLM", "quoteAsset": "USDT", "status": "TRADING"},
            {"symbol": "BTCUSDT", "baseAsset": "BTC", "quoteAsset": "USDT", "status": "TRADING"},
            {"symbol": "USDCUSDT", "baseAsset": "USDC", "quoteAsset": "USDT", "status": "TRADING"},
            {"symbol": "OLD BTC", "baseAsset": "OLD", "quoteAsset": "BTC", "status": "BREAK"},
        ]
    }
    session = FakeSession(lambda url, params: FakeResponse(payload=payload))
    client = fetcher.BinanceClient(session=session, sleep=lambda _: None, base_urls=["https://api.binance.com/api/v3"])

    assert client.fetch_symbols() == [
        {"symbol": "ETHBTC", "base": "ETH", "quote": "BTC"},
        {"symbol": "XLMUSDT", "base": "XLM", "quote": "USDT"},
    ]


def test_fetch_klines_always_sends_start_time():
    captured = {}

    def responder(url, params):
        captured.update(params)
        return FakeResponse(payload=[])

    client = fetcher.BinanceClient(
        session=FakeSession(responder),
        sleep=lambda _: None,
        base_urls=["https://api.binance.com/api/v3"],
    )
    client.fetch_klines("ETHBTC")

    # startTime=0 must be sent explicitly, otherwise Binance only returns the
    # latest 1000 candles instead of history from the listing date.
    assert captured["startTime"] == 0


def test_sync_klines_backfills_when_history_starts_after_listing(db):
    db.add(Coin(symbol="ETHBTC", is_pre_2021=True, listed_checked=True, listing_date=datetime(2020, 1, 1)))
    db.add(Kline(symbol="ETHBTC", timestamp=datetime(2021, 6, 1), open=1, high=1, low=1, close=1, volume=1))
    db.commit()

    client = FakeBinance(
        klines={"ETHBTC": [make_kline_row(to_millis(datetime(2020, 1, 2)), 1, 1, 1, 1)]},
    )

    fetcher.sync_klines(db, client)

    assert client.kline_calls[0] == ("ETHBTC", 0)
    assert db.query(Kline).count() == 2


def test_convert_usdt_klines_to_btc():
    rows = [make_kline_row(1000, 10, 12, 8, 11, 100)]
    btc_rates = {1000: (50.0, 40.0, 45.0)}  # high, low, close

    converted = fetcher.convert_usdt_klines_to_btc(rows, btc_rates)

    assert len(converted) == 1
    row = converted[0]
    assert row[0] == 1000
    assert row[1] == pytest.approx(10 / 45)
    assert row[2] == pytest.approx(12 / 40)
    assert row[3] == pytest.approx(8 / 50)
    assert row[4] == pytest.approx(11 / 45)
    assert row[5] == pytest.approx((100 * 11) / 45)


def test_convert_usdt_klines_skips_days_without_btc_rate():
    rows = [make_kline_row(1000, 10, 12, 8, 11)]

    assert fetcher.convert_usdt_klines_to_btc(rows, {}) == []


def test_sync_klines_converts_usdt_pairs_to_btc(db):
    db.add(Coin(symbol="XLMUSDT", is_pre_2021=True, listed_checked=True, listing_date=datetime(2019, 1, 1)))
    db.commit()

    day = to_millis(datetime(2019, 1, 2))
    client = FakeBinance(
        klines={
            "XLMUSDT": [make_kline_row(day, 0.10, 0.12, 0.08, 0.11)],
            "BTCUSDT": [make_kline_row(day, 4000, 4100, 3900, 4000)],
        }
    )

    fetcher.sync_klines(db, client)

    stored = db.query(Kline).filter(Kline.symbol == "XLMUSDT").one()
    assert stored.high == pytest.approx(0.12 / 3900)
    assert stored.low == pytest.approx(0.08 / 4100)
    assert stored.close == pytest.approx(0.11 / 4000)

    coin = db.get(Coin, "XLMUSDT")
    assert coin.current_price_btc == pytest.approx(0.11 / 4000)

    # BTC rates are persisted for USD conversions and mirrored into meta.
    from models import BtcRate

    rates = db.query(BtcRate).all()
    assert len(rates) == 1
    assert rates[0].close == pytest.approx(4000)
    meta = db.query(fetcher.Meta).filter(fetcher.Meta.key == "btc_usd_price").first()
    assert meta is not None
    assert float(meta.value) == pytest.approx(4000)


def test_upsert_klines_is_idempotent_and_updates_existing_row(db):
    row = make_kline_row(1609459200000, 1, 2, 0.5, 1.5)

    assert fetcher.upsert_klines(db, "ETHBTC", [row]) == 1
    assert fetcher.upsert_klines(db, "ETHBTC", [row]) == 1
    assert db.query(Kline).count() == 1

    updated = make_kline_row(1609459200000, 1, 2, 0.5, 1.9)
    fetcher.upsert_klines(db, "ETHBTC", [updated])

    stored = db.query(Kline).one()
    assert db.query(Kline).count() == 1
    assert stored.close == 1.9


def test_update_coin_metrics_records_7d_and_30d_prices(db):
    db.add(Coin(symbol="ETHBTC", is_pre_2021=True, listed_checked=True))
    db.commit()

    rows = [
        make_kline_row(to_millis(datetime(2024, 1, 1)), 1, 1, 1, 1.0),
        make_kline_row(to_millis(datetime(2024, 2, 15)), 2.5, 2.5, 2.5, 2.5),
        make_kline_row(to_millis(datetime(2024, 3, 10)), 3.5, 3.5, 3.5, 3.5),
        make_kline_row(to_millis(datetime(2024, 3, 31)), 4, 4, 4, 4.0),
    ]
    client = FakeBinance(klines={"ETHBTC": rows})

    fetcher.sync_klines(db, client)

    coin = db.get(Coin, "ETHBTC")
    assert coin.current_price_btc == 4.0
    # 7 days before 2024-03-31 -> last candle on/before 2024-03-24
    assert coin.price_7d_ago_btc == 3.5
    # 30 days before 2024-03-31 -> last candle on/before 2024-03-01
    assert coin.price_30d_ago_btc == 2.5


def test_verify_prices_flags_deviations(db):
    db.add(
        Coin(
            symbol="ETHBTC",
            is_pre_2021=True,
            listed_checked=True,
            coingecko_id="ethereum",
            current_price_btc=0.03275,
        )
    )
    db.add(
        Coin(
            symbol="XLMUSDT",
            is_pre_2021=True,
            listed_checked=True,
            coingecko_id="stellar",
            current_price_btc=0.000002,
        )
    )
    db.commit()

    client = FakeCoinGecko(prices={"ethereum": 0.0327, "stellar": 0.000003})

    verified = fetcher.verify_prices(db, client)

    eth = db.get(Coin, "ETHBTC")
    xlm = db.get(Coin, "XLMUSDT")
    assert eth.price_verified is True
    assert eth.price_deviation_pct < 1
    assert xlm.price_verified is False
    assert xlm.price_deviation_pct == pytest.approx(50.0)
    assert verified == 1
    assert client.price_batches == [["ethereum", "stellar"]]


def test_sync_klines_parallel_uses_session_factory(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'parallel.db'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    factory = sessionmaker(bind=engine)
    Base.metadata.create_all(engine)

    setup = factory()
    for symbol in ("ETHBTC", "LTCBTC", "XRPBTC"):
        setup.add(Coin(symbol=symbol, is_pre_2021=True, listed_checked=True))
    setup.commit()
    setup.close()

    day = to_millis(datetime(2020, 1, 1))
    client = FakeBinance(
        klines={
            symbol: [make_kline_row(day, 1, 2, 0.5, 1.5)]
            for symbol in ("ETHBTC", "LTCBTC", "XRPBTC")
        }
    )

    db = factory()
    fetcher.sync_klines(db, client, workers=3, session_factory=factory)
    db.close()

    check = factory()
    assert check.query(Kline).count() == 3
    assert check.get(Coin, "ETHBTC").current_price_btc == 1.5
    check.close()


def test_sync_klines_resumes_from_last_candle_and_computes_metrics(db):
    db.add(Coin(symbol="ETHBTC", is_pre_2021=True, listed_checked=True))
    db.commit()

    rows = [
        make_kline_row(to_millis(datetime(2020, 1, 1)), 1, 2, 1, 1.5),
        make_kline_row(to_millis(datetime(2021, 6, 1)), 0.6, 0.7, 0.5, 0.6),
    ]
    client = FakeBinance(klines={"ETHBTC": rows})

    fetcher.sync_klines(db, client)
    fetcher.sync_klines(db, client)

    assert db.query(Kline).count() == 2
    assert client.kline_calls[1] == ("ETHBTC", to_millis(datetime(2021, 6, 1)))

    coin = db.get(Coin, "ETHBTC")
    assert coin.current_price_btc == 0.6
    assert coin.all_time_low == 0.5
    assert coin.event_low == 0.5
    assert coin.distance_pct_atl == pytest.approx(20.0)
    assert coin.distance_pct_event == pytest.approx(20.0)


def test_sync_coins_stores_post_2021_symbols_once(db):
    client = FakeBinance(
        symbols=[
            {"symbol": "ETHBTC", "base": "ETH", "quote": "BTC"},
            {"symbol": "NEWBTC", "base": "NEW", "quote": "BTC"},
        ],
        first_klines={
            "ETHBTC": make_kline_row(to_millis(datetime(2017, 1, 1)), 1, 1, 1, 1),
            "NEWBTC": make_kline_row(to_millis(datetime(2023, 5, 1)), 1, 1, 1, 1),
        },
    )

    assert fetcher.sync_coins(db, client) == 2
    assert len(client.first_kline_calls) == 2

    eth = db.get(Coin, "ETHBTC")
    new = db.get(Coin, "NEWBTC")
    assert eth.is_pre_2021 is True
    assert new.is_pre_2021 is False
    assert new.listed_checked is True

    # Second run must not re-check symbols that are already stored.
    fetcher.sync_coins(db, client)
    assert len(client.first_kline_calls) == 2


def test_is_probably_stable_heuristic():
    assert fetcher.is_probably_stable("USDS")
    assert fetcher.is_probably_stable("XAUT", "Tether Gold")
    assert fetcher.is_probably_stable("DAI")
    assert fetcher.is_probably_stable("FOO", "Acme Stablecoin")
    assert not fetcher.is_probably_stable("GRAM", "Gram (prev. Toncoin)")
    assert not fetcher.is_probably_stable("ETH", "Ethereum")
    assert not fetcher.is_probably_stable("USUAL", "Usual")
    assert not fetcher.is_probably_stable("", None)


def test_sync_stable_flags_combines_categories_and_heuristic(db):
    db.add(Coin(symbol="USDSUSDT", coingecko_id="usds", name="USDS"))
    db.add(Coin(symbol="XAUTBTC", coingecko_id="tether-gold", name="Tether Gold"))
    db.add(Coin(symbol="GRAMUSDT", coingecko_id="the-open-network", name="Gram (prev. Toncoin)"))
    db.add(Coin(symbol="RLUSDUSDT", coingecko_id=None, name=None))
    db.commit()

    cg = FakeCoinGecko(category_ids={"stablecoins": {"usds"}, "tokenized-gold": {"tether-gold"}})

    marked = fetcher.sync_stable_flags(db, cg)

    assert marked == 3
    assert db.get(Coin, "USDSUSDT").is_stable is True
    assert db.get(Coin, "XAUTBTC").is_stable is True
    assert db.get(Coin, "RLUSDUSDT").is_stable is True
    assert db.get(Coin, "GRAMUSDT").is_stable is False
    assert cg.category_calls == ["stablecoins", "tokenized-gold"]


def test_sync_coingecko_maps_ids_and_updates_metadata(db):
    db.add(Coin(symbol="ETHBTC", is_pre_2021=True, listed_checked=True))
    db.commit()

    cg = FakeCoinGecko(
        coin_list=[{"symbol": "eth", "id": "ethereum"}],
        markets={
            "ethereum": {
                "id": "ethereum",
                "name": "Ethereum",
                "image": "https://example.com/eth.png",
                "market_cap": 123456,
                "total_volume": 789,
            }
        },
    )

    fetcher.sync_coingecko(db, cg)

    coin = db.get(Coin, "ETHBTC")
    assert coin.coingecko_id == "ethereum"
    assert coin.name == "Ethereum"
    assert coin.market_cap == 123456
    assert coin.volume_24h == 789
    assert cg.market_batches == [["ethereum"]]


def test_sync_klines_tracks_post_2021_coins_only_above_market_cap_threshold(db, monkeypatch):
    monkeypatch.setattr(fetcher, "MIN_TRACKED_MARKET_CAP", 10_000_000)
    db.add(Coin(symbol="SUIBTC", is_pre_2021=False, listed_checked=True, market_cap=5_000_000_000))
    db.add(Coin(symbol="JUNKBTC", is_pre_2021=False, listed_checked=True, market_cap=1_000_000))
    db.commit()

    day = to_millis(datetime(2023, 5, 3))
    client = FakeBinance(
        klines={
            "SUIBTC": [make_kline_row(day, 1e-5, 1.1e-5, 0.9e-5, 1e-5)],
            "JUNKBTC": [make_kline_row(day, 1, 1, 1, 1)],
        }
    )

    fetcher.sync_klines(db, client)

    assert db.query(Kline).filter(Kline.symbol == "SUIBTC").count() == 1
    assert db.query(Kline).filter(Kline.symbol == "JUNKBTC").count() == 0
    assert db.get(Coin, "SUIBTC").current_price_btc is not None
    assert db.get(Coin, "JUNKBTC").current_price_btc is None


def test_sync_coingecko_maps_post_2021_coins(db):
    db.add(Coin(symbol="ICPUSDT", is_pre_2021=False, listed_checked=True))
    db.commit()

    cg = FakeCoinGecko(
        coin_list=[{"symbol": "icp", "id": "internet-computer"}],
        markets={
            "internet-computer": {
                "id": "internet-computer",
                "name": "Internet Computer",
                "image": "https://example.com/icp.png",
                "market_cap": 4_000_000_000,
                "total_volume": 100_000_000,
            }
        },
    )

    fetcher.sync_coingecko(db, cg)

    coin = db.get(Coin, "ICPUSDT")
    assert coin.coingecko_id == "internet-computer"
    assert coin.market_cap == 4_000_000_000


def test_sync_coingecko_disambiguates_by_market_cap(db):
    db.add(Coin(symbol="SANDBTC", is_pre_2021=True, listed_checked=True))
    db.commit()

    cg = FakeCoinGecko(
        coin_list=[
            {"symbol": "sand", "id": "the-sandbox"},
            {"symbol": "sand", "id": "sandbox-old"},
        ],
        markets={
            "the-sandbox": {"id": "the-sandbox", "name": "The Sandbox", "market_cap": 100},
            "sandbox-old": {"id": "sandbox-old", "name": "Old Sandbox", "market_cap": 5000},
        },
    )

    fetcher.sync_coingecko(db, cg)

    coin = db.get(Coin, "SANDBTC")
    assert coin.coingecko_id == "sandbox-old"
    assert coin.name == "Old Sandbox"


def test_sync_coingecko_resolves_by_price_before_market_cap(db):
    db.add(
        Coin(
            symbol="DOTBTC",
            is_pre_2021=True,
            listed_checked=True,
            current_price_btc=1.32e-05,
        )
    )
    db.commit()

    cg = FakeCoinGecko(
        coin_list=[
            {"symbol": "dot", "id": "dot"},
            {"symbol": "dot", "id": "binance-peg-polkadot"},
            {"symbol": "dot", "id": "polkadot"},
        ],
        markets={
            "dot": {"id": "dot", "name": "Dotcoin", "market_cap": 10_000_000_000},
            "binance-peg-polkadot": {"id": "binance-peg-polkadot", "name": "Binance-Peg Polkadot", "market_cap": 100_000_000},
            "polkadot": {"id": "polkadot", "name": "Polkadot", "market_cap": 5_000_000_000},
        },
        prices={"dot": 0.0001, "binance-peg-polkadot": 1.32e-05, "polkadot": 1.32e-05},
    )

    fetcher.sync_coingecko(db, cg)

    coin = db.get(Coin, "DOTBTC")
    # Both polkadot and the pegged variant match on price; the larger cap wins.
    assert coin.coingecko_id == "polkadot"
    assert coin.name == "Polkadot"


def test_sync_coingecko_reresolves_unverified_mappings(db):
    db.add(
        Coin(
            symbol="DOTBTC",
            is_pre_2021=True,
            listed_checked=True,
            current_price_btc=1.32e-05,
            coingecko_id="dot",
            price_verified=False,
        )
    )
    db.commit()

    cg = FakeCoinGecko(
        coin_list=[{"symbol": "dot", "id": "dot"}, {"symbol": "dot", "id": "polkadot"}],
        markets={
            "dot": {"id": "dot", "name": "Dotcoin", "market_cap": 10_000_000_000},
            "polkadot": {"id": "polkadot", "name": "Polkadot", "market_cap": 5_000_000_000},
        },
        prices={"dot": 0.0001, "polkadot": 1.32e-05},
    )

    fetcher.sync_coingecko(db, cg)

    assert db.get(Coin, "DOTBTC").coingecko_id == "polkadot"


def test_coingecko_markets_requests_per_page_250():
    captured = {}

    def responder(url, params):
        captured.update(params)
        return FakeResponse(payload=[])

    client = fetcher.CoinGeckoClient(session=FakeSession(responder), sleep=lambda _: None)
    client.fetch_markets(["ethereum"])

    assert captured["per_page"] == 250
    assert captured["ids"] == "ethereum"


def test_run_all_syncs_updates_meta(db):
    client = FakeBinance(
        symbols=[{"symbol": "ETHBTC", "base": "ETH", "quote": "BTC"}],
        first_klines={"ETHBTC": make_kline_row(to_millis(datetime(2017, 1, 1)), 1, 1, 1, 1)},
        klines={"ETHBTC": [make_kline_row(to_millis(datetime(2020, 1, 1)), 1, 2, 1, 1.5)]},
    )
    cg = FakeCoinGecko(coin_list=[])

    fetcher.run_all_syncs(db, binance=client, coingecko=cg)

    meta = db.query(fetcher.Meta).filter(fetcher.Meta.key == "last_updated").first()
    assert meta is not None
    assert db.query(func.count(Coin.symbol)).scalar() == 1

    progress = db.query(fetcher.Meta).filter(fetcher.Meta.key == "sync_progress").first()
    assert progress is not None
    assert '"phase": "done"' in progress.value
