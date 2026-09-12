import pytest

from metrics import MAX_BUBBLE_SIZE, MIN_BUBBLE_SIZE, calculate_bubble_sizes, calculate_distance_pct


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
