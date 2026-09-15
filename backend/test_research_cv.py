from research.cv import assert_no_overlap, walk_forward_folds


def test_folds_are_expanding_blocks_without_overlap():
    folds = walk_forward_folds(n_samples=100, horizon=1, test_size=12, min_train=24, embargo=1)

    assert len(folds) == 7
    assert folds[0]["train"] == (0, 24)
    assert folds[0]["test"] == (26, 38)
    assert folds[1]["train"] == (0, 36)
    assert folds[1]["test"] == (38, 50)
    assert folds[-1]["test"] == (98, 100)
    assert_no_overlap(folds, horizon=1)


def test_purge_and_embargo_respect_long_horizons():
    folds = walk_forward_folds(n_samples=90, horizon=6, test_size=10, min_train=30, embargo=2)

    assert folds
    for fold in folds:
        train_end = fold["train"][1]
        assert train_end == fold["test"][0] - 6 - 2
    assert_no_overlap(folds, horizon=6)


def test_no_folds_when_history_is_too_short():
    assert walk_forward_folds(n_samples=20, horizon=1, test_size=12, min_train=24) == []


def test_invalid_parameters_are_rejected():
    import pytest

    with pytest.raises(ValueError):
        walk_forward_folds(n_samples=100, horizon=1, test_size=0)
    with pytest.raises(ValueError):
        walk_forward_folds(n_samples=100, horizon=-1)
    with pytest.raises(ValueError):
        walk_forward_folds(n_samples=100, horizon=1, embargo=-1)


def test_assert_no_overlap_catches_a_leaky_fold():
    import pytest

    bad = [{"train": (0, 30), "test": (28, 40), "horizon": 1, "embargo": 0}]

    with pytest.raises(AssertionError):
        assert_no_overlap(bad, horizon=1)
