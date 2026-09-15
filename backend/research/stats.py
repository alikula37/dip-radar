"""Small statistics helpers used by the research scripts (no SciPy dependency)."""

import math


def ranks(values: list) -> list:
    """Average ranks (1-based fractions) so ties do not distort correlations."""
    order = sorted(range(len(values)), key=lambda index: values[index])
    result = [0.0] * len(values)
    index = 0
    while index < len(order):
        end = index
        while end + 1 < len(order) and values[order[end + 1]] == values[order[index]]:
            end += 1
        average = (index + end) / 2.0
        for position in range(index, end + 1):
            result[order[position]] = average
        index = end + 1
    return result


def pearson(xs: list, ys: list):
    n = len(xs)
    if n < 3 or len(ys) != n:
        return None
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    covariance = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    variance_x = sum((x - mean_x) ** 2 for x in xs)
    variance_y = sum((y - mean_y) ** 2 for y in ys)
    if variance_x <= 0 or variance_y <= 0:
        return None
    return covariance / math.sqrt(variance_x * variance_y)


def spearman(xs: list, ys: list):
    """Rank correlation; returns None for degenerate (constant) inputs."""
    return pearson(ranks(xs), ranks(ys))


def summarize(values: list) -> dict:
    n = len(values)
    if n == 0:
        return {"mean": 0.0, "std": 0.0, "t": 0.0, "positive_share": 0.0, "n": 0}
    mean = sum(values) / n
    if n > 1:
        std = math.sqrt(sum((value - mean) ** 2 for value in values) / (n - 1))
    else:
        std = 0.0
    t_stat = mean / std * math.sqrt(n) if std else 0.0
    positive_share = sum(1 for value in values if value > 0) / n
    return {"mean": mean, "std": std, "t": t_stat, "positive_share": positive_share, "n": n}


def block_bootstrap_ci(values: list, block: int = 3, draws: int = 2000, seed: int = 7):
    """Moving-block bootstrap CI for the mean; accounts for serial correlation."""
    import random

    if not values:
        return (0.0, 0.0)
    rng = random.Random(seed)
    n = len(values)
    means = []
    for _ in range(draws):
        sample = []
        while len(sample) < n:
            start = rng.randrange(n)
            sample.extend(values[(start + offset) % n] for offset in range(block))
        sample = sample[:n]
        means.append(sum(sample) / n)
    means.sort()
    return means[int(0.025 * draws)], means[int(0.975 * draws)]
