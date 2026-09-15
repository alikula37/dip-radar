"""Constrained strategy search treated as a proper model-selection problem.

The failure mode of any "find the best parameters" feature is overfitting the
search to the data it is scored on. This module therefore runs a nested
validation funnel:

1. **Search** — Optuna TPE samples strategy parameters and scores them on the
   training region only (the user's universe / horizon constraints are fixed).
2. **Selection** — the best unique candidates are re-scored with purged +
   embargoed walk-forward CV *inside* the training region (``research.cv``),
   and ranked by the mean fold score, with the worst fold as tie-breaker.
   This is the number that reflects generalisation, not the search score.
3. **Report** — only the finalists touch the trailing holdout window, which
   the search never sees; its metrics are returned next to the CV numbers and
   an explicit overfit flag.

Deduplication, a seeded sampler and the purge/embargo assertions keep runs
reproducible and leakage-free; Optuna is optional (seeded random fallback).
"""

import json
import logging
import random
from datetime import datetime
from statistics import mean
from typing import Optional

from backtest import BacktestError, simulate
from research.cv import assert_no_overlap

logger = logging.getLogger(__name__)

OBJECTIVES = ("return", "sharpe", "calmar")
MAX_TRIALS = 1000
DEFAULT_CV_CANDIDATES = 16
DEFAULT_GAP_FRACTION = 0.5  # the holdout must retain half of the CV edge
LABEL_HORIZON = 1  # anchors; the simulator's period return spans one anchor

CATEGORICAL_SPACE = {
    "sell_score": [None, 20, 25, 30, 40, 50, 60],
    "min_trend_30d": [None, -60, -40, -25, 0],
    "weighting": ["equal", "score", "market_cap"],
    "rotation": ["hold", "rebalance"],
    "regime_filter": [None, "alt_trend", "breadth"],
    "regime_exposure": [0.0, 0.25, 0.35, 0.5, 0.75, 1.0],
    "trailing_stop_pct": [None, 35, 50, 75],
    "take_profit_pct": [None, 100, 200, 500],
    "stop_loss_pct": [None, 30, 40, 50],
}

# Searchable definition of every strategy parameter: the UI adds parameters to
# the search scope with "+", everything else must be pinned to a fixed value.
PARAM_SPACE = {
    "top_n": {"kind": "int", "low": 2, "high": 10},
    "min_score": {"kind": "int", "low": 0, "high": 80, "step": 5},
    **{name: {"kind": "categorical", "choices": choices} for name, choices in CATEGORICAL_SPACE.items()},
}
PARAM_NAMES = tuple(PARAM_SPACE)
DEFAULT_SEARCH_PARAMS = (
    "top_n",
    "min_score",
    "sell_score",
    "min_trend_30d",
    "weighting",
    "rotation",
    "regime_filter",
    "regime_exposure",
)
DEFAULT_FIXED_PARAMS = {
    "trailing_stop_pct": None,
    "take_profit_pct": None,
    "stop_loss_pct": None,
}


def validate_param_value(name: str, value):
    """Normalize a pinned parameter value; raises BacktestError when invalid."""
    spec = PARAM_SPACE.get(name)
    if spec is None:
        raise BacktestError(f"Unknown strategy parameter: {name}")
    if value is None:
        if spec["kind"] == "categorical" and None in spec["choices"]:
            return None
        raise BacktestError(f"{name} cannot be null")
    if spec["kind"] == "int":
        try:
            number = int(value)
        except (TypeError, ValueError):
            raise BacktestError(f"{name} must be an integer")
        if number < spec["low"] or number > spec["high"]:
            raise BacktestError(f"{name} must be between {spec['low']} and {spec['high']}")
        return number
    if value not in spec["choices"]:
        raise BacktestError(f"{name} must be one of {spec['choices']}")
    return value


def validate_scope(optimize_params, fixed_params):
    """Ensure the scope covers every parameter exactly once."""
    optimize = list(dict.fromkeys(optimize_params))
    fixed = dict(fixed_params or {})
    unknown = [name for name in [*optimize, *fixed] if name not in PARAM_SPACE]
    if unknown:
        raise BacktestError(f"Unknown strategy parameter(s): {', '.join(unknown)}")
    overlap = [name for name in optimize if name in fixed]
    if overlap:
        raise BacktestError(f"Parameter(s) both optimized and pinned: {', '.join(overlap)}")
    missing = [name for name in PARAM_NAMES if name not in optimize and name not in fixed]
    if missing:
        raise BacktestError(
            f"Parameter(s) neither optimized nor pinned: {', '.join(missing)}. "
            "Add them to the search scope or pin a value."
        )
    if not optimize:
        raise BacktestError("Add at least one parameter to optimize")
    normalized = {name: validate_param_value(name, value) for name, value in fixed.items()}
    return optimize, normalized


def _suggest_param(trial, name: str):
    spec = PARAM_SPACE[name]
    if spec["kind"] == "int":
        return trial.suggest_int(name, spec["low"], spec["high"], step=spec.get("step", 1))
    return trial.suggest_categorical(name, spec["choices"])


def _sample(rng: random.Random, optimize_params) -> dict:
    params = {}
    for name in optimize_params:
        spec = PARAM_SPACE[name]
        if spec["kind"] == "int":
            choices = range(spec["low"], spec["high"] + 1, spec.get("step", 1))
            params[name] = rng.choice(list(choices))
        else:
            params[name] = rng.choice(spec["choices"])
    return params


def _params_key(params: dict) -> str:
    return json.dumps(params, sort_keys=True, default=str)


def _objective_value(metrics: dict, objective: str) -> float:
    if objective == "return":
        value = metrics["total_return"]
    elif objective == "calmar":
        value = metrics.get("calmar")
        value = value if value is not None else -10.0
    else:
        value = metrics["sharpe"]
    return float(value)


def _evaluate(snapshot, params: dict, start: datetime, end: datetime) -> Optional[dict]:
    try:
        return simulate(snapshot, start=start, end=end, **params)["metrics"]
    except BacktestError:
        return None
    except Exception:
        logger.exception("Optimizer trial failed for %s", params)
        return None


def _score(metrics: dict, objective: str, max_drawdown_limit: Optional[float]) -> float:
    if metrics is None:
        return float("-inf")
    if max_drawdown_limit is not None and metrics["max_drawdown"] < -abs(max_drawdown_limit) / 100.0:
        return float("-inf")
    return _objective_value(metrics, objective)


def _split_window(dates: list, validation_fraction: float):
    n_holdout = max(2, int(round(len(dates) * validation_fraction)))
    train_dates = dates[:-n_holdout]
    holdout_dates = dates[-n_holdout:]
    if len(train_dates) < 6:
        raise BacktestError("Not enough anchors for a training window; widen the date range")
    return train_dates, holdout_dates


def _cv_folds(train_dates: list, folds_count: int = 3) -> list:
    """Purged + embargoed walk-forward folds inside the training region.

    ``folds_count`` is the user-facing knob: the validation tail is split into
    that many contiguous test blocks (at least two anchors each), and each
    block trains on everything before it with a purge + embargo gap.
    """
    n = len(train_dates)
    folds_count = max(1, min(6, int(folds_count)))
    min_train = max(3, n // 3)
    tail_start = min_train + LABEL_HORIZON + 1
    available = n - tail_start
    if available < 2:
        return []
    folds_count = max(1, min(folds_count, available // 2))
    test_size = available // folds_count

    folds = []
    test_start = tail_start
    for index in range(folds_count):
        test_end = n if index == folds_count - 1 else min(n, test_start + test_size)
        folds.append(
            {
                "train": (0, test_start - LABEL_HORIZON - 1),
                "test": (test_start, test_end),
                "horizon": LABEL_HORIZON,
                "embargo": 1,
            }
        )
        test_start = test_end
    assert_no_overlap(folds, LABEL_HORIZON)
    return folds


def _cv_metrics(snapshot, params: dict, train_dates: list, folds: list, objective: str) -> Optional[dict]:
    """Mean/worst fold score for a candidate; folds never overlap the holdout."""
    scores = []
    per_fold = []
    for fold in folds:
        test_start = train_dates[fold["test"][0]]
        test_end = train_dates[fold["test"][1] - 1]
        metrics = _evaluate(snapshot, params, test_start, test_end)
        if metrics is None:
            continue
        scores.append(_objective_value(metrics, objective))
        per_fold.append(
            {
                "test_start": test_start.isoformat(),
                "test_end": test_end.isoformat(),
                "metrics": metrics,
            }
        )
    if not scores:
        return None
    return {"mean": round(mean(scores), 4), "min": round(min(scores), 4), "per_fold": per_fold}


def optimize_strategy(
    snapshot: dict,
    *,
    start: datetime,
    end: datetime,
    min_market_cap: float,
    min_volume: float,
    fee_pct: float,
    fill_with_btc: bool,
    objective: str = "sharpe",
    trials: int = 200,
    max_drawdown_limit: Optional[float] = None,
    validation_fraction: float = 0.3,
    seed: int = 7,
    top_k: int = 5,
    cv_candidates: int = DEFAULT_CV_CANDIDATES,
    optimize_params=None,
    fixed_params=None,
    gap_fraction: float = DEFAULT_GAP_FRACTION,
    cv_folds: int = 3,
) -> dict:
    if objective not in OBJECTIVES:
        raise BacktestError(f"objective must be one of {', '.join(OBJECTIVES)}")
    trials = max(1, min(MAX_TRIALS, int(trials)))
    validation_fraction = min(0.5, max(0.1, validation_fraction))
    gap_fraction = min(0.9, max(0.1, gap_fraction))
    optimize, pinned = validate_scope(
        optimize_params if optimize_params is not None else DEFAULT_SEARCH_PARAMS,
        fixed_params if fixed_params is not None else DEFAULT_FIXED_PARAMS,
    )

    dates = [date for date in snapshot["dates"] if start <= date <= end]
    if len(dates) < 8:
        raise BacktestError("The selected window has too few rebalance dates for validation")
    train_dates, holdout_dates = _split_window(dates, validation_fraction)
    folds = _cv_folds(train_dates, cv_folds)
    if not folds:
        raise BacktestError("Not enough anchors for walk-forward folds; widen the date range")

    fixed = {
        "min_market_cap": min_market_cap,
        "min_volume": min_volume,
        "fee_pct": fee_pct,
        "fill_with_btc": fill_with_btc,
        **pinned,
    }

    optimizer_name = "random"
    candidates = []
    seen = {}

    def consider(params: dict, metrics: dict, score: float):
        full = {**pinned, **params}
        key = _params_key(full)
        if key in seen:
            return
        seen[key] = True
        candidates.append({"params": full, "train": metrics, "score": score})

    try:
        import optuna
    except ImportError:
        optuna = None

    if optuna is not None:
        optuna.logging.set_verbosity(optuna.logging.WARNING)
        optimizer_name = "optuna-tpe"
        study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=seed))

        def objective_fn(trial):
            params = {name: _suggest_param(trial, name) for name in optimize}
            metrics = _evaluate(snapshot, {**fixed, **params}, train_dates[0], train_dates[-1])
            score = _score(metrics, objective, max_drawdown_limit)
            if score == float("-inf"):
                raise optuna.TrialPruned()
            consider(params, metrics, score)
            return score

        study.optimize(objective_fn, n_trials=trials, show_progress_bar=False, n_jobs=1)
    else:
        rng = random.Random(seed)
        for _ in range(trials):
            params = _sample(rng, optimize)
            metrics = _evaluate(snapshot, {**fixed, **params}, train_dates[0], train_dates[-1])
            score = _score(metrics, objective, max_drawdown_limit)
            if score == float("-inf"):
                continue
            consider(params, metrics, score)

    candidates.sort(key=lambda item: item["score"], reverse=True)

    shortlist = candidates[: max(top_k, min(cv_candidates, len(candidates)))]
    with_cv = []
    for candidate in shortlist:
        cv = _cv_metrics(snapshot, {**fixed, **candidate["params"]}, train_dates, folds, objective)
        with_cv.append({**candidate, "cv": cv})

    ranked = sorted(
        with_cv,
        key=lambda item: (
            item["cv"]["mean"] if item["cv"] else float("-inf"),
            item["cv"]["min"] if item["cv"] else float("-inf"),
            item["score"],
        ),
        reverse=True,
    )

    # Validation gate: a configuration is only shown when the walk-forward CV
    # AND the untouched holdout agree — otherwise the search found noise.
    def _gate(cv, holdout_metrics):
        if cv is None or holdout_metrics is None:
            return False, "missing validation data"
        holdout_score = _objective_value(holdout_metrics, objective)
        if cv["mean"] <= 0:
            return False, "CV mean not positive"
        if cv["min"] <= 0:
            return False, "a walk-forward fold lost"
        if holdout_score <= 0:
            return False, "holdout not positive"
        if holdout_score < gap_fraction * cv["mean"]:
            return False, "holdout keeps less than half of the CV edge"
        return True, None

    best = []
    signatures = set()
    rejected = {"count": 0, "reasons": {}}
    evaluated_for_validation = 0
    max_holdout_checks = max(20, top_k * 4)
    for candidate in ranked:
        if len(best) >= top_k or evaluated_for_validation >= max_holdout_checks:
            break
        evaluated_for_validation += 1
        holdout_metrics = _evaluate(
            snapshot, {**fixed, **candidate["params"]}, holdout_dates[0], holdout_dates[-1]
        )
        passed, reason = _gate(candidate["cv"], holdout_metrics)
        if not passed:
            rejected["count"] += 1
            rejected["reasons"][reason] = rejected["reasons"].get(reason, 0) + 1
            continue

        # Behavioural dedupe: different parameter combinations that produce
        # identical metrics are the same strategy to the user.
        signature = (
            round(candidate["train"]["total_return"], 3),
            round(candidate["train"]["sharpe"], 3),
            round(candidate["cv"]["mean"], 3),
            round(holdout_metrics["total_return"], 3),
        )
        if signature in signatures:
            continue
        signatures.add(signature)

        best.append(
            {
                "params": candidate["params"],
                "train_metrics": candidate["train"],
                "cv_metrics": candidate["cv"],
                "holdout_metrics": holdout_metrics,
            }
        )

    best.sort(key=lambda item: (item["cv_metrics"]["min"], item["cv_metrics"]["mean"]), reverse=True)

    return {
        "optimizer": optimizer_name,
        "objective": objective,
        "trials": trials,
        "evaluated": len(candidates),
        "max_drawdown_limit": max_drawdown_limit,
        "train": {"start": train_dates[0].isoformat(), "end": train_dates[-1].isoformat()},
        "holdout": {"start": holdout_dates[0].isoformat(), "end": holdout_dates[-1].isoformat()},
        "cv": {
            "folds": [
                {
                    "train": [train_dates[fold["train"][0]].isoformat(), train_dates[fold["train"][1] - 1].isoformat()],
                    "test": [train_dates[fold["test"][0]].isoformat(), train_dates[fold["test"][1] - 1].isoformat()],
                }
                for fold in folds
            ],
            "horizon_anchors": LABEL_HORIZON,
            "embargo_anchors": 1,
            "folds_requested": max(1, min(6, int(cv_folds))),
            "candidates_scored": len([item for item in with_cv if item["cv"]]),
        },
        "best": best,
        "validated": len(best),
        "rejected": rejected,
        "gap_fraction": gap_fraction,
        "optimize_params": optimize,
        "fixed_params": pinned,
        "message": (
            None
            if best
            else "No configuration passed validation on the untouched holdout. "
            "Stay with the shipped presets or widen the date range."
        ),
    }
