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
    "trend_90d": +1,
    "volatility_90d": -1,
    "drawdown_from_ath": -1,
    "days_since_ath": +1,
    "dollar_volume_30d": +1,
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
