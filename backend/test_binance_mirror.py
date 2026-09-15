import io
import zipfile
from datetime import datetime

import pytest

import binance_mirror
from binance_mirror import MirrorClient, MirrorError, discover_delisted, sync_delisted
from models import Coin, Kline


class FakeResponse:
    def __init__(self, status_code=200, text="", content=b""):
        self.status_code = status_code
        self.text = text
        self.content = content


class FakeSession:
    def __init__(self, responder):
        self.responder = responder
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params))
        return self.responder(url, params)


def _zip_bytes(rows, header=False):
    buffer = io.StringIO()
    if header:
        buffer.write("open_time,open,high,low,close,volume,close_time\n")
    for row in rows:
        buffer.write(",".join(str(value) for value in row) + "\n")
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as archive:
        archive.writestr("data.csv", buffer.getvalue())
    return payload.getvalue()


def _row(open_time_ms, close, close_time_ms):
    return [open_time_ms, "1", "1.2", "0.9", str(close), "100", close_time_ms, "0", "1", "0", "0", "0"]


def test_list_symbols_paginates_with_marker():
    page_one = (
        "<ListBucketResult><IsTruncated>true</IsTruncated>"
        "<NextMarker>marker-1</NextMarker>"
        "<CommonPrefixes><Prefix>data/spot/daily/klines/ETHBTC/</Prefix></CommonPrefixes>"
        "</ListBucketResult>"
    )
    page_two = (
        "<ListBucketResult><IsTruncated>false</IsTruncated>"
        "<CommonPrefixes><Prefix>data/spot/daily/klines/FTTBTC/</Prefix></CommonPrefixes>"
        "</ListBucketResult>"
    )
    seen = {}

    def responder(url, params):
        seen["params"] = params
        return FakeResponse(text=page_one if "marker" not in params else page_two)

    client = MirrorClient(session=FakeSession(responder), sleep=lambda _: None)
    symbols = client.list_symbols()

    assert symbols == ["ETHBTC", "FTTBTC"]
    assert seen["params"]["marker"] == "marker-1"


def test_fetch_month_parses_csv_and_skips_header():
    rows = [_row(1672531200000, 1.5, 1672617599999)]
    session = FakeSession(lambda url, params: FakeResponse(content=_zip_bytes(rows, header=True)))
    client = MirrorClient(session=session, sleep=lambda _: None)

    parsed = client.fetch_month("FTTBTC", 2022, 10)

    assert parsed is not None and len(parsed) == 1
    assert parsed[0][0] == 1672531200000
    assert "FTTBTC-1d-2022-10.zip" in session.calls[0][0]


def test_fetch_month_returns_none_on_missing_archive():
    client = MirrorClient(session=FakeSession(lambda url, params: FakeResponse(status_code=404)), sleep=lambda _: None)

    assert client.fetch_month("NOPE", 2020, 1) is None


def test_fetch_month_raises_on_server_error():
    client = MirrorClient(session=FakeSession(lambda url, params: FakeResponse(status_code=500)), sleep=lambda _: None)

    with pytest.raises(MirrorError):
        client.fetch_month("FTTBTC", 2020, 1)


def test_fetch_month_normalizes_microsecond_timestamps():
    rows = [_row(1753833600000000, 1.5, 1753919999999000)]
    session = FakeSession(lambda url, params: FakeResponse(content=_zip_bytes(rows)))
    client = MirrorClient(session=session, sleep=lambda _: None)

    parsed = client.fetch_month("A2ZUSDT", 2025, 7)

    assert parsed[0][0] == 1753833600000


def test_sync_delisted_skips_usdt_pairs_without_btc_rates(db):
    rows = [_row(1609459200000, 1.0, 1609545599999)]

    def responder(url, params):
        if "2021-01" in url:
            return FakeResponse(content=_zip_bytes(rows))
        return FakeResponse(status_code=404)

    client = MirrorClient(session=FakeSession(responder), sleep=lambda _: None)
    summary = sync_delisted(db, client, ["A2ZUSDT"], since=datetime(2021, 1, 1), until=datetime(2021, 3, 1), delay=0)

    assert summary["failed"] == ["A2ZUSDT"]
    assert db.get(Coin, "A2ZUSDT") is None


def test_discover_prefers_btc_pair_and_skips_active_bases():
    active = ["ETHUSDT", "NMRBTC"]
    mirror = [
        "ETHBTC",  # base is active -> skip
        "NMRUSDT",
        "NMRBTC",  # base is active -> skip
        "FTTUSDT",
        "FTTBTC",
        "FTTTRY",  # untracked quote -> skip
        "USDCUSDT",  # excluded base -> skip
    ]

    candidates = discover_delisted(active, mirror, excluded_bases={"USDC"})

    assert candidates == ["FTTBTC"]


def test_discover_filters_leveraged_tokens_legacy_tickers_and_fiat():
    active = ["ETHUSDT", "BCHUSDT", "BSVUSDT"]
    mirror = [
        "ETHUPUSDT",  # leveraged token on an active base
        "ETHDOWNUSDT",
        "BCHABCBTC",  # legacy ticker containing an active base
        "BCHSVBTC",
        "BULLUSDT",  # unknown underlying -> kept (explicit sync decides)
        "AUDUSDT",  # fiat quote
    ]

    candidates = discover_delisted(active, mirror)

    assert candidates == ["BULLUSDT"]


def test_sync_delisted_creates_archived_coin_with_candles(db):
    first = _row(1609372800000, 1.0, 1609459199999)  # 2020-12-31
    second = _row(1609459200000, 2.0, 1609545599999)  # 2021-01-01

    def responder(url, params):
        if "2021-01" in url:
            return FakeResponse(content=_zip_bytes([first, second]))
        return FakeResponse(status_code=404)

    client = MirrorClient(session=FakeSession(responder), sleep=lambda _: None)
    summary = sync_delisted(db, client, ["FTTBTC"], since=datetime(2021, 1, 1), until=datetime(2021, 3, 1), delay=0)

    assert summary == {"coins": 1, "months": 1, "rows": 2, "failed": []}
    coin = db.get(Coin, "FTTBTC")
    assert coin.delisted_at == datetime(2021, 1, 2)
    assert coin.is_pre_2021 is True
    assert coin.listed_checked is True
    assert db.query(Kline).filter(Kline.symbol == "FTTBTC").count() == 2

    # Re-running is idempotent.
    summary = sync_delisted(db, client, ["FTTBTC"], since=datetime(2021, 1, 1), until=datetime(2021, 3, 1), delay=0)
    assert summary["rows"] == 2
    assert db.query(Kline).filter(Kline.symbol == "FTTBTC").count() == 2


def test_sync_delisted_records_failures_without_data(db):
    client = MirrorClient(session=FakeSession(lambda url, params: FakeResponse(status_code=404)), sleep=lambda _: None)

    summary = sync_delisted(db, client, ["GHOSTBTC"], since=datetime(2020, 1, 1), until=datetime(2020, 3, 1), delay=0)

    assert summary == {"coins": 0, "months": 0, "rows": 0, "failed": ["GHOSTBTC"]}
    assert db.get(Coin, "GHOSTBTC") is None


def test_monthly_range_is_inclusive():
    months = list(binance_mirror._monthly_range(datetime(2021, 11, 1), datetime(2022, 2, 1)))

    assert months == [(2021, 11), (2021, 12), (2022, 1), (2022, 2)]
