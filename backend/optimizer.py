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
from research.cv import assert_no_overlap, walk_forward_folds

logger = logging.getLogger(__name__)

OBJECTIVES = ("return", "sharpe", "calmar")
MAX_TRIALS = 1000
DEFAULT_CV_CANDIDATES = 16
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


def _sample(rng: random.Random) -> dict:
    return {
        "top_n": rng.randint(2, 10),
        "min_score": rng.choice(range(0, 81, 5)),
        **{name: rng.choice(values) for name, values in CATEGORICAL_SPACE.items()},
    }


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


def _cv_folds(train_dates: list) -> list:
    """Purged + embargoed walk-forward folds inside the training region."""
    folds = walk_forward_folds(
        len(train_dates),
        horizon=LABEL_HORIZON,
        test_size=max(2, len(train_dates) // 4),
        min_train=max(3, len(train_dates) // 3),
        embargo=1,
    )
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
) -> dict:
    if objective not in OBJECTIVES:
        raise BacktestError(f"objective must be one of {', '.join(OBJECTIVES)}")
    trials = max(1, min(MAX_TRIALS, int(trials)))
    validation_fraction = min(0.5, max(0.1, validation_fraction))

    dates = [date for date in snapshot["dates"] if start <= date <= end]
    if len(dates) < 8:
        raise BacktestError("The selected window has too few rebalance dates for validation")
    train_dates, holdout_dates = _split_window(dates, validation_fraction)
    folds = _cv_folds(train_dates)

    fixed = {
        "min_market_cap": min_market_cap,
        "min_volume": min_volume,
        "fee_pct": fee_pct,
        "fill_with_btc": fill_with_btc,
    }

    optimizer_name = "random"
    candidates = []
    seen = {}

    def consider(params: dict, metrics: dict, score: float):
        key = _params_key(params)
        if key in seen:
            return
        seen[key] = True
        candidates.append({"params": params, "train": metrics, "score": score})

    try:
        import optuna
    except ImportError:
        optuna = None

    if optuna is not None:
        optuna.logging.set_verbosity(optuna.logging.WARNING)
        optimizer_name = "optuna-tpe"
        study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=seed))

        def objective_fn(trial):
            params = {
                "top_n": trial.suggest_int("top_n", 2, 10),
                "min_score": trial.suggest_int("min_score", 0, 80, step=5),
                "sell_score": trial.suggest_categorical("sell_score", CATEGORICAL_SPACE["sell_score"]),
                "min_trend_30d": trial.suggest_categorical(
                    "min_trend_30d", CATEGORICAL_SPACE["min_trend_30d"]
                ),
                "weighting": trial.suggest_categorical("weighting", CATEGORICAL_SPACE["weighting"]),
                "rotation": trial.suggest_categorical("rotation", CATEGORICAL_SPACE["rotation"]),
                "regime_filter": trial.suggest_categorical(
                    "regime_filter", CATEGORICAL_SPACE["regime_filter"]
                ),
                "regime_exposure": trial.suggest_categorical(
                    "regime_exposure", CATEGORICAL_SPACE["regime_exposure"]
                ),
                "trailing_stop_pct": trial.suggest_categorical(
                    "trailing_stop_pct", CATEGORICAL_SPACE["trailing_stop_pct"]
                ),
                "take_profit_pct": trial.suggest_categorical(
                    "take_profit_pct", CATEGORICAL_SPACE["take_profit_pct"]
                ),
                "stop_loss_pct": trial.suggest_categorical(
                    "stop_loss_pct", CATEGORICAL_SPACE["stop_loss_pct"]
                ),
            }
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
            params = _sample(rng)
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

    best = []
    signatures = set()
    for candidate in ranked:
        if len(best) >= top_k:
            break
        holdout_metrics = _evaluate(
            snapshot, {**fixed, **candidate["params"]}, holdout_dates[0], holdout_dates[-1]
        )
        holdout_score = (
            _objective_value(holdout_metrics, objective) if holdout_metrics is not None else None
        )
        cv_mean = candidate["cv"]["mean"] if candidate["cv"] else None
        overfit_risk = (
            holdout_score is not None and holdout_score < 0
        ) or (cv_mean is not None and cv_mean <= 0)

        # Behavioural dedupe: different parameter combinations that produce
        # identical train/CV/holdout metrics are the same strategy to the user.
        signature = (
            round(candidate["train"]["total_return"], 3),
            round(candidate["train"]["sharpe"], 3),
            round(cv_mean, 3) if cv_mean is not None else None,
            round(holdout_metrics["total_return"], 3) if holdout_metrics else None,
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
                "overfit_risk": overfit_risk,
            }
        )

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
            "candidates_scored": len([item for item in with_cv if item["cv"]]),
        },
        "best": best,
    }
