"""Versioned score models for the Strategy Lab A/B.

The rule-based composite stays the default. Additional artifacts live in
``score_artifacts/*.json`` and are applied exactly like they were trained:
cross-sectional rank percentiles of oriented point-in-time features,
standardized with the artifact's stored scaling, then rank-normalized to
0-100 so the existing thresholds remain meaningful.

Artifacts are research outputs: they carry provenance and validation notes,
and they are only shipped as selectable options — never silently promoted.
"""

import json
import os

ARTIFACT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "score_artifacts")

FEATURE_DIRECTIONS = {
    # Larger value = higher expected forward return (+1) or lower (-1).
    "valuation_pct_1y": -1,
    "valuation_pct_3y": -1,
    "valuation_pct_all": -1,
    "distance": -1,
    "abs_median_dist_3y": -1,
    "basing_pct_90d": +1,
    "range_position": -1,
    "trend_7d": +1,
    "trend_90d": +1,
    "trend_180d": +1,
    "trend_365d": +1,
    "volatility_90d": -1,
    "drawdown_from_ath": -1,
    "days_since_ath": +1,
    "dollar_volume_30d": +1,
    "band_p05_dist_3y": -1,
    "band_p25_dist_3y": -1,
    "band_p75_dist_3y": -1,
    "band_p95_dist_3y": -1,
    "band_iqr_width_3y": -1,
    "band_span_width_3y": -1,
    "above_p75_3y": -1,
    "below_p25_3y": +1,
    "top_band_share_90d": -1,
}


RULE_FEATURES = [
    {"name": "valuation", "label": "Valuation blend", "weight": 0.30, "direction": -1,
     "description": "Blend of the 1y / 3y / all-history price percentiles (cheaper = higher)."},
    {"name": "distance", "label": "Distance to event low", "weight": 0.25, "direction": -1,
     "description": "How far the price sits above the dip window's low in BTC terms."},
    {"name": "median_gap", "label": "Gap to 3y median", "weight": 0.15, "direction": -1,
     "description": "Closeness to the 3-year median close (near median = neutral)."},
    {"name": "basing", "label": "Basing share (90d)", "weight": 0.15, "direction": 1,
     "description": "Time spent in the cheapest quartile of the past year."},
    {"name": "range", "label": "Range position", "weight": 0.15, "direction": -1,
     "description": "Position between the all-time low and high (at the low = cheap)."},
]

FEATURE_INFO = {
    name: {"label": label, "description": description}
    for name, label, description in (
        ("valuation_pct_1y", "1y price percentile", "Where today's close sits in the last 365 daily closes (0 = cheapest)."),
        ("valuation_pct_3y", "3y price percentile", "Where today's close sits in the last 3 years of daily closes."),
        ("valuation_pct_all", "All-history percentile", "Where today's close sits in every daily close on record."),
        ("distance", "Distance to event low", "How far the price is above the reference low of the dip window."),
        ("abs_median_dist_3y", "Gap to 3y median", "Absolute distance from the 3-year median close; near-median is neutral."),
        ("basing_pct_90d", "Basing share (90d)", "Share of the last 90 days spent in the cheapest quartile of the past year."),
        ("range_position", "Range position", "Position between the all-time low and high (0 = at the low)."),
        ("trend_7d", "7d trend", "One-week price change."),
        ("trend_90d", "90d trend", "Three-month price change."),
        ("trend_180d", "180d trend", "Six-month price change."),
        ("trend_365d", "1y trend", "One-year price change."),
        ("volatility_90d", "90d volatility", "Realized volatility over three months."),
        ("drawdown_from_ath", "Drawdown from ATH", "Distance below the all-time high (BTC terms)."),
        ("days_since_ath", "Days since ATH", "How long ago the all-time high was set."),
        ("dollar_volume_30d", "30d dollar volume", "Average daily traded value over the last 30 days."),
        ("band_p05_dist_3y", "Distance to 3y P05", "How far the price is above (or below) the bottom band edge of the 3-year distribution."),
        ("band_p25_dist_3y", "Distance to 3y P25", "Distance to the lower quartile of the 3-year closes."),
        ("band_p75_dist_3y", "Distance to 3y P75", "Distance to the upper quartile of the 3-year closes."),
        ("band_p95_dist_3y", "Distance to 3y P95", "Distance to the top band edge; negative means inside the thin band."),
        ("band_iqr_width_3y", "3y IQR width", "Width of the middle 50% band relative to the median (dispersion)."),
        ("band_span_width_3y", "3y P05-P95 width", "Full thin-band width relative to the median (tail dispersion)."),
        ("above_p75_3y", "Above 3y P75", "1 when the price sits above the upper quartile of the last 3 years."),
        ("below_p25_3y", "Below 3y P25", "1 when the price sits in the cheapest quartile of the last 3 years."),
        ("top_band_share_90d", "Top band share (90d)", "Share of the last 90 days spent in the top quartile of the last 3 years."),
    )
}

class ScoreModelError(ValueError):
    pass


def feature_value(source, name: str):
    """Read a (possibly derived) feature from a dict or an object."""
    if isinstance(source, dict):
        getter = source.get
    else:
        getter = lambda key: getattr(source, key, None)  # noqa: E731
    if name == "abs_median_dist_3y":
        value = getter("median_dist_3y")
        return abs(value) if value is not None else None
    return getter(name)


def rank_percentiles(values: list) -> list:
    """Average-rank percentiles in [0, 1]; ties share the average rank."""
    order = sorted(range(len(values)), key=lambda index: values[index])
    result = [0.0] * len(values)
    index = 0
    while index < len(order):
        end = index
        while end + 1 < len(order) and values[order[end + 1]] == values[order[index]]:
            end += 1
        average = ((index + end) / 2.0) / (len(values) - 1) if len(values) > 1 else 0.5
        for position in range(index, end + 1):
            result[order[position]] = average
        index = end + 1
    return result


def load_model(version: str) -> dict:
    path = os.path.join(ARTIFACT_DIR, f"{version}.json")
    if not os.path.exists(path):
        raise ScoreModelError(f"Unknown score model: {version}")
    with open(path) as handle:
        artifact = json.load(handle)
    if artifact.get("version") != version:
        raise ScoreModelError(f"Artifact {path} declares version {artifact.get('version')!r}")
    for name in FEATURE_DIRECTIONS:
        if name not in artifact.get("weights", {}):
            raise ScoreModelError(f"Artifact {version} is missing weight for {name}")
    return artifact


def available_models() -> list:
    if not os.path.isdir(ARTIFACT_DIR):
        return []
    return sorted(
        filename[: -len(".json")]
        for filename in os.listdir(ARTIFACT_DIR)
        if filename.endswith(".json")
    )


def apply_model_scores(coins: list, artifact: dict) -> None:
    """Set ``value_score`` (0-100) on snapshot-coin objects, in place."""
    feature_scaling = artifact["feature_scaling"]
    weights = artifact["weights"]

    raw = {}
    for name in FEATURE_DIRECTIONS:
        values = [feature_value(coin, name) for coin in coins]
        present = sorted(value for value in values if value is not None)
        median = present[len(present) // 2] if present else 0.0
        filled = [median if value is None else value for value in values]
        ranked = rank_percentiles(filled)
        direction = FEATURE_DIRECTIONS[name]
        scaling = feature_scaling.get(name, {"mean": 0.0, "scale": 1.0})
        raw[name] = [
            ((percentile if direction > 0 else 1.0 - percentile) - scaling["mean"])
            / (scaling["scale"] or 1.0)
            for percentile in ranked
        ]

    scores = [
        sum(weights[name] * raw[name][index] for name in FEATURE_DIRECTIONS) for index in range(len(coins))
    ]
    ranks = rank_percentiles(scores)
    for coin, rank in zip(coins, ranks):
        coin.value_score = round(max(0.0, min(100.0, rank * 100.0)), 1)
        coin.value_parts = None
