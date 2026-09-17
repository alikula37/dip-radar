import pytest

from metrics import (
    MAX_BUBBLE_SIZE,
    MIN_BUBBLE_SIZE,
    calculate_bubble_sizes,
    calculate_coin_stats,
    calculate_distance_pct,
    calculate_value_scores,
    dip_respect,
)


class DummyCoin:
    def __init__(self, market_cap, distance_pct_event=0.0, distance_pct_atl=0.0):
        self.market_cap = market_cap
        self.distance_pct_event = distance_pct_event
        self.distance_pct_atl = distance_pct_atl
        self.bubble_size_event = None
        self.bubble_size_atl = None


def test_calculate_distance_pct():
    assert calculate_distance_pct(150, 100) == 50.0
    assert calculate_distance_pct(100, 100) == 0.0
    assert calculate_distance_pct(50, 100) == -50.0
    assert calculate_distance_pct(0, 100) == 0.0
    assert calculate_distance_pct(100, 0) == 0.0
    assert calculate_distance_pct(None, 100) == 0.0


def test_bubble_sizes_are_proportional_to_market_cap():
    coins = [
        DummyCoin(1_000_000),
        DummyCoin(4_000_000),
        DummyCoin(9_000_000),
    ]

    calculate_bubble_sizes(coins, use_atl=False)

    # sqrt scaling: sqrt(1/9) -> 40, sqrt(4/9) -> 70, max -> 100
    assert coins[2].bubble_size_event == MAX_BUBBLE_SIZE
    assert coins[0].bubble_size_event == pytest.approx(40.0)
    assert coins[1].bubble_size_event == pytest.approx(70.0)
    assert coins[0].bubble_size_event < coins[1].bubble_size_event < coins[2].bubble_size_event


def test_bubble_size_does_not_depend_on_selected_distance():
    coins = [DummyCoin(1_000, distance_pct_event=-40.0, distance_pct_atl=200.0)]

    calculate_bubble_sizes(coins, use_atl=False)
    calculate_bubble_sizes(coins, use_atl=True)

    assert coins[0].bubble_size_event == coins[0].bubble_size_atl


def test_bubble_size_without_market_cap_uses_minimum():
    coins = [DummyCoin(None), DummyCoin(0), DummyCoin(5_000_000)]

    calculate_bubble_sizes(coins)

    assert coins[0].bubble_size_event == MIN_BUBBLE_SIZE
    assert coins[1].bubble_size_event == MIN_BUBBLE_SIZE
    assert coins[2].bubble_size_event == MAX_BUBBLE_SIZE


def test_coin_stats_percentiles_median_range_and_trend():
    closes = [float(value) for value in range(1, 201)]
    lows = [float(value) for value in range(1, 201)]

    stats = calculate_coin_stats(closes, lows)

    assert stats["history_days"] == 200
    assert stats["valuation_pct_1y"] == 100.0
    assert stats["valuation_pct_all"] == 100.0
    assert stats["valuation_pct_3y"] is None
    assert stats["median_dist_1y"] == pytest.approx((200 - 100.5) / 100.5 * 100, abs=0.1)
    assert stats["range_position"] == 1.0
    assert stats["days_since_atl"] == 199
    assert stats["trend_30d_pct"] == pytest.approx((200 / 170 - 1) * 100, abs=0.1)
    assert stats["above_sma200"] is True


def test_coin_stats_basing_and_short_history():
    closes = [100.0] * 110 + [10.0] * 90
    lows = [100.0] * 110 + [10.0] * 90

    stats = calculate_coin_stats(closes, lows)

    assert stats["basing_pct_90d"] == 100.0
    assert stats["median_dist_1y"] == pytest.approx(-90.0)
    assert stats["range_position"] == 0.0
    assert stats["days_since_atl"] == 89
    assert stats["trend_30d_pct"] == 0.0

    short = calculate_coin_stats([1.0] * 30, [1.0] * 30)
    assert short["history_days"] == 30
    assert short["valuation_pct_1y"] is None
    assert short["basing_pct_90d"] is None
    assert short["range_position"] is None
    assert short["days_since_atl"] == 29


class ScoreCoin:
    def __init__(self, **overrides):
        self.is_stable = False
        self.market_cap = 1_000_000_000
        self.volume_24h = 10_000_000
        self.valuation_pct_1y = 10.0
        self.valuation_pct_3y = 10.0
        self.valuation_pct_all = 10.0
        self.median_dist_3y = -50.0
        self.distance_pct_event = 20.0
        self.basing_pct_90d = 50.0
        self.range_position = 0.2
        self.trend_30d_pct = 0.0
        self.trend_90d_pct = 0.0
        self.dip_bounces = 0
        self.dip_bounce_avg = None
        self.value_score = None
        self.value_parts = None
        for key, value in overrides.items():
            setattr(self, key, value)


def test_value_score_ranks_cheap_above_expensive():
    cheap = ScoreCoin()
    expensive = ScoreCoin(
        valuation_pct_1y=90.0,
        valuation_pct_3y=90.0,
        valuation_pct_all=90.0,
        median_dist_3y=120.0,
        distance_pct_event=300.0,
        basing_pct_90d=0.0,
        range_position=0.95,
    )

    calculate_value_scores([cheap, expensive])

    assert cheap.value_score is not None
    assert 0 <= cheap.value_score <= 100
    assert cheap.value_score > expensive.value_score
    assert set(cheap.value_parts) == {"valuation", "distance", "median_gap", "basing", "range", "dip_respect", "knife"}


def test_dip_respect_counts_successful_bounces_only():
    # Two identical dips, each rallied over 30% within the window, then a third
    # touch that is still at the low (no forward bounce yet).
    closes = []
    for _ in range(3):
        closes.extend([100.0] * 40 + [70.0] * 10 + [130.0] * 40)
    closes.extend([70.0] * 10)
    lows = [value * 0.98 for value in closes]

    touches, bounces, average = dip_respect(closes, lows)

    # Three rallying touches plus the still-open trailing one at the low.
    assert touches == 4
    assert bounces == 3
    assert average is not None and average > 30.0


def test_dip_respect_is_zero_for_new_or_untouched_coins():
    # Too little history to judge.
    assert dip_respect([100.0] * 100, [98.0] * 100) == (0, 0, None)

    # A coin sitting at its low with no rally yet: a touch, no proven bounce.
    closes = [100.0 - 0.25 * index for index in range(200)]
    lows = [value * 0.98 for value in closes]

    touches, bounces, average = dip_respect(closes, lows)

    assert touches >= 1
    assert bounces == 0
    assert average is None


def test_dip_respect_tilts_the_value_score():
    proven = ScoreCoin(dip_bounces=4, dip_bounce_avg=120.0)
    newcomer = ScoreCoin(dip_bounces=0, dip_bounce_avg=None)

    calculate_value_scores([proven, newcomer])

    assert proven.value_score > newcomer.value_score
    assert proven.value_parts["dip_respect"] != 0.0


def test_value_score_knife_penalty():
    calm = ScoreCoin()
    knife = ScoreCoin(trend_30d_pct=-45.0)

    calculate_value_scores([calm, knife])

    assert knife.value_parts["knife"] == -10.0
    # The headline score is the cross-sectional percentile of the composite,
    # so the penalized coin simply ranks below the calm one.
    assert knife.value_score < calm.value_score


def test_value_score_gates_low_cap_short_history_and_stables():
    low_cap = ScoreCoin(market_cap=1_000_000)
    short_history = ScoreCoin(valuation_pct_3y=None)
    stable = ScoreCoin(is_stable=True)

    calculate_value_scores([low_cap, short_history, stable])

    assert low_cap.value_score is None
    assert short_history.value_score is None
    assert stable.value_score is None
