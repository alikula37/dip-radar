"""Constrained hyperparameter search over the Strategy Lab simulator.

The user pins the universe and the horizon (market-cap / volume filters,
start/end, rebalance frequency, fees, score model, BTC fill) and picks an
objective; the optimizer searches the remaining strategy parameters with
Optuna's TPE sampler (seeded, so runs are reproducible). A trailing holdout
window is never optimized on: the top configurations are re-run there so
in-sample luck is visible next to the training result.

Optuna is optional at runtime; without it a seeded random search is used.
"""

import logging
import random
from datetime import datetime, timedelta
from typing import Optional

from backtest import BacktestError, simulate

logger = logging.getLogger(__name__)

OBJECTIVES = ("return", "sharpe", "calmar")
MAX_TRIALS = 1000

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


def _train_windows(start: datetime, end: datetime, validation_fraction: float):
    span = end - start
    train_end = start + timedelta(seconds=span.total_seconds() * (1.0 - validation_fraction))
    return (start, train_end), (train_end, end)


def _score(metrics: dict, objective: str, max_drawdown_limit: Optional[float]) -> float:
    if metrics is None:
        return float("-inf")
    if max_drawdown_limit is not None and metrics["max_drawdown"] < -abs(max_drawdown_limit) / 100.0:
        return float("-inf")
    return _objective_value(metrics, objective)


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
) -> dict:
    """Search strategy parameters; report the top configs on a holdout window."""
    if objective not in OBJECTIVES:
        raise BacktestError(f"objective must be one of {', '.join(OBJECTIVES)}")
    trials = max(1, min(MAX_TRIALS, int(trials)))
    validation_fraction = min(0.5, max(0.1, validation_fraction))
    (train_start, train_end), (holdout_start, holdout_end) = _train_windows(
        start, end, validation_fraction
    )

    fixed = {
        "min_market_cap": min_market_cap,
        "min_volume": min_volume,
        "fee_pct": fee_pct,
        "fill_with_btc": fill_with_btc,
    }

    optimizer_name = "random"
    candidates = []

    try:
        import optuna
    except ImportError:
        optuna = None

    if optuna is not None:
        optuna.logging.set_verbosity(optuna.logging.WARNING)
        optimizer_name = "optuna-tpe"
        sampler = optuna.samplers.TPESampler(seed=seed)
        study = optuna.create_study(direction="maximize", sampler=sampler)

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
            metrics = _evaluate(snapshot, {**fixed, **params}, train_start, train_end)
            score = _score(metrics, objective, max_drawdown_limit)
            if score == float("-inf"):
                raise optuna.TrialPruned()
            candidates.append({"params": params, "train": metrics, "score": score})
            return score

        study.optimize(objective_fn, n_trials=trials, show_progress_bar=False, n_jobs=1)
    else:
        rng = random.Random(seed)
        for _ in range(trials):
            params = _sample(rng)
            metrics = _evaluate(snapshot, {**fixed, **params}, train_start, train_end)
            score = _score(metrics, objective, max_drawdown_limit)
            if score == float("-inf"):
                continue
            candidates.append({"params": params, "train": metrics, "score": score})

    candidates.sort(key=lambda item: item["score"], reverse=True)

    best = []
    for candidate in candidates[:top_k]:
        holdout_metrics = _evaluate(snapshot, {**fixed, **candidate["params"]}, holdout_start, holdout_end)
        best.append(
            {
                "params": candidate["params"],
                "train_metrics": candidate["train"],
                "holdout_metrics": holdout_metrics,
            }
        )

    return {
        "optimizer": optimizer_name,
        "objective": objective,
        "trials": trials,
        "evaluated": len(candidates),
        "max_drawdown_limit": max_drawdown_limit,
        "train": {"start": train_start.isoformat(), "end": train_end.isoformat()},
        "holdout": {"start": holdout_start.isoformat(), "end": holdout_end.isoformat()},
        "best": best,
    }
