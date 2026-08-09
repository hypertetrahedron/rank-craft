# RankCraft built-in pairing functions.
#
# `pair_round(t, ctx) -> list[(a, b)]`, where b is None for a bye.
# The first element of each pair gets white (+1), the second black (-1).
#
# The harness validates the result: every player exactly once, and exactly one
# bye when the field is odd. Helpers available without importing anything:
#
#   max_weight_pairing(ids, weight_fn, allow_bye_for=None)  optimal matching
#   assign_colors(t, pairs)                                 orient pairs by colour need
#   pick_bye(t)                                             lowest player without a bye yet
#
# Reading `p.skill` here is cheating -- it is ground truth. Use `p.rating`
# and `p.score`, which is what a real arbiter has.

##-- random | Shuffle and pair off. The naive baseline. --##
def pair_round(t, ctx):
    ids = list(t.players)
    ctx.rng.shuffle(ids)
    pairs = []
    bye = None
    if len(ids) % 2 == 1:
        bye = pick_bye(t)
        ids = [i for i in ids if i != bye]
    for i in range(0, len(ids), 2):
        pairs.append((ids[i], ids[i + 1]))
    if bye is not None:
        pairs.append((bye, None))
    return assign_colors(t, pairs)


##-- random2 | Random within score groups. Keeps the Swiss principle of pairing equals, but picks arbitrarily inside each group. Scores close to Burstein for ranking quality. --##
def pair_round(t, ctx):
    bye = pick_bye(t) if len(t.players) % 2 == 1 else None
    pool = []
    for _score, group in t.score_groups().items():
        ids = [p.id for p in group if p.id != bye]
        ctx.rng.shuffle(ids)
        pool.extend(ids)
    pairs = [(pool[i], pool[i + 1]) for i in range(0, len(pool) - 1, 2)]
    if bye is not None:
        pairs.append((bye, None))
    return assign_colors(t, pairs)


##-- monrad | Adjacent pairing straight down the standings: 1v2, 3v4, 5v6. Simple and fast, but the literature ranks it last for ranking quality. --##
def pair_round(t, ctx):
    bye = pick_bye(t) if len(t.players) % 2 == 1 else None
    ids = [p.id for p in t.standings() if p.id != bye]
    used = set()
    pairs = []
    for i, a in enumerate(ids):
        if a in used:
            continue
        used.add(a)
        for b in ids[i + 1 :]:
            if b in used or t.have_played(a, b):
                continue
            used.add(b)
            pairs.append((a, b))
            break
        else:
            # nobody legal left; take the first unused player even if it repeats
            for b in ids[i + 1 :]:
                if b not in used:
                    used.add(b)
                    pairs.append((a, b))
                    break
    if bye is not None:
        pairs.append((bye, None))
    return assign_colors(t, pairs)


##-- dutch_slide | The classic Dutch fold: within each score group, slide the top half against the bottom half (1v5, 2v6, ...), with the lowest player downfloating when the group is odd. Transpositions are found by optimal matching inside the group, so rematches and colour clashes are avoided rather than merely hoped for. --##
PARAMS = {
    'slide_weight': {'default': 100.0, 'min': 1.0, 'max': 1000.0, 'step': 10.0},
    'color_weight': {'default': 30.0, 'min': 0.0, 'max': 500.0, 'step': 5.0},
    'repeat_penalty': {'default': 1000000.0, 'min': 0.0, 'max': 10000000.0, 'step': 100000.0},
}


def pair_round(t, ctx):
    bye = pick_bye(t) if len(t.players) % 2 == 1 else None
    sw = ctx.params['slide_weight']
    cw = ctx.params['color_weight']
    rp = ctx.params['repeat_penalty']

    groups = list(t.score_groups().values())
    pairs = []
    pool = []

    for gi, group in enumerate(groups):
        # downfloaters from the group above are already in `pool`, at the top:
        # they outscore everyone here
        pool.extend(p for p in group if p.id != bye)
        is_last = gi == len(groups) - 1
        if not pool:
            continue

        floated = []
        if len(pool) % 2 == 1:
            floated = [pool.pop()]  # lowest player downfloats

        rank = {p.id: i for i, p in enumerate(pool)}
        half = len(pool) // 2
        ids = [p.id for p in pool]

        def weight(a, b, rank=rank, half=half):
            hi, lo = sorted((rank[a], rank[b]))
            # the textbook Dutch pairing sends player i against player i + half;
            # every step away from that is a transposition, and costs
            w = -sw * abs(lo - (hi + half))
            if t.have_played(a, b):
                w -= rp
            pa, pb = t.players[a], t.players[b]
            w += cw * (1 if pa.color_balance() * pb.color_balance() <= 0 else -1)
            return w

        got = max_weight_pairing(ids, weight) if ids else []

        # A bracket that has already played itself out cannot be paired legally
        # on its own. Rather than force a rematch, collapse it into the next
        # score group and try again with more players to work with — the same
        # escalation a real arbiter performs.
        if not is_last and any(t.have_played(a, b) for a, b in got):
            pool.extend(floated)
            continue

        pairs.extend(got)
        pool = floated

    if pool:
        raise ContractError('dutch_slide left %s unpaired' % [p.id for p in pool])
    if bye is not None:
        pairs.append((bye, None))
    return assign_colors(t, pairs)


##-- burstein | Maximum-weight matching over the whole field at once: minimise score distance, penalise rematches and colour repeats. Edmonds' blossom algorithm. Best ranking quality in the arXiv:2112.10522 comparison. --##
PARAMS = {
    'score_weight': {'default': 1000.0, 'min': 1.0, 'max': 5000.0, 'step': 50.0},
    'color_weight': {'default': 40.0, 'min': 0.0, 'max': 500.0, 'step': 10.0},
    'repeat_penalty': {'default': 1000000.0, 'min': 0.0, 'max': 10000000.0, 'step': 100000.0},
}


def pair_round(t, ctx):
    bye = pick_bye(t) if len(t.players) % 2 == 1 else None
    sw = ctx.params['score_weight']
    cw = ctx.params['color_weight']
    rp = ctx.params['repeat_penalty']
    span = max(1.0, t.max_score() or 1.0)

    def weight(a, b):
        pa, pb = t.players[a], t.players[b]
        w = -sw * abs(pa.score - pb.score) / span
        if t.have_played(a, b):
            w -= rp
        # reward pairs whose colour needs are opposite
        w += cw * (1 if pa.color_balance() * pb.color_balance() <= 0 else -1)
        return w

    pairs = max_weight_pairing(list(t.players), weight, allow_bye_for=bye)
    return assign_colors(t, pairs)


##-- mwm_tunable | The same maximum-weight matching with every knob exposed: score distance, rating distance, rematch penalty, colour balance, float penalty. Sweep these to find what actually drives ranking quality. --##
PARAMS = {
    'score_weight': {'default': 1000.0, 'min': 0.0, 'max': 5000.0, 'step': 50.0},
    'rating_weight': {'default': 0.0, 'min': 0.0, 'max': 1000.0, 'step': 25.0},
    'color_weight': {'default': 40.0, 'min': 0.0, 'max': 500.0, 'step': 10.0},
    'float_penalty': {'default': 25.0, 'min': 0.0, 'max': 500.0, 'step': 5.0},
    'repeat_penalty': {'default': 1000000.0, 'min': 0.0, 'max': 10000000.0, 'step': 100000.0},
}


def pair_round(t, ctx):
    bye = pick_bye(t) if len(t.players) % 2 == 1 else None
    p = ctx.params
    span = max(1.0, t.max_score() or 1.0)
    ratings = [pl.rating for pl in t.players.values()]
    rspan = max(1.0, max(ratings) - min(ratings))

    def weight(a, b):
        pa, pb = t.players[a], t.players[b]
        w = -p['score_weight'] * abs(pa.score - pb.score) / span
        w -= p['rating_weight'] * abs(pa.rating - pb.rating) / rspan
        if t.have_played(a, b):
            w -= p['repeat_penalty']
        w += p['color_weight'] * (1 if pa.color_balance() * pb.color_balance() <= 0 else -1)
        if pa.score != pb.score:
            w -= p['float_penalty'] * (abs(sum(pa.floats)) + abs(sum(pb.floats)))
        return w

    pairs = max_weight_pairing(list(t.players), weight, allow_bye_for=bye)
    return assign_colors(t, pairs)


##-- accelerated | Dutch pairing over *virtual* scores: the top half gets bonus points for the first few rounds, forcing strong-vs-strong early. Used in large opens to separate the leaders faster. --##
PARAMS = {
    'boost_rounds': {'default': 2, 'min': 0, 'max': 8, 'step': 1},
    'boost': {'default': 1.0, 'min': 0.0, 'max': 3.0, 'step': 0.5},
}


def pair_round(t, ctx):
    boost = ctx.params['boost'] if ctx.round <= ctx.params['boost_rounds'] else 0.0
    half = (len(t.players) + 1) // 2
    virtual = {}
    for p in t.players.values():
        virtual[p.id] = p.score + (boost if p.seed <= half else 0.0)

    bye = pick_bye(t) if len(t.players) % 2 == 1 else None
    ids = sorted(
        (i for i in t.players if i != bye),
        key=lambda i: (-virtual[i], -t.players[i].rating, t.players[i].seed),
    )
    span = max(1.0, max(virtual.values()) - min(virtual.values()) or 1.0)

    def weight(a, b):
        w = -1000.0 * abs(virtual[a] - virtual[b]) / span
        if t.have_played(a, b):
            w -= 1000000.0
        pa, pb = t.players[a], t.players[b]
        w += 40.0 * (1 if pa.color_balance() * pb.color_balance() <= 0 else -1)
        return w

    pairs = max_weight_pairing(ids, weight, allow_bye_for=bye)
    return assign_colors(t, pairs)


##-- king_of_the_hill | Ignore score groups entirely and pair strictly adjacent players in the *current ranking*, not the score table. A useful contrast: it optimises for information, not fairness. --##
def pair_round(t, ctx):
    bye = pick_bye(t) if len(t.players) % 2 == 1 else None
    ranked = sorted(
        (p for p in t.players.values() if p.id != bye),
        key=lambda p: (-p.rating, -p.score, p.seed),
    )
    ids = [p.id for p in ranked]

    def weight(a, b):
        ia, ib = ids.index(a), ids.index(b)
        w = -abs(ia - ib) * 100.0
        if t.have_played(a, b):
            w -= 1000000.0
        return w

    pairs = max_weight_pairing(ids, weight, allow_bye_for=bye)
    return assign_colors(t, pairs)


##-- w40k_swiss | How a real 40k event pairs: bucket players by win/loss record, then fold the top half of each bracket onto the bottom half. Battle points only break ties inside a bracket — the pairing itself never looks at margin. --##
PARAMS = {'repeat_penalty': {'default': 1000000.0, 'min': 0.0, 'max': 10000000.0, 'step': 100000.0}}


def pair_round(t, ctx):
    bye = pick_bye(t) if len(t.players) % 2 == 1 else None
    rp = ctx.params['repeat_penalty']

    brackets = {}
    for p in t.players.values():
        if p.id == bye:
            continue
        brackets.setdefault(t.wins(p.id), []).append(p)

    pairs = []
    carry = []
    for score in sorted(brackets, reverse=True):
        # players in the bracket, best first: record, then total battle points
        pool = carry + sorted(brackets[score], key=lambda p: (-p.score, p.seed))
        carry = []
        if len(pool) % 2 == 1:
            carry = [pool.pop()]
        if not pool:
            continue
        rank = {p.id: i for i, p in enumerate(pool)}
        half = len(pool) // 2

        def weight(a, b, rank=rank, half=half):
            hi, lo = sorted((rank[a], rank[b]))
            w = -100.0 * abs(lo - (hi + half))
            if t.have_played(a, b):
                w -= rp
            return w

        pairs.extend(max_weight_pairing([p.id for p in pool], weight))

    while len(carry) >= 2:
        pairs.append((carry.pop(0).id, carry.pop(0).id))
    if bye is not None:
        pairs.append((bye, None))
    return assign_colors(t, pairs)


##-- info_gain | Pairs to learn the most, not to match records. Fits a Gaussian posterior over skill from the margins so far, then pairs to maximise expected information gain: for a match between i and j the gain is 0.5*log(1 + Var(mu_i - mu_j)/noise^2), so it pairs the players whose *relative* skill is least certain. This is D-optimal design on the play graph — the posterior precision is the graph Laplacian plus a prior, so "who should play whom" becomes a question about which edges the comparison graph is missing. --##
PARAMS = {
    'noise': {'default': 9.0, 'min': 1.0, 'max': 40.0, 'step': 1.0},
    'prior_sd': {'default': 20.0, 'min': 2.0, 'max': 100.0, 'step': 1.0},
    'repeat_penalty': {'default': 12.0, 'min': 0.0, 'max': 100.0, 'step': 1.0},
}


def pair_round(t, ctx):
    import numpy as np

    bye = pick_bye(t) if len(t.players) % 2 == 1 else None
    ids = [i for i in sorted(t.players) if i != bye]
    if len(ids) < 2:
        return [(bye, None)] if bye is not None else []

    sigma2 = ctx.params['noise'] ** 2
    var_diff, idx = posterior_spread(t, ids, ctx.params['noise'], ctx.params['prior_sd'])
    eig = 0.5 * np.log1p(var_diff / sigma2)
    rp = ctx.params['repeat_penalty']

    def weight(a, b):
        w = eig[idx[a], idx[b]]
        if t.have_played(a, b):
            w -= rp
        return w * 1000.0  # integer weights: max_weight_pairing rounds

    pairs = max_weight_pairing(ids, weight, allow_bye_for=bye)
    return assign_colors(t, pairs)


##-- info_gain_censored | Information gain corrected for the 0-100 battle point cap. A blowout is censored — once the margin hits the ceiling the scoreboard stops distinguishing "won well" from "won overwhelmingly" — so the expected gain from a lopsided pairing is discounted by the chance the result saturates. This pulls the pairing back toward evenly matched games without ever looking at the win/loss record. --##
PARAMS = {
    'noise': {'default': 9.0, 'min': 1.0, 'max': 40.0, 'step': 1.0},
    'prior_sd': {'default': 20.0, 'min': 2.0, 'max': 100.0, 'step': 1.0},
    'cap_margin': {'default': 44.0, 'min': 10.0, 'max': 100.0, 'step': 2.0},
    'repeat_penalty': {'default': 12.0, 'min': 0.0, 'max': 100.0, 'step': 1.0},
}


def pair_round(t, ctx):
    import numpy as np

    bye = pick_bye(t) if len(t.players) % 2 == 1 else None
    ids = [i for i in sorted(t.players) if i != bye]
    if len(ids) < 2:
        return [(bye, None)] if bye is not None else []

    sigma2 = ctx.params['noise'] ** 2
    var_diff, idx = posterior_spread(t, ids, ctx.params['noise'], ctx.params['prior_sd'])
    eig = 0.5 * np.log1p(var_diff / sigma2)

    mu = ridge_ratings(t, ridge=sigma2 / (ctx.params['prior_sd'] ** 2))
    est = np.array([mu[i] for i in ids])

    # P(the result lands inside the scoreboard, so the margin is observable)
    cap = ctx.params['cap_margin']
    pred = est[:, None] - est[None, :]
    sd = np.sqrt(var_diff + sigma2)
    phi = lambda z: 0.5 * (1.0 + np.vectorize(math.erf)(z / math.sqrt(2.0)))
    observable = np.maximum(0.02, phi((cap - pred) / sd) - phi((-cap - pred) / sd))

    rp = ctx.params['repeat_penalty']

    def weight(a, b):
        i, j = idx[a], idx[b]
        w = eig[i, j] * observable[i, j]
        if t.have_played(a, b):
            w -= rp
        return w * 1000.0

    pairs = max_weight_pairing(ids, weight, allow_bye_for=bye)
    return assign_colors(t, pairs)


##-- info_gain_bracketed | The practical compromise: maximise information gain, but only among players within a window of each other in the standings. Unconstrained information-optimal pairing will happily send the tournament leader to table 30, which no player will accept; this keeps the pairing recognisably Swiss while spending the remaining freedom on the most informative match available. --##
PARAMS = {
    'window': {'default': 12, 'min': 2, 'max': 200, 'step': 1},
    'noise': {'default': 9.0, 'min': 1.0, 'max': 40.0, 'step': 1.0},
    'prior_sd': {'default': 20.0, 'min': 2.0, 'max': 100.0, 'step': 1.0},
    'repeat_penalty': {'default': 12.0, 'min': 0.0, 'max': 100.0, 'step': 1.0},
}


def pair_round(t, ctx):
    import numpy as np

    bye = pick_bye(t) if len(t.players) % 2 == 1 else None
    ids = [i for i in sorted(t.players) if i != bye]
    if len(ids) < 2:
        return [(bye, None)] if bye is not None else []

    sigma2 = ctx.params['noise'] ** 2
    var_diff, idx = posterior_spread(t, ids, ctx.params['noise'], ctx.params['prior_sd'])
    eig = 0.5 * np.log1p(var_diff / sigma2)

    ordered = [p.id for p in t.standings() if p.id != bye]
    place = {p: k for k, p in enumerate(ordered)}
    window = int(ctx.params['window'])
    rp = ctx.params['repeat_penalty']

    def weight(a, b):
        gap = abs(place[a] - place[b])
        w = eig[idx[a], idx[b]]
        if gap > window:
            # far outside the window: never worth it, but still finite so a
            # legal matching always exists
            w -= 50.0 + gap
        if t.have_played(a, b):
            w -= rp
        return w * 1000.0

    pairs = max_weight_pairing(ids, weight, allow_bye_for=bye)
    return assign_colors(t, pairs)


##-- by_live_rating | Pair on the rating your rating-update function is maintaining, not on match points. Only interesting when the rating hook is doing real work (Elo/Glicko). --##
def pair_round(t, ctx):
    bye = pick_bye(t) if len(t.players) % 2 == 1 else None
    ids = [i for i in t.players if i != bye]
    ratings = [t.players[i].rating for i in ids]
    span = max(1.0, (max(ratings) - min(ratings)) if ratings else 1.0)

    def weight(a, b):
        w = -1000.0 * abs(t.players[a].rating - t.players[b].rating) / span
        if t.have_played(a, b):
            w -= 1000000.0
        return w

    pairs = max_weight_pairing(ids, weight, allow_bye_for=bye)
    return assign_colors(t, pairs)


##-- archetype_balanced | Swiss pairing that also spreads the archetypes you face. In a field with non-transitive matchups, drawing three opponents your army beats is schedule luck the record cannot distinguish from skill — this makes the draw itself fairer instead of correcting for it afterwards. Archetype is public information, so unlike true skill it is legitimate to pair on. --##
PARAMS = {
    'score_weight': {'default': 1000.0, 'min': 1.0, 'max': 5000.0, 'step': 50.0},
    'variety_weight': {'default': 120.0, 'min': 0.0, 'max': 2000.0, 'step': 20.0},
    'repeat_penalty': {'default': 1000000.0, 'min': 0.0, 'max': 10000000.0, 'step': 100000.0},
}


def pair_round(t, ctx):
    bye = pick_bye(t) if len(t.players) % 2 == 1 else None
    sw = ctx.params['score_weight']
    vw = ctx.params['variety_weight']
    rp = ctx.params['repeat_penalty']
    span = max(1.0, t.max_score() or 1.0)

    # how many times each player has already faced each archetype
    seen = {}
    for p in t.players.values():
        counts = {}
        for o in t.opponents_of(p.id):
            counts[o.archetype] = counts.get(o.archetype, 0) + 1
        seen[p.id] = counts

    def weight(a, b):
        pa, pb = t.players[a], t.players[b]
        w = -sw * abs(pa.score - pb.score) / span
        if t.have_played(a, b):
            w -= rp
        # facing an archetype you have already seen is worth less
        w -= vw * (seen[a].get(pb.archetype, 0) + seen[b].get(pa.archetype, 0))
        return w

    pairs = max_weight_pairing(list(t.players), weight, allow_bye_for=bye)
    return assign_colors(t, pairs)
