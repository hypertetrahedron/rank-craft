# RankCraft built-in ranking functions.
#
# `rank_players(t, ctx) -> list[int]` returns every player id exactly once,
# best first. It is called after EVERY round, not just the last one -- that is
# what makes the convergence curve measurable. `ctx.round` tells you where you
# are; `ctx.round == ctx.total_rounds` is the final call.
#
# Most of these are the classic chess tiebreaks: sort by match points, then
# break ties with a secondary number. Two are reference points rather than
# strategies:
#
#   oracle       ranks by true skill. The ceiling. Kendall tau = 1.0 by
#                definition. It is the only function allowed to read p.skill.
#   initial_seed ranks by seeding rating and ignores every result. The floor.
#
# Pin both to your charts -- a tau of 0.82 means nothing without them.

##-- by_score | Match points alone, ties broken by seed. The null hypothesis: does any tiebreak beat just counting points? --##
def rank_players(t, ctx):
    return [p.id for p in sorted(t.players.values(), key=lambda p: (-p.score, p.seed, p.id))]


##-- buchholz | Sum of every opponent's final score (the Solkoff system). A given score is worth more against a field that also scored well. Distorted by early-round luck in who you drew. --##
def rank_players(t, ctx):
    def bh(p):
        return sum(o.score for o in t.opponents_of(p.id))

    return [
        p.id for p in sorted(t.players.values(), key=lambda p: (-p.score, -bh(p), p.seed, p.id))
    ]


##-- buchholz_cut1 | Buchholz with the single weakest opponent dropped. The standard FIDE fix for the one bad draw that drags a whole tiebreak down. --##
PARAMS = {'cut_low': {'default': 1, 'min': 0, 'max': 4, 'step': 1}}


def rank_players(t, ctx):
    cut = int(ctx.params['cut_low'])

    def bh(p):
        scores = sorted(o.score for o in t.opponents_of(p.id))
        return sum(scores[cut:]) if len(scores) > cut else 0.0

    return [
        p.id for p in sorted(t.players.values(), key=lambda p: (-p.score, -bh(p), p.seed, p.id))
    ]


##-- median_buchholz | Buchholz with both the best and worst opponent dropped. Trims the tails from both ends rather than just the bottom. --##
def rank_players(t, ctx):
    def bh(p):
        scores = sorted(o.score for o in t.opponents_of(p.id))
        return sum(scores[1:-1]) if len(scores) > 2 else sum(scores)

    return [
        p.id for p in sorted(t.players.values(), key=lambda p: (-p.score, -bh(p), p.seed, p.id))
    ]


##-- sonneborn_berger | Sum of the scores of the opponents you beat, plus half the scores of those you drew. Rewards beating strong players rather than merely facing them. --##
def rank_players(t, ctx):
    def sb(p):
        total = 0.0
        for opp, mine, theirs in t.results_against(p.id):
            pts = mine + theirs
            frac = 0.5 if pts == 0 else mine / pts
            total += frac * opp.score
        return total

    return [
        p.id for p in sorted(t.players.values(), key=lambda p: (-p.score, -sb(p), p.seed, p.id))
    ]


##-- cumulative | Sum of your running score after each round. Winning early is worth more than winning late, on the theory that an early leader faced harder pairings all tournament. --##
def rank_players(t, ctx):
    def cum(p):
        run = 0.0
        total = 0.0
        for pts in p.results:
            run += pts
            total += run
        return total

    return [
        p.id for p in sorted(t.players.values(), key=lambda p: (-p.score, -cum(p), p.seed, p.id))
    ]


##-- opponent_avg_rating | Average seeding rating of the field you faced (ARO). Uses the published rating rather than in-tournament results, so it is immune to a weak opponent having a good week. --##
def rank_players(t, ctx):
    def aro(p):
        opps = t.opponents_of(p.id)
        return sum(o.rating for o in opps) / len(opps) if opps else 0.0

    return [
        p.id for p in sorted(t.players.values(), key=lambda p: (-p.score, -aro(p), p.seed, p.id))
    ]


##-- by_rating | Rank by the live rating your rating-update hook maintains, ignoring match points entirely. Only meaningful with Elo or Glicko selected in step 4. --##
def rank_players(t, ctx):
    return [p.id for p in sorted(t.players.values(), key=lambda p: (-p.rating, p.seed, p.id))]


##-- score_then_rating | Match points first, live rating as the tiebreak. The natural hybrid: the standings everyone expects, disambiguated by what the rating system learned. --##
def rank_players(t, ctx):
    return [
        p.id
        for p in sorted(t.players.values(), key=lambda p: (-p.score, -p.rating, p.seed, p.id))
    ]


##-- bradley_terry | Fit a Bradley-Terry strength to the whole result graph by MM iteration, then rank by it. Uses every result jointly instead of a one-hop tiebreak, and handles an unbalanced schedule properly. --##
PARAMS = {
    'iterations': {'default': 60, 'min': 5, 'max': 500, 'step': 5},
    'prior': {'default': 0.5, 'min': 0.0, 'max': 4.0, 'step': 0.1},
}


def rank_players(t, ctx):
    ids = list(t.players)
    idx = {pid: i for i, pid in enumerate(ids)}
    n = len(ids)
    prior = ctx.params['prior']

    wins = [prior] * n
    pair_totals = {}
    for r in t.history:
        if r.b is None:
            continue
        ia, ib = idx[r.a], idx[r.b]
        total = r.points_a + r.points_b
        if total == 0:
            continue
        wins[ia] += r.points_a / total
        wins[ib] += r.points_b / total
        key = (min(ia, ib), max(ia, ib))
        pair_totals[key] = pair_totals.get(key, 0) + 1

    # a virtual prior game against a fixed-strength anchor keeps undefeated and
    # winless players finite
    strength = [1.0] * n
    for _ in range(int(ctx.params['iterations'])):
        new = list(strength)
        for i in range(n):
            denom = 2.0 * prior / (strength[i] + 1.0)
            for (x, y), cnt in pair_totals.items():
                if x == i:
                    denom += cnt / (strength[i] + strength[y])
                elif y == i:
                    denom += cnt / (strength[i] + strength[x])
            new[i] = wins[i] / denom if denom > 0 else strength[i]
        geo = sum(math.log(max(1e-12, s)) for s in new) / n
        scale = math.exp(-geo)
        strength = [s * scale for s in new]

    return [
        pid
        for pid in sorted(
            ids, key=lambda p: (-strength[idx[p]], -t.players[p].score, t.players[p].seed, p)
        )
    ]


##-- colley | Colley's bias-free method: solve a linear system that regresses every win-rate toward .500 by strength of schedule. Deterministic, no free parameters, well behaved on tiny samples. --##
def rank_players(t, ctx):
    ids = list(t.players)
    idx = {pid: i for i, pid in enumerate(ids)}
    n = len(ids)

    games = [0] * n
    net = [0.0] * n
    adj = [[0.0] * n for _ in range(n)]

    for r in t.history:
        if r.b is None:
            continue
        ia, ib = idx[r.a], idx[r.b]
        total = r.points_a + r.points_b
        if total == 0:
            continue
        fa = r.points_a / total
        games[ia] += 1
        games[ib] += 1
        net[ia] += fa - 0.5
        net[ib] += (1.0 - fa) - 0.5
        adj[ia][ib] -= 1.0
        adj[ib][ia] -= 1.0

    A = [[adj[i][j] for j in range(n)] for i in range(n)]
    for i in range(n):
        A[i][i] = 2.0 + games[i]
    b = [1.0 + net[i] for i in range(n)]

    r = _solve(A, b)
    if r is None:
        return [p.id for p in sorted(t.players.values(), key=lambda p: (-p.score, p.seed, p.id))]
    return [
        pid
        for pid in sorted(ids, key=lambda p: (-r[idx[p]], -t.players[p].score, t.players[p].seed, p))
    ]


def _solve(A, b):
    """Gaussian elimination with partial pivoting. Returns None if singular."""
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(M[r][col]))
        if abs(M[piv][col]) < 1e-12:
            return None
        M[col], M[piv] = M[piv], M[col]
        pv = M[col][col]
        for r in range(col + 1, n):
            f = M[r][col] / pv
            if f:
                for c in range(col, n + 1):
                    M[r][c] -= f * M[col][c]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        s = M[r][n] - sum(M[r][c] * x[c] for c in range(r + 1, n))
        x[r] = s / M[r][r]
    return x


##-- massey | Massey's least-squares rating on point margins. Unlike Colley it uses how much you won by, so it only differs from Colley when the outcome function returns margins. --##
def _solve(A, b):
    """Gaussian elimination with partial pivoting. Returns None if singular."""
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(M[r][col]))
        if abs(M[piv][col]) < 1e-12:
            return None
        M[col], M[piv] = M[piv], M[col]
        pv = M[col][col]
        for r in range(col + 1, n):
            f = M[r][col] / pv
            if f:
                for c in range(col, n + 1):
                    M[r][c] -= f * M[col][c]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        s = M[r][n] - sum(M[r][c] * x[c] for c in range(r + 1, n))
        x[r] = s / M[r][r]
    return x


def rank_players(t, ctx):
    ids = list(t.players)
    idx = {pid: i for i, pid in enumerate(ids)}
    n = len(ids)

    A = [[0.0] * n for _ in range(n)]
    b = [0.0] * n
    for r in t.history:
        if r.b is None:
            continue
        ia, ib = idx[r.a], idx[r.b]
        margin = r.points_a - r.points_b
        A[ia][ia] += 1.0
        A[ib][ib] += 1.0
        A[ia][ib] -= 1.0
        A[ib][ia] -= 1.0
        b[ia] += margin
        b[ib] -= margin

    # replace the last equation with sum(rating) = 0 to make the system solvable
    A[n - 1] = [1.0] * n
    b[n - 1] = 0.0

    r = _solve(A, b)
    if r is None:
        return [p.id for p in sorted(t.players.values(), key=lambda p: (-p.score, p.seed, p.id))]
    return [
        pid
        for pid in sorted(ids, key=lambda p: (-r[idx[p]], -t.players[p].score, t.players[p].seed, p))
    ]


##-- pagerank_wins | PageRank over the graph where every loss points at the winner. Beating someone who beat strong players propagates back to you transitively. --##
PARAMS = {
    'damping': {'default': 0.85, 'min': 0.5, 'max': 0.99, 'step': 0.01},
    'iterations': {'default': 60, 'min': 5, 'max': 300, 'step': 5},
}


def rank_players(t, ctx):
    ids = list(t.players)
    idx = {pid: i for i, pid in enumerate(ids)}
    n = len(ids)
    d = ctx.params['damping']

    out = [[0.0] * n for _ in range(n)]
    for r in t.history:
        if r.b is None:
            continue
        ia, ib = idx[r.a], idx[r.b]
        total = r.points_a + r.points_b
        if total == 0:
            continue
        fa = r.points_a / total
        out[ib][ia] += fa  # loser sends weight to the winner
        out[ia][ib] += 1.0 - fa

    rank = [1.0 / n] * n
    for _ in range(int(ctx.params['iterations'])):
        nxt = [(1.0 - d) / n] * n
        dangling = 0.0
        for i in range(n):
            s = sum(out[i])
            if s == 0:
                dangling += rank[i]
                continue
            for j in range(n):
                if out[i][j]:
                    nxt[j] += d * rank[i] * out[i][j] / s
        if dangling:
            for j in range(n):
                nxt[j] += d * dangling / n
        rank = nxt

    return [
        pid
        for pid in sorted(ids, key=lambda p: (-rank[idx[p]], -t.players[p].score, t.players[p].seed, p))
    ]


##-- w40k_standings | How a real 40k event ranks: win/loss record first, total battle points as the tiebreak. Battle points only ever separate players on the same record — a 5-1 never outranks a 6-0 no matter how the games went. --##
def rank_players(t, ctx):
    return [
        p.id
        for p in sorted(t.players.values(), key=lambda p: (-t.wins(p.id), -p.score, p.seed, p.id))
    ]


##-- w40k_standings_sos | Record, then strength of schedule (opponents' average win total), then battle points. The usual answer to "the 5-1 who played murderers' row should beat the 5-1 who did not". --##
def rank_players(t, ctx):
    def sos(p):
        opps = t.opponents_of(p.id)
        return sum(t.wins(o.id) for o in opps) / len(opps) if opps else 0.0

    return [
        p.id
        for p in sorted(
            t.players.values(), key=lambda p: (-t.wins(p.id), -sos(p), -p.score, p.seed, p.id)
        )
    ]


##-- ridge_wl | The same Bayesian estimator as ridge_margin, but fed only win/loss (+1/-1) with the margins discarded. It exists to isolate what the margin is worth: run it against ridge_margin on the same seed and the gap is the value of the information the record throws away, with the estimator held constant. --##
PARAMS = {'ridge': {'default': 1.0, 'min': 0.05, 'max': 20.0, 'step': 0.05}}


def rank_players(t, ctx):
    mu = ridge_ratings(
        t,
        observe=lambda r: 1.0 if r.points_a > r.points_b else (-1.0 if r.points_a < r.points_b else 0.0),
        ridge=ctx.params['ridge'],
    )
    return [pid for pid in sorted(t.players, key=lambda p: (-mu[p], t.players[p].seed, p))]


##-- ridge_margin | Ridge-regularised least squares on the battle-point margins — the maximum a posteriori estimate of a Gaussian model in which every game observes margin = skill_i - skill_j + noise, under a N(0, tau^2) prior. Equivalent to Massey's method with a prior; the ridge term is what keeps an undefeated player finite. It uses the whole result graph at once, so a narrow loss to the eventual winner lifts you and a thrashing of a bottom table does not. --##
PARAMS = {'ridge': {'default': 1.0, 'min': 0.05, 'max': 20.0, 'step': 0.05}}


def rank_players(t, ctx):
    mu = ridge_ratings(t, ridge=ctx.params['ridge'])
    return [pid for pid in sorted(t.players, key=lambda p: (-mu[p], -t.players[p].score, p))]


##-- ridge_margin_capped | ridge_margin with the margin compressed before fitting, the way FiveThirtyEight's NFL Elo discounts blowouts: a 40 point win should not count much more than a 30 point one, because the scoreboard saturates and the extra margin is mostly noise. Uses sign(m) * cap * log1p(|m|/cap) / log 2. --##
PARAMS = {
    'ridge': {'default': 1.0, 'min': 0.05, 'max': 20.0, 'step': 0.05},
    'cap': {'default': 20.0, 'min': 2.0, 'max': 100.0, 'step': 1.0},
}


def rank_players(t, ctx):
    cap = ctx.params['cap']

    def compress(r):
        raw = r.points_a - r.points_b
        sign = 1.0 if raw >= 0 else -1.0
        return sign * cap * math.log1p(abs(raw) / cap) / math.log(2.0)

    mu = ridge_ratings(t, observe=compress, ridge=ctx.params['ridge'])
    return [pid for pid in sorted(t.players, key=lambda p: (-mu[p], -t.players[p].score, p))]


##-- elo_mov | Sequential Elo with FiveThirtyEight's margin-of-victory multiplier ln(|margin|+1) and their autocorrelation correction 2.2/(2.2 + 0.001*edge), which stops a strong player being paid twice for beating a weak one. Sequential rather than batch, so it is what you could actually run between rounds on a laptop. --##
PARAMS = {
    'k': {'default': 24.0, 'min': 1.0, 'max': 120.0, 'step': 1.0},
    'scale': {'default': 200.0, 'min': 25.0, 'max': 800.0, 'step': 25.0},
}


def rank_players(t, ctx):
    k = ctx.params['k']
    scale = ctx.params['scale']
    rating = {pid: 0.0 for pid in t.players}

    for rnd in range(1, ctx.round + 1):
        for r in t.history:
            if r.round != rnd or r.b is None:
                continue
            ra, rb = rating[r.a], rating[r.b]
            expected = 1.0 / (1.0 + 10.0 ** ((rb - ra) / scale))
            margin = r.points_a - r.points_b
            actual = 1.0 if margin > 0 else (0.5 if margin == 0 else 0.0)
            mov = math.log1p(abs(margin))
            winner_edge = (ra - rb) if margin > 0 else (rb - ra)
            auto = 2.2 / (2.2 + 0.001 * winner_edge)
            delta = k * mov * auto * (actual - expected)
            rating[r.a] += delta
            rating[r.b] -= delta

    return [pid for pid in sorted(t.players, key=lambda p: (-rating[p], -t.players[p].score, p))]


##-- record_then_ridge | Record first, the margin model as the tiebreak. Keeps the property players care about — nobody with a worse record finishes above you — while using the full margin information to order everyone inside a bracket. The conservative way to adopt any of this. --##
PARAMS = {'ridge': {'default': 1.0, 'min': 0.05, 'max': 20.0, 'step': 0.05}}


def rank_players(t, ctx):
    mu = ridge_ratings(t, ridge=ctx.params['ridge'])
    return [pid for pid in sorted(t.players, key=lambda p: (-t.wins(p), -mu[p], p))]


##-- whole_history | Whole History Rating: every player gets a rating *per round* rather than one for the tournament, tied together by a random-walk prior that says strength changes slowly. Fitted by Newton iteration over the whole result graph at once. The only ranking here that can represent a player who tired, improved, or was misjudged early — set `drift` to near zero and it collapses to a plain Bradley-Terry fit. --##
PARAMS = {
    'drift': {'default': 0.6, 'min': 0.01, 'max': 3.0, 'step': 0.01},
    'iterations': {'default': 12, 'min': 2, 'max': 60, 'step': 1},
}


def rank_players(t, ctx):
    import numpy as np

    w2 = ctx.params['drift'] ** 2
    games = {}
    for r in t.history:
        if r.b is None:
            continue
        total = r.points_a + r.points_b
        s = 0.5 if total == 0 else r.points_a / total
        games.setdefault(r.a, []).append((r.round, r.b, s))
        games.setdefault(r.b, []).append((r.round, r.a, 1.0 - s))

    if not games:
        return [p.id for p in sorted(t.players.values(), key=lambda p: (p.seed, p.id))]

    rounds = {pid: sorted({g[0] for g in gs}) for pid, gs in games.items()}
    ridx = {pid: {rd: i for i, rd in enumerate(rounds[pid])} for pid in games}
    rating = {pid: np.zeros(len(rounds[pid])) for pid in games}

    def rating_at(pid, rd):
        """That player's strength as of round rd — the latest estimate at or before it."""
        if pid not in rounds:
            return 0.0
        i = 0
        for k, x in enumerate(rounds[pid]):
            if x <= rd:
                i = k
        return rating[pid][i]

    for _ in range(int(ctx.params['iterations'])):
        for pid, gs in games.items():
            n = len(rounds[pid])
            grad = np.zeros(n)
            hess = np.zeros((n, n))

            for rd, opp, s in gs:
                i = ridx[pid][rd]
                e = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, rating[pid][i] - rating_at(opp, rd)))))
                grad[i] += s - e
                hess[i, i] -= e * (1.0 - e)

            # Wiener prior: consecutive rounds are tied together, loosely
            for i in range(n - 1):
                dt = max(1e-6, (rounds[pid][i + 1] - rounds[pid][i]) * w2)
                d = (rating[pid][i + 1] - rating[pid][i]) / dt
                grad[i] += d
                grad[i + 1] -= d
                hess[i, i] -= 1.0 / dt
                hess[i + 1, i + 1] -= 1.0 / dt
                hess[i, i + 1] += 1.0 / dt
                hess[i + 1, i] += 1.0 / dt

            # weak anchor keeps the system solvable for an undefeated player
            for i in range(n):
                hess[i, i] -= 0.001

            try:
                step = np.linalg.solve(hess, grad)
            except Exception:
                continue
            rating[pid] = rating[pid] - np.clip(step, -1.0, 1.0)

    latest = {pid: float(rating[pid][-1]) for pid in rating}
    return [
        pid
        for pid in sorted(
            t.players,
            key=lambda p: (-latest.get(p, -1e9), -t.players[p].score, t.players[p].seed, p),
        )
    ]


##-- matchup_adjusted | For fields where matchups are non-transitive. Fits skill and the archetype-versus-archetype effect *jointly*, so a player who happened to draw favourable matchups all day does not get credit for it. Archetype is public information — you can see the army across the table — so unlike true skill this is legitimate to use. Falls back to plain ridge_margin when every player shares an archetype. --##
PARAMS = {
    'ridge': {'default': 1.0, 'min': 0.05, 'max': 20.0, 'step': 0.05},
    'matchup_ridge': {'default': 0.5, 'min': 0.01, 'max': 20.0, 'step': 0.01},
}


def rank_players(t, ctx):
    import numpy as np

    ids = sorted(t.players)
    idx = {p: i for i, p in enumerate(ids)}
    n = len(ids)

    archs = sorted({p.archetype for p in t.players.values()})
    # unordered archetype pairs get one antisymmetric coefficient each
    pair_idx = {}
    for i, x in enumerate(archs):
        for y in archs[i + 1 :]:
            pair_idx[(x, y)] = n + len(pair_idx)
    k = len(pair_idx)

    if k == 0:
        mu = ridge_ratings(t, ridge=ctx.params['ridge'])
        return [pid for pid in sorted(ids, key=lambda p: (-mu[p], -t.players[p].score, p))]

    # normal equations for [skills | matchup effects] against the margins
    m = n + k
    A = np.zeros((m, m))
    b = np.zeros(m)
    for i in range(n):
        A[i, i] += ctx.params['ridge']
    for j in range(k):
        A[n + j, n + j] += ctx.params['matchup_ridge']

    for r in t.history:
        if r.b is None:
            continue
        row = np.zeros(m)
        row[idx[r.a]] = 1.0
        row[idx[r.b]] = -1.0
        aa, ab = t.players[r.a].archetype, t.players[r.b].archetype
        if aa != ab:
            key = (min(aa, ab), max(aa, ab))
            row[pair_idx[key]] = 1.0 if aa < ab else -1.0
        A += np.outer(row, row)
        b += row * (r.points_a - r.points_b)

    theta = np.linalg.solve(A, b)
    return [
        pid
        for pid in sorted(ids, key=lambda p: (-theta[idx[p]], -t.players[p].score, p))
    ]


##-- oracle | Rank by true skill. The ceiling: Kendall tau is 1.0 by construction. Pin this to every chart so the other numbers have a scale. --##
def rank_players(t, ctx):
    return [p.id for p in sorted(t.players.values(), key=lambda p: (-p.skill, p.id))]


##-- initial_seed | Rank by seeding position and ignore every result. The floor: this is how good you would look without holding the tournament at all. --##
def rank_players(t, ctx):
    return [p.id for p in sorted(t.players.values(), key=lambda p: (p.seed, p.id))]
