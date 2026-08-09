"""Ranking-quality, convergence and fairness metrics for RankCraft.

Everything here operates on plain Python lists so it can run inside Pyodide with
no numpy dependency. The hot paths (Kendall tau, Spearman) are O(n log n).

The reference metric for Swiss-system comparison is normalised Kendall tau --
see Biro, Fleiner & Palincza, "Improving Ranking Quality and Fairness in
Swiss-System Chess Tournaments" (arXiv:2112.10522).
"""

from __future__ import annotations

import math

# --------------------------------------------------------------------------
# rank helpers
# --------------------------------------------------------------------------


def ranks_from_order(order):
    """`order` is a list of ids, best first. Returns {id: rank} with rank 1 = best."""
    return {pid: i + 1 for i, pid in enumerate(order)}


def average_ranks(values):
    """Competition-average ranks for a list of values, largest value = rank 1."""
    n = len(values)
    idx = sorted(range(n), key=lambda i: -values[i])
    out = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and values[idx[j + 1]] == values[idx[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            out[idx[k]] = avg
        i = j + 1
    return out


# --------------------------------------------------------------------------
# Kendall tau
# --------------------------------------------------------------------------


def _merge_sort_discordant(arr):
    """Count inversions in `arr` (number of discordant pairs), destructively."""
    n = len(arr)
    if n < 2:
        return 0
    buf = [0] * n
    swaps = 0
    width = 1
    src = arr
    while width < n:
        i = 0
        while i < n:
            mid = min(i + width, n)
            end = min(i + 2 * width, n)
            a, b, k = i, mid, i
            while a < mid and b < end:
                if src[a] <= src[b]:
                    buf[k] = src[a]
                    a += 1
                else:
                    buf[k] = src[b]
                    b += 1
                    swaps += mid - a
                k += 1
            while a < mid:
                buf[k] = src[a]
                a += 1
                k += 1
            while b < end:
                buf[k] = src[b]
                b += 1
                k += 1
            i = end
        src, buf = buf, src
        width *= 2
    if src is not arr:
        arr[:] = src
    return swaps


def _tie_pairs(sorted_vals):
    """Sum of t*(t-1)/2 over runs of equal values in an already-sorted list."""
    total = 0
    i = 0
    n = len(sorted_vals)
    while i < n:
        j = i
        while j + 1 < n and sorted_vals[j + 1] == sorted_vals[i]:
            j += 1
        t = j - i + 1
        total += t * (t - 1) // 2
        i = j + 1
    return total


def kendall_tau_b(x, y):
    """Kendall's tau-b between two equal-length sequences. O(n log n).

    Matches scipy.stats.kendalltau(x, y, variant='b') for finite inputs.
    """
    n = len(x)
    if n < 2:
        return float('nan')
    n0 = n * (n - 1) // 2

    pairs = sorted(zip(x, y))
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]

    xtie = _tie_pairs(xs)

    # joint ties: runs equal in x AND y
    ntie = 0
    i = 0
    while i < n:
        j = i
        while j + 1 < n and xs[j + 1] == xs[i]:
            j += 1
        ntie += _tie_pairs(sorted(ys[i : j + 1]))
        i = j + 1

    ytie = _tie_pairs(sorted(ys))

    dis = _merge_sort_discordant(ys)

    con_minus_dis = n0 - xtie - ytie + ntie - 2 * dis
    denom = math.sqrt((n0 - xtie) * (n0 - ytie))
    if denom == 0:
        return float('nan')
    return max(-1.0, min(1.0, con_minus_dis / denom))


def kendall_tau_orders(order_a, order_b):
    """Tau between two orderings of the same id set (both are strict permutations)."""
    rb = ranks_from_order(order_b)
    xs = list(range(len(order_a)))
    ys = [rb[pid] for pid in order_a]
    return kendall_tau_b(xs, ys)


def normalised_kendall_distance(order_a, order_b):
    """Fraction of pairs ordered differently. 0 = identical, 1 = exactly reversed."""
    n = len(order_a)
    if n < 2:
        return float('nan')
    rb = ranks_from_order(order_b)
    ys = [rb[pid] for pid in order_a]
    dis = _merge_sort_discordant(ys)
    return dis / (n * (n - 1) / 2.0)


# --------------------------------------------------------------------------
# Spearman
# --------------------------------------------------------------------------


def spearman_rho(x, y):
    """Spearman rank correlation, tie-corrected via average ranks."""
    n = len(x)
    if n < 2:
        return float('nan')
    rx = average_ranks(x)
    ry = average_ranks(y)
    mx = sum(rx) / n
    my = sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    dx = math.sqrt(sum((a - mx) ** 2 for a in rx))
    dy = math.sqrt(sum((b - my) ** 2 for b in ry))
    if dx == 0 or dy == 0:
        return float('nan')
    return max(-1.0, min(1.0, num / (dx * dy)))


def spearman_orders(order_a, order_b):
    ra = ranks_from_order(order_a)
    rb = ranks_from_order(order_b)
    ids = list(order_a)
    return spearman_rho([-ra[i] for i in ids], [-rb[i] for i in ids])


# --------------------------------------------------------------------------
# top-k / gain based
# --------------------------------------------------------------------------


def precision_at_k(produced, truth, k):
    """Overlap between the top k of the produced order and the top k of truth."""
    k = min(k, len(truth))
    if k <= 0:
        return float('nan')
    return len(set(produced[:k]) & set(truth[:k])) / float(k)


def ndcg_at_k(produced, gains, k):
    """NDCG@k where `gains` maps id -> non-negative relevance (normalised skill)."""
    k = min(k, len(produced))
    if k <= 0:
        return float('nan')

    def dcg(order):
        return sum(gains[pid] / math.log2(i + 2) for i, pid in enumerate(order[:k]))

    ideal = sorted(produced, key=lambda pid: -gains[pid])
    idcg = dcg(ideal)
    if idcg == 0:
        return float('nan')
    return dcg(produced) / idcg


def displacement(produced, truth):
    """(mean, max) absolute difference between produced rank and true rank."""
    rp = ranks_from_order(produced)
    rt = ranks_from_order(truth)
    diffs = [abs(rp[pid] - rt[pid]) for pid in truth]
    if not diffs:
        return float('nan'), float('nan')
    return sum(diffs) / len(diffs), float(max(diffs))


def churn(order_prev, order_curr):
    """Mean absolute rank movement between two consecutive rounds' rankings."""
    if order_prev is None:
        return float('nan')
    rp = ranks_from_order(order_prev)
    rc = ranks_from_order(order_curr)
    diffs = [abs(rp[pid] - rc[pid]) for pid in rc]
    return sum(diffs) / len(diffs) if diffs else float('nan')


# --------------------------------------------------------------------------
# convergence
# --------------------------------------------------------------------------


def rounds_to_fraction(curve, fraction=0.95):
    """First 1-based round whose tau reaches `fraction` of the final round's tau.

    Returns len(curve) if it is never reached, NaN for an empty/degenerate curve.
    """
    clean = [v for v in curve if v == v]  # drop NaN
    if not clean:
        return float('nan')
    target = curve[-1] * fraction if curve[-1] == curve[-1] else max(clean) * fraction
    for i, v in enumerate(curve):
        if v == v and v >= target:
            return i + 1
    return float(len(curve))
