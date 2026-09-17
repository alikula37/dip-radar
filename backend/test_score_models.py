from types import SimpleNamespace

import pytest

from score_models import (
    FEATURE_DIRECTIONS,
    ScoreModelError,
    apply_model_scores,
    available_models,
    load_model,
    rank_percentiles,
)


def _coin(cheapness: float, liquidity: float = 1.0):
    """Small helper: cheapness 0 = cheapest valuation, 1 = most expensive."""
    return SimpleNamespace(
        valuation_pct_1y=cheapness * 100.0,
        valuation_pct_3y=cheapness * 100.0,
        valuation_pct_all=cheapness * 100.0,
        distance=cheapness * 200.0,
        median_dist_3y=cheapness * 50.0 - 25.0,
        basing_pct_90d=(1.0 - cheapness) * 100.0,
        range_position=cheapness,
        trend_7d=0.0,
        trend_90d=0.0,
        trend_180d=0.0,
        trend_365d=0.0,
        volatility_90d=0.5,
        drawdown_from_ath=-cheapness,
        days_since_ath=100,
        dollar_volume_30d=liquidity,
        band_p05_dist_3y=cheapness * 300.0,
        band_p25_dist_3y=cheapness * 200.0,
        band_p75_dist_3y=cheapness * 100.0,
        band_p95_dist_3y=cheapness * 50.0,
        band_iqr_width_3y=0.8,
        band_span_width_3y=2.5,
        above_p75_3y=1 if cheapness > 0.75 else 0,
        below_p25_3y=1 if cheapness < 0.25 else 0,
        top_band_share_90d=(1.0 - cheapness) * 100.0,
        dip_bounces=round((1.0 - cheapness) * 5),
        dip_bounce_avg=(1.0 - cheapness) * 120.0 if cheapness < 1.0 else None,
        value_score=None,
        value_parts=None,
    )


def test_bundled_artifact_loads_and_is_consistent():
    assert available_models() == ["learned_v5"]
    artifact = load_model("learned_v5")

    assert set(artifact["weights"]) == set(FEATURE_DIRECTIONS)
    assert set(artifact["feature_scaling"]) == set(FEATURE_DIRECTIONS)
    assert {feature["name"] for feature in artifact["features"]} == set(FEATURE_DIRECTIONS)
    assert all(feature["label"] for feature in artifact["features"])
    assert artifact["trained_until"] == "2024-12-31"
    assert "strategy_gate" in artifact["validation"]


def test_unknown_artifact_is_rejected():
    with pytest.raises(ScoreModelError):
        load_model("does_not_exist")


def test_apply_model_scores_ranks_cheap_coins_higher():
    artifact = load_model("learned_v5")
    coins = [_coin(0.0, 5.0), _coin(0.5, 2.0), _coin(1.0, 0.5)]

    apply_model_scores(coins, artifact)

    assert all(coin.value_score is not None for coin in coins)
    assert all(0.0 <= coin.value_score <= 100.0 for coin in coins)
    assert coins[0].value_score > coins[-1].value_score


def test_apply_model_scores_handles_missing_features_with_medians():
    artifact = load_model("learned_v5")
    broken = _coin(0.2)
    broken.volatility_90d = None
    coins = [broken, _coin(0.4), _coin(0.9)]

    apply_model_scores(coins, artifact)

    assert all(coin.value_score is not None for coin in coins)


def test_rank_percentiles_are_monotonic_and_normalized():
    values = [5.0, 1.0, 3.0]
    ranked = rank_percentiles(values)

    assert ranked[1] == 0.0 and ranked[2] == 0.5 and ranked[0] == 1.0
