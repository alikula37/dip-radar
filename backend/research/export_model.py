"""Freeze a learned score artifact for the Strategy Lab A/B.

Fits the constrained model on point-in-time features up to ``--cutoff`` and
writes ``score_artifacts/<version>.json`` with weights, per-feature scaling
and provenance. The artifact is an experimental option, never a promotion.

Usage (from backend/):

    python -m research.export_model --cutoff 2024-12-31 --version learned_v1
"""

import argparse
import json
import os
from datetime import datetime, timezone

from research import common
from research.model import FEATURE_DIRECTIONS, build_samples, fit_standardized, standardize

ARTIFACT_DIR = os.path.join(common.BACKEND_DIR, "score_artifacts")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frequency", default="monthly", choices=["weekly", "monthly", "quarterly"])
    parser.add_argument("--cutoff", default="2024-12-31", help="Train only on anchors up to this date")
    parser.add_argument("--start", default="2020-01-01")
    parser.add_argument("--version", default="learned_v1")
    parser.add_argument("--train-regime-only", action="store_true", help="Fit only on risk-on anchors")
    parser.add_argument("--report", default=os.path.join("research", "baselines", "model_report.json"))
    args = parser.parse_args()

    from research.feature_store import build_feature_rows

    session = common.db_session()
    try:
        rows = build_feature_rows(session, args.frequency)
    finally:
        session.close()

    rows = [row for row in rows if args.start <= row["date"] <= args.cutoff]
    anchors = build_samples(rows, horizon=1)
    training_anchors = [a for a in anchors if a.get("alt_above_sma") is True] if args.train_regime_only else anchors
    if len(training_anchors) < 12:
        raise SystemExit(f"Only {len(training_anchors)} training anchors; refusing to export a model")
    if len(anchors) < 12:
        raise SystemExit(f"Only {len(anchors)} anchors before {args.cutoff}; refusing to export a model")

    features = [vector for anchor in training_anchors for vector in anchor["features"]]
    labels = [label for anchor in training_anchors for label in anchor["labels"]]
    standardized, means, scales = standardize(features)
    weights = fit_standardized(standardized, labels)

    validation = {"note": "see research/baselines/model_report.json for the walk-forward evaluation"}
    report_path = os.path.join(common.BACKEND_DIR, args.report)
    if os.path.exists(report_path):
        with open(report_path) as handle:
            report = json.load(handle)
        validation = {
            "walk_forward_ic": report.get("model_ic", {}).get("mean"),
            "baseline_ic": report.get("baseline_ic", {}).get("mean"),
            "ic_delta_ci95": report.get("ic_delta", {}).get("ci95"),
            "strategy_gate": "failed: top-3 proxy Sharpe did not beat the baseline",
        }

    artifact = {
        "version": args.version,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "git_commit": common.git_commit(),
        "trained_until": args.cutoff,
        "training": {
            "frequency": args.frequency,
            "horizon": 1,
            "anchors": len(training_anchors),
            "samples": len(features),
            "regime_only": args.train_regime_only,
        },
        "feature_directions": FEATURE_DIRECTIONS,
        "feature_scaling": {
            name: {"mean": means[index], "scale": scales[index]}
            for index, name in enumerate(FEATURE_DIRECTIONS)
        },
        "weights": {name: weights[index] for index, name in enumerate(FEATURE_DIRECTIONS)},
        "validation": validation,
    }

    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    path = os.path.join(ARTIFACT_DIR, f"{args.version}.json")
    with open(path, "w") as handle:
        json.dump(artifact, handle, indent=2, sort_keys=True)

    print(f"trained on {len(anchors)} anchors / {len(features)} samples up to {args.cutoff}")
    print("weights:")
    for name, weight in sorted(artifact["weights"].items(), key=lambda item: -item[1]):
        print(f"  {name:22s} {weight:+.4f}")
    print(f"saved {path}")


if __name__ == "__main__":
    main()
