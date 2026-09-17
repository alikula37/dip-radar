import bisect
import math
from statistics import median as _median

MIN_BUBBLE_SIZE = 10.0
MAX_BUBBLE_SIZE = 100.0

# Minimum history requirements for the history-based stats.
VALUATION_MIN_1Y = 180
VALUATION_MIN_3Y = 400
BASING_MIN = 180
RANGE_MIN = 30
SMA_MIN = 60

# Dip-respect detection: how often a coin actually bounced from its dip.
DIP_TOUCH_PCT = 15.0  # the trough must sit within this percentage of the running low
DIP_BOUNCE_PCT = 30.0  # a rally of at least this much counts as a proven bounce
DIP_LOOKBACK_DAYS = 120  # the trough is searched in this window before the peak
DIP_PEAK_SPAN = 30  # a peak must be the highest close of this many days
DIP_SEPARATION = 45  # accepted bounces must be at least this far apart
DIP_WINDOW_DAYS = 1095  # only the last three years count (the chart's band window)

# Value score gates and weights (cross-sectional percentile ranks).
VALUE_SCORE_MIN_CAP = 10_000_000
VALUE_SCORE_MIN_VOLUME = 250_000
VALUE_SCORE_WEIGHTS = {
    "valuation": 0.27,
    "distance": 0.22,
    "median_gap": 0.14,
    "basing": 0.13,
    "range": 0.14,
    "dip_respect": 0.10,
}


def calculate_distance_pct(current_price: float, reference_low: float) -> float:
    if not current_price or not reference_low:
        return 0.0
    return ((current_price - reference_low) / reference_low) * 100.0


def calculate_bubble_sizes(coins: list, use_atl: bool = False) -> None:
    """Size bubbles by market cap (square-root scale), per the README spec."""
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


def _percentile_rank(sorted_values: list, value: float) -> float:
    """Share of values <= value, in percent."""
    if not sorted_values:
        return 0.0
    return 100.0 * bisect.bisect_right(sorted_values, value) / len(sorted_values)


def _p25(values: list) -> float:
    ordered = sorted(values)
    return ordered[max(0, int(0.25 * len(ordered)) - 1)]


def _quantile(sorted_values: list, q: float) -> float:
    """Nearest-rank quantile of an ascending list."""
    return sorted_values[min(len(sorted_values) - 1, max(0, int(q * (len(sorted_values) - 1))))]


def calculate_coin_stats(closes: list, lows: list) -> dict:
    """History-based valuation stats from ascending daily closes/lows.

    Windows: 1y = 365 candles, 3y = 1095 candles. Windows shorter than the
    minimum history requirements return None so the UI can show "N/A".
    """
    n = len(closes)
    stats = {
        "valuation_pct_1y": None,
        "valuation_pct_3y": None,
        "valuation_pct_all": None,
        "median_dist_1y": None,
        "median_dist_3y": None,
        "range_position": None,
        "days_since_atl": None,
        "basing_pct_90d": None,
        "trend_30d_pct": None,
        "trend_90d_pct": None,
        "above_sma200": None,
        "history_days": n,
        # Dashboard-band features: where the price sits inside the last 3
        # years' distribution (the same P05/P25/P75/P95 the chart draws).
        "band_p05_dist_3y": None,
        "band_p25_dist_3y": None,
        "band_p75_dist_3y": None,
        "band_p95_dist_3y": None,
        "band_iqr_width_3y": None,
        "band_span_width_3y": None,
        "above_p75_3y": None,
        "below_p25_3y": None,
        "top_band_share_90d": None,
        # Multi-horizon trend: the model should see more than 30/90 days.
        "trend_7d_pct": None,
        "trend_180d_pct": None,
        "trend_365d_pct": None,
        # Dip respect: how often the coin bounced from its dip before.
        "dip_touches": 0,
        "dip_bounces": 0,
        "dip_bounce_avg": None,
    }
    if n == 0:
        return stats

    current = closes[-1]

    if n >= VALUATION_MIN_1Y:
        window_1y = closes[-365:]
        stats["valuation_pct_1y"] = round(_percentile_rank(sorted(window_1y), current), 1)
        stats["valuation_pct_all"] = round(_percentile_rank(sorted(closes), current), 1)
        med = _median(window_1y)
        if med:
            stats["median_dist_1y"] = round((current - med) / med * 100, 1)

    if n >= VALUATION_MIN_3Y:
        window_3y = closes[-1095:]
        stats["valuation_pct_3y"] = round(_percentile_rank(sorted(window_3y), current), 1)
        med = _median(window_3y)
        if med:
            stats["median_dist_3y"] = round((current - med) / med * 100, 1)

        ordered = sorted(window_3y)
        p05, p25, p50, p75, p95 = (_quantile(ordered, q) for q in (0.05, 0.25, 0.5, 0.75, 0.95))
        band = {}
        for name, level in (
            ("band_p05_dist_3y", p05),
            ("band_p25_dist_3y", p25),
            ("band_p75_dist_3y", p75),
            ("band_p95_dist_3y", p95),
        ):
            if level:
                band[name] = round((current - level) / level * 100, 1)
        stats.update(band)
        if p50:
            stats["band_iqr_width_3y"] = round((p75 - p25) / p50, 3)
            stats["band_span_width_3y"] = round((p95 - p05) / p50, 3)
        if p75:
            stats["above_p75_3y"] = 1 if current > p75 else 0
            window_90d = closes[-90:]
            stats["top_band_share_90d"] = round(
                100.0 * sum(1 for close in window_90d if close >= p75) / len(window_90d), 1
            )
        if p25:
            stats["below_p25_3y"] = 1 if current < p25 else 0

    if n >= RANGE_MIN:
        low_close, high_close = min(closes), max(closes)
        if high_close > low_close:
            stats["range_position"] = round((current - low_close) / (high_close - low_close), 3)
        if lows:
            stats["days_since_atl"] = n - 1 - min(range(n), key=lows.__getitem__)

    if n >= BASING_MIN:
        threshold = _p25(closes[-365:])
        window = closes[-90:]
        stats["basing_pct_90d"] = round(100.0 * sum(1 for close in window if close <= threshold) / len(window), 1)

    if n >= 31 and closes[-31]:
        stats["trend_30d_pct"] = round((current / closes[-31] - 1) * 100, 1)
    if n >= 8 and closes[-8]:
        stats["trend_7d_pct"] = round((current / closes[-8] - 1) * 100, 1)
    if n >= 91 and closes[-91]:
        stats["trend_90d_pct"] = round((current / closes[-91] - 1) * 100, 1)
    if n >= 181 and closes[-181]:
        stats["trend_180d_pct"] = round((current / closes[-181] - 1) * 100, 1)
    if n >= 366 and closes[-366]:
        stats["trend_365d_pct"] = round((current / closes[-366] - 1) * 100, 1)

    if n >= SMA_MIN:
        window = closes[-200:] if n >= 200 else closes
        stats["above_sma200"] = current > (sum(window) / len(window))

    touches, bounces, bounce_average = dip_respect(closes)
    stats["dip_touches"] = touches
    stats["dip_bounces"] = bounces
    stats["dip_bounce_avg"] = bounce_average

    return stats


def dip_respect(closes: list) -> tuple:
    """How often the coin actually bounced from its dip, point-in-time.

    A *bounce* is a rally of at least ``DIP_BOUNCE_PCT`` from a trough that sat
    at the dip: the trough (lowest close of the ``DIP_LOOKBACK_DAYS`` before the
    peak) must be within ``DIP_TOUCH_PCT`` of the running low at that time, and
    the peak must be the highest close of the ``DIP_PEAK_SPAN`` days around it.
    Bounces closer than ``DIP_SEPARATION`` days count once, and only the last
    three years are considered — the same window as the dashboard's bands.

    Returns ``(touches, bounces, average bounce %)`` where *touches* counts the
    proven bounces plus the still-open visit when the price currently sits in
    the dip zone. Coins that repeatedly defended the same dip earn a higher
    score; new coins with no reactions rank at the bottom, which is intentional.
    """
    series = closes[-DIP_WINDOW_DAYS:] if len(closes) > DIP_WINDOW_DAYS else closes
    if len(series) < DIP_LOOKBACK_DAYS + DIP_PEAK_SPAN:
        return 0, 0, None

    running = []
    low = float("inf")
    for value in series:
        low = min(low, value)
        running.append(low)

    bounces = []
    index = DIP_PEAK_SPAN
    while index < len(series):
        span_start = max(0, index - DIP_PEAK_SPAN)
        if series[index] < max(series[span_start : index + 1]):
            index += 1
            continue
        lookback_start = max(0, index - DIP_LOOKBACK_DAYS)
        trough_offset = min(range(lookback_start, index + 1), key=lambda position: series[position])
        trough = series[trough_offset]
        peak = series[index]
        in_dip = trough <= running[trough_offset] * (1.0 + DIP_TOUCH_PCT / 100.0)
        if in_dip and trough > 0 and peak / trough - 1.0 >= DIP_BOUNCE_PCT / 100.0:
            bounces.append(peak / trough - 1.0)
            index += DIP_SEPARATION
            continue
        index += 1

    average = round(100.0 * sum(bounces) / len(bounces), 1) if bounces else None
    current_in_dip = series[-1] <= running[-1] * (1.0 + DIP_TOUCH_PCT / 100.0)
    touches = len(bounces) + (1 if current_in_dip else 0)
    return touches, len(bounces), average


def _rank_percentiles(items: list, value_of) -> dict:
    """Percentile rank (0-100) by object identity, average ranks on ties."""
    ordered = sorted(items, key=value_of)
    count = len(ordered)
    result = {}
    index = 0
    while index < count:
        end = index
        while end + 1 < count and value_of(ordered[end + 1]) == value_of(ordered[index]):
            end += 1
        percentile = 100.0 * ((index + end) / 2) / (count - 1) if count > 1 else 50.0
        for position in range(index, end + 1):
            result[id(ordered[position])] = percentile
        index = end + 1
    return result


def calculate_value_scores(
    coins: list,
    min_cap: float = VALUE_SCORE_MIN_CAP,
    min_volume: float = VALUE_SCORE_MIN_VOLUME,
) -> None:
    """Transparent 0-100 composite computed cross-sectionally per request.

    Cheapness components are rank-normalized; the trend only acts as a
    knife-risk penalty (the backtest was ambiguous about momentum here).
    The liquidity gates can be relaxed (e.g. by the backtest simulator,
    which applies its own thresholds at selection time).
    """
    for coin in coins:
        coin.value_score = None
        coin.value_parts = None

    eligible = [
        coin
        for coin in coins
        if not coin.is_stable
        and coin.valuation_pct_3y is not None
        and (coin.market_cap or 0) >= min_cap
        and (coin.volume_24h or 0) >= min_volume
        and coin.distance_pct_event is not None
    ]
    if not eligible:
        return

    def valuation_raw(coin):
        p1y = coin.valuation_pct_1y if coin.valuation_pct_1y is not None else coin.valuation_pct_3y
        pall = coin.valuation_pct_all if coin.valuation_pct_all is not None else coin.valuation_pct_3y
        return -(0.5 * p1y + 0.3 * coin.valuation_pct_3y + 0.2 * pall)

    def distance_raw(coin):
        return -(coin.distance_pct_event or 0)

    def median_raw(coin):
        return -abs(coin.median_dist_3y or 0)

    def basing_raw(coin):
        return coin.basing_pct_90d or 0.0

    def range_raw(coin):
        return -(coin.range_position or 0)

    def dip_respect_raw(coin):
        # Proven bounces dominate; the average bounce size breaks ties, so a
        # coin that defended its dip many times scores highest.
        return (coin.dip_bounces or 0) + (coin.dip_bounce_avg or 0.0) / 50.0

    components = {
        "valuation": valuation_raw,
        "distance": distance_raw,
        "median_gap": median_raw,
        "basing": basing_raw,
        "range": range_raw,
        "dip_respect": dip_respect_raw,
    }
    ranks = {name: _rank_percentiles(eligible, value_of) for name, value_of in components.items()}

    for coin in eligible:
        parts = {
            name: ranks[name][id(coin)] * weight
            for name, weight in VALUE_SCORE_WEIGHTS.items()
        }
        penalty = 0.0
        if (coin.trend_30d_pct is not None and coin.trend_30d_pct < -40) or (
            coin.trend_90d_pct is not None and coin.trend_90d_pct < -60
        ):
            penalty = -10.0
        coin.value_parts = {name: round(value, 1) for name, value in parts.items()}
        coin.value_parts["knife"] = penalty
        coin.value_score = sum(parts.values()) + penalty

    # The headline score is the *cross-sectional percentile* of the composite,
    # not the raw weighted sum: a sum of percentiles is bell-shaped (almost
    # nothing above 80 or below 20), while percentiles make the score uniform
    # by construction. A score of 95 now means "cheaper than 95% of the
    # eligible universe" — high and low values are direct, comparable
    # indicators instead of compressed mid-band noise.
    composites = {id(coin): coin.value_score for coin in eligible}
    ranked = _rank_percentiles(eligible, value_of=lambda coin: composites[id(coin)])
    for coin in eligible:
        coin.value_score = round(max(0.0, min(100.0, ranked[id(coin)])), 1)
