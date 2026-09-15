"""Baseline study: can the current Value Score rank forward returns?

Usage (from backend/):

    python -m research.baseline_ic
    python -m research.baseline_ic --frequencies monthly quarterly --save research/baselines/value_score.json

Point DATABASE_URL at a *copy* of the production database; the harness only
runs SELECTs but snapshot builds are heavy. See research/README.md.
"""

import argparse
import json
import os
import platform
import sys
from datetime import datetime, timezone

from research import common
from research.stats import block_bootstrap_ci, spearman, summarize

SIGNALS = {
    "score": lambda entry: entry["score"],
    "distance(-)": lambda entry: -(entry.get("distance") or 0.0),
    "trend30": lambda entry: entry.get("trend_30d") or 0.0,
    "sma200": lambda entry: 1.0 if entry.get("above_sma200") else 0.0,
}


def evaluate_frequency(snapshot: dict, draws: int, seed: int, min_universe: int) -> dict:
    per_signal = {name: [] for name in SIGNALS}
    spreads = []
    per_year = {}

    for date, symbols, returns in common.forward_return_pairs(snapshot, 1, min_universe):
        pool = snapshot["entries"][date]
        bucket = per_year.setdefault(str(date.year), {"ic": [], "spread": []})

        for name, signal in SIGNALS.items():
            ic = spearman([signal(pool[symbol]) for symbol in symbols], returns)
            if ic is not None:
                per_signal[name].append(ic)
                if name == "score":
                    bucket["ic"].append(ic)

        ordered = sorted(zip([SIGNALS["score"](pool[symbol]) for symbol in symbols], returns))
        top = max(1, len(ordered) // 5)
        spread = sum(value for _, value in ordered[-top:]) / top - sum(
            value for _, value in ordered[:top]
        ) / top
        spreads.append(spread)
        bucket["spread"].append(spread)

    signals = {}
    for name, values in per_signal.items():
        summary = summarize(values)
        summary["ci95"] = list(block_bootstrap_ci(values, 3, draws, seed))
        signals[name] = summary

    spread_summary = summarize(spreads)
    spread_summary["ci95"] = list(block_bootstrap_ci(spreads, 3, draws, seed))

    years = {
        year: {
            "ic_mean": sum(bucket["ic"]) / len(bucket["ic"]) if bucket["ic"] else None,
            "spread_mean": sum(bucket["spread"]) / len(bucket["spread"]) if bucket["spread"] else None,
            "n": len(bucket["ic"]),
        }
        for year, bucket in sorted(per_year.items())
    }

    return {
        "periods": len(spreads),
        "signals": signals,
        "spread": spread_summary,
        "per_year": years,
    }


def horizon_study(snapshot: dict, horizons: list, min_universe: int) -> dict:
    results = {}
    for step in horizons:
        values = common.ic_series(snapshot, SIGNALS["score"], step, min_universe)
        results[str(step)] = summarize(values)
    return results


def print_frequency(name: str, report: dict) -> None:
    print(f"\n===== {name} anchors (periods={report['periods']}) =====")
    for signal, summary in report["signals"].items():
        low, high = summary["ci95"]
        print(
            f"  IC {signal:12s} mean {summary['mean']:+.3f}  t≈{summary['t']:5.2f}  "
            f"pos {summary['positive_share'] * 100:4.0f}%  n={summary['n']:4d}  "
            f"CI95 [{low:+.3f}, {high:+.3f}]"
        )
    spread = report["spread"]
    low, high = spread["ci95"]
    print(
        f"  top-minus-bottom quintile: mean {spread['mean'] * 100:+.2f}%/period  "
        f"CI95 [{low * 100:+.2f}%, {high * 100:+.2f}%]"
    )
    print("  per year (score IC / spread):")
    for year, bucket in report["per_year"].items():
        if bucket["ic_mean"] is None:
            continue
        print(
            f"    {year}  IC {bucket['ic_mean']:+.3f} (n={bucket['n']:2d})  "
            f"spread {bucket['spread_mean'] * 100:+.2f}%"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frequencies", nargs="+", default=["monthly", "quarterly"])
    parser.add_argument("--horizons", nargs="*", type=int, default=[1, 2, 3, 6])
    parser.add_argument("--horizon-frequency", default="monthly")
    parser.add_argument("--min-universe", type=int, default=30)
    parser.add_argument("--draws", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--save", default=None, help="Write the report JSON to this path")
    args = parser.parse_args()

    session = common.db_session()
    try:
        provenance = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "git_commit": common.git_commit(),
            "database": common.database_fingerprint(),
            "latest_candle": str(common.latest_candle(session)),
            "tracked_coins": common.tracked_coins(session),
            "python": platform.python_version(),
            "seed": args.seed,
            "bootstrap_draws": args.draws,
            "min_universe": args.min_universe,
        }
    finally:
        session.close()

    print("provenance:")
    for key, value in provenance.items():
        print(f"  {key}: {value}")

    snapshots = {frequency: common.load_snapshot(frequency) for frequency in args.frequencies}

    report = {"provenance": provenance, "frequencies": {}}
    for frequency, snapshot in snapshots.items():
        study = evaluate_frequency(snapshot, args.draws, args.seed, args.min_universe)
        if frequency == args.horizon_frequency and args.horizons:
            study["horizons"] = horizon_study(snapshot, args.horizons, args.min_universe)
        report["frequencies"][frequency] = study
        print_frequency(frequency, study)

        if "horizons" in study:
            print("  IC by forward horizon (score, anchor steps):")
            for step, summary in study["horizons"].items():
                print(f"    {step:>2s} step(s): mean {summary['mean']:+.3f}  t≈{summary['t']:5.2f}  n={summary['n']}")

    if args.save:
        path = os.path.abspath(args.save)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as handle:
            json.dump(report, handle, indent=2, sort_keys=True)
        print(f"\nsaved {path}")


if __name__ == "__main__":
    sys.exit(main())
