import math

MIN_BUBBLE_SIZE = 10.0
MAX_BUBBLE_SIZE = 100.0


def calculate_distance_pct(current_price: float, reference_low: float) -> float:
    if not current_price or not reference_low:
        return 0.0
    return ((current_price - reference_low) / reference_low) * 100.0


def calculate_bubble_sizes(coins: list, use_atl: bool = False) -> None:
    """Size bubbles by market cap (square-root scale), per the README spec.

    The `use_atl` flag is kept for API compatibility: bubble size no longer
    depends on the selected reference distance, which drives the bubble color
    on the frontend instead.
    """
    caps = [c.market_cap for c in coins if c.market_cap and c.market_cap > 0]
    max_cap = max(caps) if caps else None
    sqrt_max = math.sqrt(max_cap) if max_cap else None

    for coin in coins:
        size = MIN_BUBBLE_SIZE
        if sqrt_max and coin.market_cap and coin.market_cap > 0:
            normalized = math.sqrt(coin.market_cap) / sqrt_max
            size = MIN_BUBBLE_SIZE + normalized * (MAX_BUBBLE_SIZE - MIN_BUBBLE_SIZE)

        if use_atl:
            coin.bubble_size_atl = round(size, 2)
        else:
            coin.bubble_size_event = round(size, 2)
