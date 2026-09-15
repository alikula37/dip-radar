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
import math
import random
from datetime import datetime
from statistics import mean
from typing import Optional

from backtest import FREQUENCY_DAYS, BacktestError, simulate
from research.cv import assert_no_overlap

logger = logging.getLogger(__name__)

OBJECTIVES = ("return", "sharpe", "calmar", "consistency")
MAX_TRIALS = 3000
DEFAULT_CV_CANDIDATES = 16
DEFAULT_GAP_FRACTION = 0.5  # the holdout must retain half of the CV edge
LABEL_HORIZON = 1  # anchors; the simulator's period return spans one anchor

# How harsh the holdout gate is. The search always optimises the walk-forward
# CV score, so these only decide how much of that edge the untouched holdout
# must retain before a configuration may be shown.
STRICTNESS = {
    "strict": {"require_min_positive": True, "gap_fraction": 0.5},
    "balanced": {"require_min_positive": False, "gap_fraction": 0.25},
    "loose": {"require_min_positive": False, "gap_fraction": 0.0},
}

CATEGORICAL_SPACE = {
    "sell_score": [None, 20, 25, 30, 40, 50, 60],
    "equity_trend_exposure": [None, 0.0, 0.35, 0.5, 0.7],
    "profit_lock_pct": [None, 25, 50],
    "short_n": [0, 2, 3, 5],
    "short_max_score": [None, 30, 40, 50],
    "short_funding_apr": [0, 10, 20],
    "short_exposure": [0.0, 0.25, 0.5, 1.0],
    "profit_sweep_pct": [0, 30, 50, 70],
    "ic_filter": [False, True],
    "ic_exposure": [0.0, 0.35, 0.7],
    "ic_window": [2, 4, 6, 12],
    "ic_threshold": [0.0, 0.05, 0.1],
    "invert_score": [False, True],
    "max_holding_periods": [None, 26, 52, 104],
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
    "equity_trend_exposure": None,
    "profit_lock_pct": None,
    "short_n": 0,
    "short_max_score": None,
    "short_funding_apr": 0.0,
    "short_exposure": 1.0,
    "profit_sweep_pct": 0,
    "max_holding_periods": None,
    "invert_score": False,
    "ic_filter": False,
    "ic_exposure": 0.35,
    "ic_window": 6,
    "ic_threshold": 0.0,
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
    elif objective == "consistency":
        # Share of rolling one-year windows that end positive: rewards steady
        # compounding over one-off vintage spikes.
        value = metrics.get("positive_rolling_share", 0.0)
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


def passes_gate(cv, holdout_metrics, objective: str, strictness: str = "strict"):
    """Decide whether a candidate may be shown to the user.

    The search optimises the walk-forward CV score, so the holdout is only a
    final sanity check; ``strictness`` controls how much of the CV edge it
    must retain (and whether every fold has to be positive).
    """
    spec = STRICTNESS[strictness]
    if cv is None or holdout_metrics is None:
        return False, "missing validation data"
    if cv["mean"] <= 0:
        return False, "CV mean not positive"
    if spec["require_min_positive"] and cv["min"] <= 0:
        return False, "a walk-forward fold lost"
    holdout_score = _objective_value(holdout_metrics, objective)
    if holdout_metrics["total_return"] <= 0:
        return False, "holdout loses money"
    if holdout_score <= 0:
        return False, "holdout not positive"
    if holdout_score < spec["gap_fraction"] * cv["mean"]:
        return False, "holdout keeps less than the required share of the CV edge"
    return True, None


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


def _parse_curve(curve: list) -> list:
    return [
        {
            "date": datetime.fromisoformat(point["date"]) if isinstance(point["date"], str) else point["date"],
            "equity": point["equity"],
            "period_return": point["period_return"],
        }
        for point in curve
    ]


def _slice_metrics(curve: list, slice_start: datetime, slice_end: datetime, frequency: str) -> Optional[dict]:
    """Metrics for a slice of a continuous equity curve.

    Positions are carried across the slice boundary (no cold start), which is
    how the strategy is actually traded — path-dependent policies cannot be
    judged by restarting the book at every validation window.
    """
    parsed = _parse_curve(curve)
    prefix = [point for point in parsed if point["date"] <= slice_start]
    points = [point for point in parsed if slice_start < point["date"] <= slice_end]
    if not points:
        return None

    equity_start = prefix[-1]["equity"] if prefix else 1.0
    returns = [point["period_return"] for point in points]
    equity = points[-1]["equity"]
    total_return = equity / equity_start - 1.0 if equity_start else 0.0

    periods = len(returns)
    mean_return = sum(returns) / periods
    if periods > 1:
        variance = sum((value - mean_return) ** 2 for value in returns) / (periods - 1)
        std_return = math.sqrt(variance)
    else:
        std_return = 0.0
    periods_per_year = 365.0 / FREQUENCY_DAYS[frequency]
    sharpe = (mean_return / std_return) * math.sqrt(periods_per_year) if std_return else 0.0
    volatility = std_return * math.sqrt(periods_per_year)

    peak = equity_start
    max_drawdown = 0.0
    for point in points:
        peak = max(peak, point["equity"])
        max_drawdown = min(max_drawdown, point["equity"] / peak - 1.0)

    years = max((points[-1]["date"] - (prefix[-1]["date"] if prefix else points[0]["date"])).days / 365.0, 1 / 365.0)
    cagr = equity ** (1.0 / years) - 1.0 if equity > 0 and equity_start > 0 else -1.0

    # Consistency diagnostics scaled to the slice length (a 52-period rolling
    # window cannot fit inside a 40-period fold).
    rolling_window = min(int(round(periods_per_year)), max(2, periods // 3))
    positive_rolling = 0
    rolling_total = 0
    for start_index in range(0, max(0, periods - rolling_window) + 1):
        product = 1.0
        for value in returns[start_index : start_index + rolling_window]:
            product *= 1.0 + value
        rolling_total += 1
        positive_rolling += 1 if product > 1.0 else 0
    positive_rolling_share = positive_rolling / rolling_total if rolling_total else 0.0

    year_end_equity = {}
    equity_path = ([prefix[-1]] if prefix else []) + points
    for point in equity_path:
        year_end_equity[point["date"].year] = point["equity"]
    year_returns = []
    previous = equity_start
    for year in sorted(year_end_equity):
        year_returns.append(year_end_equity[year] / previous - 1.0)
        previous = year_end_equity[year]
    positive_years = sum(1 for value in year_returns if value > 0) / len(year_returns) if year_returns else 0.0

    peak = equity_start
    periods_in_drawdown = 0
    for point in ([prefix[-1]] if prefix else []) + points:
        peak = max(peak, point["equity"])
        if point["equity"] < peak - 1e-12:
            periods_in_drawdown += 1
    time_in_drawdown = periods_in_drawdown / len(equity_path) if equity_path else 0.0

    best_count = max(1, int(round(periods * 0.05)))
    positive_returns = sorted((value for value in returns if value > 0), reverse=True)
    best_period_share = (
        sum(positive_returns[:best_count]) / sum(positive_returns) if positive_returns else 1.0
    )
    period_returns = returns

    return {
        "total_return": round(total_return, 4),
        "total_return_usd": None,
        "benchmark_btc_usd_return": None,
        "cagr": round(cagr, 4),
        "volatility": round(volatility, 4),
        "sharpe": round(sharpe, 3),
        "max_drawdown": round(max_drawdown, 4),
        "calmar": round(cagr / abs(max_drawdown), 3) if max_drawdown < 0 else None,
        "win_rate": round(sum(1 for value in period_returns if value > 0) / periods, 4),
        "avg_holdings": 0.0,
        "avg_turnover": 0.0,
        "positive_years": round(positive_years, 4),
        "positive_rolling_share": round(positive_rolling_share, 4),
        "time_in_drawdown": round(time_in_drawdown, 4),
        "best_period_share": round(best_period_share, 4),
        "periods": periods,
    }


def _cv_from_run(snapshot, params, dates, train_dates, folds, objective, max_drawdown_limit):
    """Walk-forward CV of a continuously traded book.

    One simulation runs from the window start to the last fold's test end and
    each fold's P&L is sliced out of that curve, so positions entered before a
    fold are carried into it (no cold start).
    """
    if not folds:
        return None
    run_end = train_dates[folds[-1]["test"][1] - 1]
    curve = simulate(snapshot, start=dates[0], end=run_end, **params)["curve"]

    scores = []
    per_fold = []
    for fold in folds:
        slice_start = train_dates[fold["test"][0]]
        slice_end = train_dates[fold["test"][1] - 1]
        metrics = _slice_metrics(curve, slice_start, slice_end, snapshot["frequency"])
        if metrics is None:
            continue
        if max_drawdown_limit is not None and metrics["max_drawdown"] < -abs(max_drawdown_limit) / 100.0:
            return None
        scores.append(_objective_value(metrics, objective))
        per_fold.append(
            {
                "test_start": slice_start.isoformat(),
                "test_end": slice_end.isoformat(),
                "metrics": metrics,
            }
        )
    if not scores:
        return None
    return {"mean": round(mean(scores), 4), "min": round(min(scores), 4), "per_fold": per_fold}


def _finalist_metrics(snapshot, params, dates, train_dates, holdout_dates, folds, objective):
    """Train / CV / holdout slices from one continuous run of the strategy."""
    curve = simulate(snapshot, start=dates[0], end=dates[-1], **params)["curve"]
    frequency = snapshot["frequency"]

    train_metrics = _slice_metrics(curve, dates[0], train_dates[-1], frequency)
    holdout_metrics = _slice_metrics(curve, holdout_dates[0], holdout_dates[-1], frequency)

    cv_scores = []
    cv_folds = []
    for fold in folds:
        slice_start = train_dates[fold["test"][0]]
        slice_end = train_dates[fold["test"][1] - 1]
        metrics = _slice_metrics(curve, slice_start, slice_end, frequency)
        if metrics is None:
            continue
        cv_scores.append(_objective_value(metrics, objective))
        cv_folds.append(
            {
                "test_start": slice_start.isoformat(),
                "test_end": slice_end.isoformat(),
                "metrics": metrics,
            }
        )
    cv = (
        {"mean": round(mean(cv_scores), 4), "min": round(min(cv_scores), 4), "per_fold": cv_folds}
        if cv_scores
        else None
    )
    return train_metrics, cv, holdout_metrics


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
    strictness: str = "strict",
    cv_folds: int = 3,
) -> dict:
    if objective not in OBJECTIVES:
        raise BacktestError(f"objective must be one of {', '.join(OBJECTIVES)}")
    trials = max(1, min(MAX_TRIALS, int(trials)))
    validation_fraction = min(0.5, max(0.1, validation_fraction))
    if strictness not in STRICTNESS:
        raise BacktestError(f"strictness must be one of {', '.join(STRICTNESS)}")
    gap_fraction = STRICTNESS[strictness]["gap_fraction"]
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

    def consider(params: dict, cv: dict):
        full = {**pinned, **params}
        key = _params_key(full)
        if key in seen:
            return
        seen[key] = True
        candidates.append({"params": full, "cv": cv})

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
            cv = _cv_from_run(
                snapshot, {**fixed, **params}, dates, train_dates, folds, objective, max_drawdown_limit
            )
            if cv is None:
                raise optuna.TrialPruned()
            consider(params, cv)
            return cv["mean"]

        study.optimize(objective_fn, n_trials=trials, show_progress_bar=False, n_jobs=1)
    else:
        rng = random.Random(seed)
        for _ in range(trials):
            params = _sample(rng, optimize)
            cv = _cv_from_run(
                snapshot, {**fixed, **params}, dates, train_dates, folds, objective, max_drawdown_limit
            )
            if cv is None:
                continue
            consider(params, cv)

    # Rank by the walk-forward CV score itself — the search objective is
    # generalisation, not the in-sample training metric.
    ranked = sorted(
        candidates,
        key=lambda item: (item["cv"]["mean"], item["cv"]["min"]),
        reverse=True,
    )

    # Validation gate: the search already maximised the walk-forward CV score;
    # the untouched holdout must now confirm it under the chosen strictness.
    best = []
    signatures = set()
    rejected = {"count": 0, "reasons": {}}
    evaluated_for_validation = 0
    # When nothing validates, look deeper so the flagged list still spans
    # genuinely different behaviours instead of a single flat do-nothing row.
    max_holdout_checks = max(20, top_k * 4)
    for candidate in ranked:
        if evaluated_for_validation >= 20 and not any(item["passed"] for item in best):
            # Nothing validated; the top of the CV ranking is dominated by flat
            # do-nothing configs. Keep searching a wider slice of the ranking so
            # the flagged list still spans genuinely different behaviours.
            max_holdout_checks = max(max_holdout_checks, 60)
        if evaluated_for_validation >= max_holdout_checks:
            break
        if len(best) >= top_k and sum(1 for item in best if item["passed"]) >= top_k:
            break
        evaluated_for_validation += 1
        try:
            train_metrics, cv_metrics, holdout_metrics = _finalist_metrics(
                snapshot,
                {**fixed, **candidate["params"]},
                dates,
                train_dates,
                holdout_dates,
                folds,
                objective,
            )
        except BacktestError:
            continue
        if train_metrics is None or holdout_metrics is None:
            continue
        passed, reason = passes_gate(cv_metrics, holdout_metrics, objective, strictness)
        if not passed:
            rejected["count"] += 1
            rejected["reasons"][reason] = rejected["reasons"].get(reason, 0) + 1

        # Behavioural dedupe: different parameter combinations that produce
        # identical metrics are the same strategy to the user.
        signature = (
            cv_metrics["mean"] if cv_metrics else None,
            cv_metrics["min"] if cv_metrics else None,
            round(holdout_metrics["total_return"], 3),
        )
        if signature in signatures:
            continue
        signatures.add(signature)

        best.append(
            {
                "params": candidate["params"],
                "train_metrics": train_metrics,
                "cv_metrics": cv_metrics,
                "holdout_metrics": holdout_metrics,
                "passed": passed,
                "reason": reason,
            }
        )

    # Validated configurations first, then by the walk-forward CV score.
    best.sort(
        key=lambda item: (
            0 if item["passed"] else 1,
            -(item["cv_metrics"]["mean"] if item["cv_metrics"] else float("-inf")),
        )
    )
    best = best[:top_k]



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
            "candidates_scored": len(candidates),
        },
        "best": best,
        "validated": sum(1 for item in best if item["passed"]),
        "rejected": rejected,
        "strictness": strictness,
        "gap_fraction": gap_fraction,
        "optimize_params": optimize,
        "fixed_params": pinned,
        "message": (
            None
            if any(item["passed"] for item in best)
            else "No configuration passed validation with the current strictness — the best attempts are shown "
            "with overfit warnings. Loosen the strictness, widen the date range or relax the filters."
        ),
    }
