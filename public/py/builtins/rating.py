# RankCraft built-in rating-update functions.
#
# `update_ratings(t, results, ctx) -> None`
#
# Called after every round with that round's MatchRecords. Mutate `p.rating`
# (and `p.rating_dev` if your system tracks uncertainty) in place; return
# nothing. Byes appear in `results` with b = None -- most systems ignore them.
#
# This hook is what makes `by_live_rating` pairing and the rating-based ranking
# functions meaningful. With `none`, ratings stay at their seeding values.

##-- none | Leave ratings alone. Ratings stay at their seeding value all tournament. --##
def update_ratings(t, results, ctx):
    return


##-- elo | Classic Elo. Each player moves by K * (actual - expected), with the expectation from the logistic curve. Normalises multi-point scoring to a 0..1 outcome first. --##
PARAMS = {
    'k': {'default': 32.0, 'min': 1.0, 'max': 128.0, 'step': 1.0},
    'scale': {'default': 400.0, 'min': 25.0, 'max': 1200.0, 'step': 25.0},
}


def update_ratings(t, results, ctx):
    k = ctx.params['k']
    scale = ctx.params['scale']
    deltas = {}
    for r in results:
        if r.b is None:
            continue
        a, b = t.players[r.a], t.players[r.b]
        total = r.points_a + r.points_b
        actual = 0.5 if total == 0 else r.points_a / total
        expected = 1.0 / (1.0 + 10.0 ** ((b.rating - a.rating) / scale))
        d = k * (actual - expected)
        deltas[a.id] = deltas.get(a.id, 0.0) + d
        deltas[b.id] = deltas.get(b.id, 0.0) - d
    for pid, d in deltas.items():
        t.players[pid].rating += d


##-- elo_decaying_k | Elo with a K that shrinks as the tournament goes on, so early results move a rating more than late ones. Converges faster but can lock in early luck. --##
PARAMS = {
    'k_start': {'default': 64.0, 'min': 1.0, 'max': 200.0, 'step': 1.0},
    'k_end': {'default': 16.0, 'min': 1.0, 'max': 200.0, 'step': 1.0},
    'scale': {'default': 400.0, 'min': 25.0, 'max': 1200.0, 'step': 25.0},
}


def update_ratings(t, results, ctx):
    frac = (ctx.round - 1) / max(1, ctx.total_rounds - 1)
    k = ctx.params['k_start'] + (ctx.params['k_end'] - ctx.params['k_start']) * frac
    scale = ctx.params['scale']
    deltas = {}
    for r in results:
        if r.b is None:
            continue
        a, b = t.players[r.a], t.players[r.b]
        total = r.points_a + r.points_b
        actual = 0.5 if total == 0 else r.points_a / total
        expected = 1.0 / (1.0 + 10.0 ** ((b.rating - a.rating) / scale))
        d = k * (actual - expected)
        deltas[a.id] = deltas.get(a.id, 0.0) + d
        deltas[b.id] = deltas.get(b.id, 0.0) - d
    for pid, d in deltas.items():
        t.players[pid].rating += d


##-- glicko2 | Glicko-2 with a one-game rating period. Tracks uncertainty in `rating_dev`, so a player with a volatile record moves further than a settled one. Uncertain players converge much faster than Elo. --##
PARAMS = {'tau': {'default': 0.5, 'min': 0.2, 'max': 1.2, 'step': 0.1}}

_Q = 173.7178


def update_ratings(t, results, ctx):
    tau = ctx.params['tau']
    updates = {}

    for r in results:
        if r.b is None:
            continue
        for me, opp, mine, theirs in (
            (t.players[r.a], t.players[r.b], r.points_a, r.points_b),
            (t.players[r.b], t.players[r.a], r.points_b, r.points_a),
        ):
            total = mine + theirs
            s = 0.5 if total == 0 else mine / total

            mu = (me.rating - 1500.0) / _Q
            phi = me.rating_dev / _Q
            mu_j = (opp.rating - 1500.0) / _Q
            phi_j = opp.rating_dev / _Q

            g = 1.0 / math.sqrt(1.0 + 3.0 * phi_j * phi_j / (math.pi * math.pi))
            e = 1.0 / (1.0 + math.exp(-g * (mu - mu_j)))
            v = 1.0 / max(1e-9, g * g * e * (1.0 - e))
            delta = v * g * (s - e)

            sigma = me.meta.get('sigma', 0.06)
            a = math.log(sigma * sigma)
            eps = 0.000001

            def f(x):
                ex = math.exp(x)
                num = ex * (delta * delta - phi * phi - v - ex)
                den = 2.0 * (phi * phi + v + ex) ** 2
                return num / den - (x - a) / (tau * tau)

            A = a
            if delta * delta > phi * phi + v:
                B = math.log(delta * delta - phi * phi - v)
            else:
                k = 1
                while f(a - k * tau) < 0 and k < 100:
                    k += 1
                B = a - k * tau
            fa, fb = f(A), f(B)
            for _ in range(100):
                if abs(B - A) <= eps:
                    break
                C = A + (A - B) * fa / (fb - fa)
                fc = f(C)
                if fc * fb <= 0:
                    A, fa = B, fb
                else:
                    fa = fa / 2.0
                B, fb = C, fc
            sigma_new = math.exp(A / 2.0)

            phi_star = math.sqrt(phi * phi + sigma_new * sigma_new)
            phi_new = 1.0 / math.sqrt(1.0 / (phi_star * phi_star) + 1.0 / v)
            mu_new = mu + phi_new * phi_new * g * (s - e)

            updates[me.id] = (
                mu_new * _Q + 1500.0,
                max(30.0, min(350.0, phi_new * _Q)),
                sigma_new,
            )

    for pid, (rating, dev, sigma) in updates.items():
        p = t.players[pid]
        p.rating = rating
        p.rating_dev = dev
        p.meta['sigma'] = sigma


##-- performance_rating | Rebuild every rating from scratch each round as "average opponent rating + a bonus for the score". Stateless, so early luck cannot compound. --##
PARAMS = {'scale': {'default': 400.0, 'min': 25.0, 'max': 1200.0, 'step': 25.0}}


def update_ratings(t, results, ctx):
    scale = ctx.params['scale']
    new = {}
    for p in t.players.values():
        games = t.results_against(p.id)
        if not games:
            new[p.id] = p.rating
            continue
        opp_avg = sum(o.rating for o, _m, _t in games) / len(games)
        scored = sum(m for _o, m, _t in games)
        possible = sum(m + tt for _o, m, tt in games)
        frac = 0.5 if possible == 0 else scored / possible
        frac = min(0.99, max(0.01, frac))
        new[p.id] = opp_avg + scale * math.log10(frac / (1.0 - frac))
    for pid, r in new.items():
        t.players[pid].rating = r


##-- trueskill | TrueSkill for one-on-one games: each player is a Gaussian belief, and every result moves the mean by an amount proportional to how surprising it was and shrinks the variance by how much it taught you. Unlike Elo's fixed K, an uncertain player moves a long way and a settled one barely moves, which is what makes it converge fast on an unrated field. --##
PARAMS = {
    'beta': {'default': 90.0, 'min': 10.0, 'max': 400.0, 'step': 10.0},
    'tau': {'default': 6.0, 'min': 0.0, 'max': 60.0, 'step': 1.0},
    'draw_probability': {'default': 0.05, 'min': 0.0, 'max': 0.4, 'step': 0.01},
}

_SQRT2 = math.sqrt(2.0)
_SQRT2PI = math.sqrt(2.0 * math.pi)


def _pdf(x):
    return math.exp(-0.5 * x * x) / _SQRT2PI


def _cdf(x):
    return 0.5 * (1.0 + math.erf(x / _SQRT2))


def _v_win(t, eps):
    """Mean of the truncated Gaussian — how far a result drags the belief."""
    denom = _cdf(t - eps)
    if denom < 1e-9:
        return eps - t  # deep in the tail; fall back to the limiting value
    return _pdf(t - eps) / denom


def _w_win(t, eps):
    """Variance multiplier — how much the result taught you."""
    v = _v_win(t, eps)
    return min(1.0 - 1e-9, max(0.0, v * (v + t - eps)))


def _v_draw(t, eps):
    a, b = eps - t, -eps - t
    denom = _cdf(a) - _cdf(b)
    if abs(denom) < 1e-9:
        return (eps if t < 0 else -eps) - t
    return (_pdf(b) - _pdf(a)) / denom


def _w_draw(t, eps):
    a, b = eps - t, -eps - t
    denom = _cdf(a) - _cdf(b)
    if abs(denom) < 1e-9:
        return 1.0
    v = _v_draw(t, eps)
    return min(1.0 - 1e-9, max(0.0, v * v + (a * _pdf(a) - b * _pdf(b)) / denom))


def update_ratings(t, results, ctx):
    beta = ctx.params['beta']
    tau = ctx.params['tau']
    # draw margin in the same units as skill, from the assumed draw rate
    eps = _cdf((ctx.params['draw_probability'] + 1.0) / 2.0) * math.sqrt(2.0) * beta * 0.5

    for r in results:
        if r.b is None:
            continue
        pa, pb = t.players[r.a], t.players[r.b]

        # dynamics: uncertainty grows a little between rounds, so a player is
        # never so settled that new evidence cannot move them
        sa2 = pa.rating_dev ** 2 + tau ** 2
        sb2 = pb.rating_dev ** 2 + tau ** 2

        c2 = 2.0 * beta * beta + sa2 + sb2
        c = math.sqrt(c2)

        if r.points_a == r.points_b:
            winner, loser, sw2, sl2 = pa, pb, sa2, sb2
            drawn = True
        elif r.points_a > r.points_b:
            winner, loser, sw2, sl2 = pa, pb, sa2, sb2
            drawn = False
        else:
            winner, loser, sw2, sl2 = pb, pa, sb2, sa2
            drawn = False

        diff = (winner.rating - loser.rating) / c
        v = _v_draw(diff, eps / c) if drawn else _v_win(diff, eps / c)
        w = _w_draw(diff, eps / c) if drawn else _w_win(diff, eps / c)

        winner.rating += sw2 / c * v
        loser.rating -= sl2 / c * v
        winner.rating_dev = math.sqrt(max(1e-6, sw2 * (1.0 - sw2 / c2 * w)))
        loser.rating_dev = math.sqrt(max(1e-6, sl2 * (1.0 - sl2 / c2 * w)))
