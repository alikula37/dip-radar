from models import split_symbol


def test_split_symbol_btc_pair():
    assert split_symbol("ETHBTC") == ("ETH", "BTC")


def test_split_symbol_usdt_pair():
    assert split_symbol("XLMUSDT") == ("XLM", "USDT")


def test_split_symbol_without_known_quote():
    assert split_symbol("WEIRD") == ("WEIRD", None)


def test_coin_base_and_quote_asset():
    from models import Coin

    coin = Coin(symbol="XLMUSDT")
    assert coin.base_asset == "XLM"
    assert coin.quote_asset == "USDT"

    legacy = Coin(symbol="ETHBTC")
    assert legacy.base_asset == "ETH"
    assert legacy.quote_asset == "BTC"
