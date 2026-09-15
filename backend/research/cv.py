"""Purged + embargoed walk-forward folds for forward-return labels.

Samples are anchor dates in ascending order; sample ``i`` has a label that
spans ``(i, i + horizon]``. Plain K-fold or shuffled splits leak the future,
so folds are expanding-window and every training sample whose label would
overlap the test block is purged, plus an ``embargo`` of extra anchors.

    folds = walk_forward_folds(n_samples=120, horizon=1, test_size=12, min_train=24)
"""


def walk_forward_folds(
    n_samples: int,
    horizon: int = 1,
    test_size: int = 12,
    min_train: int = 24,
    embargo: int = 1,
) -> list:
    if horizon < 0 or test_size <= 0 or min_train <= 0 or embargo < 0:
        raise ValueError("horizon/embargo >= 0, test_size and min_train > 0")

    folds = []
    test_start = min_train + horizon + embargo
    while test_start < n_samples:
        train_end = test_start - horizon - embargo
        test_end = min(n_samples, test_start + test_size)
        if train_end < 1:
            break
        folds.append(
            {
                "train": (0, train_end),
                "test": (test_start, test_end),
                "horizon": horizon,
                "embargo": embargo,
            }
        )
        test_start += test_size
    return folds


def assert_no_overlap(folds: list, horizon: int) -> None:
    """Guard for tests/experiments: no training label may reach the test block."""
    for fold in folds:
        train_end = fold["train"][1]
        test_start, test_end = fold["test"]
        if test_start >= test_end:
            raise AssertionError(f"empty test block: {fold}")
        if train_end == 0:
            continue
        last_label_end = (train_end - 1) + horizon
        if last_label_end >= test_start:
            raise AssertionError(
                f"label overlap: train label ends at {last_label_end}, test starts at {test_start}"
            )
        if test_start - last_label_end < fold["embargo"]:
            raise AssertionError("embargo buffer is smaller than requested")
