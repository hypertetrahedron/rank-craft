"""RankCraft simulation harness.

Runs Swiss-system tournaments over a synthetic field whose *true* skill is known
by construction, then scores the resulting ranking against that ground truth.

Five plug points are user-supplied Python. Each is a plain function; the harness
owns all bookkeeping (scores, colours, byes, floats, history, validation) so a
user function only has to answer one question.

    seed_order(players, ctx)            -> list[int]                 ids, best seed first
    pair_round(t, ctx)                  -> list[(int, int | None)]    None = bye
    play_match(skill_a, skill_b, ctx)   -> (float, float)             points for a, points for b
    update_ratings(t, results, ctx)     -> None                       mutate p.rating in place
    rank_players(t, ctx)                -> list[int]                  ids, best first

`play_match` receives EFFECTIVE skill -- base skill with this match's random
component already applied -- and returns the points each side earns. Those points
are the currency of the whole system: they accumulate into Player.score, they
define the score groups a pairing function sees, and every tiebreak reads them.

Determinism / common random numbers
-----------------------------------
Every random draw is keyed by content, never by call order:

  * the field for replication r depends only on (base_seed, r)
  * the noise for a match depends only on (base_seed, r, lo_id, hi_id, meeting#)
  * the rng handed to a pairing function depends only on (base_seed, r, round)

So "player 7 versus player 12 in replication 40" gets identical luck no matter
which strategy paired them, and two strategies can be compared as a *paired*
sample. That collapses the variance: 200 paired replications say as much as
several thousand independent ones.
"""

from __future__ import annotations

import json
import math
import random
import traceback
from dataclasses import dataclass, field

import metrics

VERSION = '1.0.0'

_MASK = (1 << 64) - 1


# --------------------------------------------------------------------------
# deterministic keyed RNG
# --------------------------------------------------------------------------


def _splitmix64(x: int) -> int:
    x = (x + 0x9E3779B97F4A7C15) & _MASK
    z = x
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & _MASK
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & _MASK
    return (z ^ (z >> 31)) & _MASK


def mix(*parts) -> int:
    h = 0xCBF29CE484222325
    for p in parts:
        h = _splitmix64(h ^ (int(p) & _MASK))
    return h


def keyed_rng(*parts) -> random.Random:
    return random.Random(mix(*parts))


# --------------------------------------------------------------------------
# data model
# --------------------------------------------------------------------------


@dataclass
class Player:
    """One competitor. Everything a user function is allowed to look at lives here.

    `skill` is ground truth. Reading it from a pairing or ranking function is
    cheating -- that is exactly what the `oracle` baseline does, and nothing
    else should. `rating` is the public, observable estimate: it starts from the
    seeding rating and is yours to move in `update_ratings`.
    """

    id: int
    name: str
    skill: float  # TRUE skill. Ground truth. Do not use outside `oracle`.
    rating: float  # public estimate; owned by update_ratings
    rating_dev: float = 350.0
    seed: int = 0  # 1-based position from seed_order
    score: float = 0.0  # cumulative points from play_match
    opponents: list = field(default_factory=list)  # ids in round order; None = bye
    results: list = field(default_factory=list)  # points earned per round
    colors: list = field(default_factory=list)  # +1 / -1 / 0 (bye)
    byes: int = 0
    floats: list = field(default_factory=list)  # +1 paired down, -1 paired up, 0 level
    v_up: float = 0.0  # this player's max upward skill swing
    v_down: float = 0.0  # this player's max downward skill swing
    # Playstyle, army, deck — whatever makes matchups non-transitive. Unlike
    # `skill` this is PUBLIC: you can see your opponent's army across the table,
    # so a pairing or ranking function may legitimately use it.
    archetype: int = 0
    style: float = 0.0  # archetype as a position on the circle, in turns [0,1)
    stamina: float = 1.0  # 1.0 = no late-round decline
    meta: dict = field(default_factory=dict)  # free scratch space, persists across rounds

    @property
    def games(self) -> int:
        """Rounds actually played (byes excluded)."""
        return sum(1 for o in self.opponents if o is not None)

    def color_balance(self) -> int:
        return sum(self.colors)


@dataclass
class MatchRecord:
    round: int
    a: int
    b: object  # int | None (None = bye)
    skill_a: float
    skill_b: float  # effective skills actually used
    points_a: float
    points_b: float

    @property
    def is_bye(self) -> bool:
        return self.b is None

    def winner(self):
        if self.points_a > self.points_b:
            return self.a
        if self.points_b > self.points_a:
            return self.b
        return None


class Tournament:
    """Live tournament state handed to pair_round / update_ratings / rank_players."""

    def __init__(self, players, total_rounds: int, config: dict):
        self.players = {p.id: p for p in players}
        self.total_rounds = total_rounds
        self.round = 1  # round about to be paired / just played
        self.history: list = []
        self.config = config
        self._played = set()
        self._meetings = {}
        self._wins = {p.id: 0.0 for p in players}
        # 'score' buckets by accumulated points; 'wins' buckets by match record.
        # They are the same thing in chess and very different in a game scored
        # 0-100 a side, where every player's total is unique and a score bucket
        # would contain exactly one person.
        self._bracket_by = config.get('bracket_by', 'score')

    # -- ordering ---------------------------------------------------------

    def wins(self, pid: int) -> float:
        """Match wins for this player, a draw counting a half. Byes count as a win."""
        return self._wins[pid]

    def bracket_key(self, p) -> float:
        """Whatever the tournament brackets on — points, or the win record."""
        return self._wins[p.id] if self._bracket_by == 'wins' else p.score

    def standings(self):
        """All players, best first: bracket key desc, score desc, rating desc, seed asc.

        Deterministic and free of ground truth. This is the ordering most
        pairing systems build on.
        """
        return sorted(
            self.players.values(),
            key=lambda p: (-self.bracket_key(p), -p.score, -p.rating, p.seed, p.id),
        )

    def score_groups(self):
        """{bracket key: [players, best first]}, from the top bracket downwards."""
        groups = {}
        for p in self.standings():
            groups.setdefault(self.bracket_key(p), []).append(p)
        return dict(sorted(groups.items(), key=lambda kv: -kv[0]))

    # -- history ----------------------------------------------------------

    def have_played(self, a: int, b: int) -> bool:
        return (min(a, b), max(a, b)) in self._played

    def meetings(self, a: int, b: int) -> int:
        return self._meetings.get((min(a, b), max(a, b)), 0)

    def opponents_of(self, pid: int):
        """Player objects this player has faced, in round order (byes skipped)."""
        return [self.players[o] for o in self.players[pid].opponents if o is not None]

    def results_against(self, pid: int):
        """[(opponent_player, points_scored, points_conceded), ...] in round order."""
        out = []
        p = self.players[pid]
        for r in self.history:
            if r.a == pid and r.b is not None:
                out.append((self.players[r.b], r.points_a, r.points_b))
            elif r.b == pid:
                out.append((self.players[r.a], r.points_b, r.points_a))
        return out

    def color_balance(self, pid: int) -> int:
        return self.players[pid].color_balance()

    def max_score(self) -> float:
        return max((p.score for p in self.players.values()), default=0.0)

    # -- internal ---------------------------------------------------------

    def _record(self, rec: MatchRecord):
        self.history.append(rec)
        if rec.b is None:
            self._wins[rec.a] += 1.0
            return
        key = (min(rec.a, rec.b), max(rec.a, rec.b))
        self._played.add(key)
        self._meetings[key] = self._meetings.get(key, 0) + 1
        if rec.points_a > rec.points_b:
            self._wins[rec.a] += 1.0
        elif rec.points_b > rec.points_a:
            self._wins[rec.b] += 1.0
        else:
            self._wins[rec.a] += 0.5
            self._wins[rec.b] += 0.5


class Ctx:
    """Per-call context. `rng` is seeded deterministically -- use it, not `random`."""

    def __init__(self, rng, round_no, total_rounds, params, config, replication):
        self.rng = rng
        self.round = round_no
        self.total_rounds = total_rounds
        self.params = params
        self.config = config
        self.replication = replication


class ContractError(Exception):
    """A user function returned something the harness cannot use."""


# --------------------------------------------------------------------------
# pairing helpers exposed to user code
# --------------------------------------------------------------------------

_nx = None
_nx_checked = False


def _networkx():
    """Import networkx on first use. The wheel is 3.6 MB, so it is only fetched
    when a pairing function actually asks for an optimal matching."""
    global _nx, _nx_checked
    if not _nx_checked:
        _nx_checked = True
        try:
            import networkx

            _nx = networkx
        except Exception:
            _nx = None
    return _nx


def max_weight_pairing(ids, weight_fn, allow_bye_for=None):
    """Optimal pairing of `ids` maximising the total of `weight_fn(a, b)`.

    Uses Edmonds' blossom algorithm (networkx.max_weight_matching, O(n^3) on a
    complete graph). Weights are rounded to integers first: networkx only
    guarantees an exact result for integer weights, and float weights can return
    a slightly suboptimal matching from precision drift. Scale your weights up
    (x1000) rather than relying on fractions.

    If `ids` is odd, `allow_bye_for` must name the id that takes the bye.
    Returns [(a, b), ...] plus (bye_id, None) when applicable.
    """
    ids = list(ids)
    bye = None
    if allow_bye_for is not None:
        bye = allow_bye_for
        ids = [i for i in ids if i != bye]
    if len(ids) % 2 == 1:
        raise ContractError(
            'max_weight_pairing got an odd number of players and no bye; '
            'pass allow_bye_for=<id>'
        )

    nx = _networkx()
    pairs = []
    if nx is not None and ids:
        g = nx.Graph()
        g.add_nodes_from(ids)
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                g.add_edge(ids[i], ids[j], weight=int(round(weight_fn(ids[i], ids[j]))))
        matching = nx.max_weight_matching(g, maxcardinality=True)
        pairs = [tuple(sorted(e)) for e in matching]
    else:
        pairs = _greedy_pairing(ids, weight_fn)

    if bye is not None:
        pairs.append((bye, None))
    return pairs


def _greedy_pairing(ids, weight_fn):
    """Fallback: greedy best-edge-first, then 2-opt. Not optimal, but close."""
    remaining = set(ids)
    edges = []
    ids = list(ids)
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            edges.append((weight_fn(ids[i], ids[j]), ids[i], ids[j]))
    edges.sort(key=lambda e: (-e[0], e[1], e[2]))
    pairs = []
    for _w, a, b in edges:
        if a in remaining and b in remaining:
            remaining.discard(a)
            remaining.discard(b)
            pairs.append((a, b))
    leftovers = sorted(remaining)
    for i in range(0, len(leftovers) - 1, 2):
        pairs.append((leftovers[i], leftovers[i + 1]))

    improved = True
    while improved:
        improved = False
        for i in range(len(pairs)):
            for j in range(i + 1, len(pairs)):
                a, b = pairs[i]
                c, d = pairs[j]
                cur = weight_fn(a, b) + weight_fn(c, d)
                if weight_fn(a, c) + weight_fn(b, d) > cur:
                    pairs[i], pairs[j] = (a, c), (b, d)
                    improved = True
                elif weight_fn(a, d) + weight_fn(b, c) > cur:
                    pairs[i], pairs[j] = (a, d), (b, c)
                    improved = True
    return pairs


def assign_colors(t: Tournament, pairs):
    """Orient each pair so the player who most needs white gets it.

    Returns a new pair list. Use it as the last step of a pairing function when
    you do not want to think about colours yourself.
    """
    out = []
    for a, b in pairs:
        if b is None:
            out.append((a, b))
            continue
        ba, bb = t.color_balance(a), t.color_balance(b)
        if ba > bb:  # a has had more white than b -> b gets white
            out.append((b, a))
        elif bb > ba:
            out.append((a, b))
        else:
            pa, pb = t.players[a], t.players[b]
            last_a = next((c for c in reversed(pa.colors) if c != 0), 0)
            last_b = next((c for c in reversed(pb.colors) if c != 0), 0)
            if last_a == 1 and last_b != 1:
                out.append((b, a))
            elif last_b == 1 and last_a != 1:
                out.append((a, b))
            elif pa.seed <= pb.seed:
                out.append((a, b))
            else:
                out.append((b, a))
    return out


def ridge_ratings(t: Tournament, observe=None, ridge: float = 1.0):
    """Maximum a posteriori skill estimates from the whole result graph.

    Fits `observation = mu_i - mu_j + noise` over every game with a N(0, tau^2)
    prior — ridge-regularised least squares, which for this design is Massey's
    method with a prior, and the ridge term is what keeps an undefeated player
    finite. Returns {player id: rating}.

    `observe(record)` says what each game reports; the default is the score
    margin. Pass `lambda r: 1 if r.points_a > r.points_b else -1` to fit the
    same model on win/loss alone, which is how you measure what the margin is
    worth with the estimator held constant.
    """
    import numpy as np

    if observe is None:
        observe = lambda r: r.points_a - r.points_b

    ids = sorted(t.players)
    idx = {p: i for i, p in enumerate(ids)}
    n = len(ids)
    lap = np.eye(n) * ridge
    obs = np.zeros(n)
    for r in t.history:
        if r.b is None:
            continue
        i, j = idx[r.a], idx[r.b]
        m = float(observe(r))
        lap[i, i] += 1.0
        lap[j, j] += 1.0
        lap[i, j] -= 1.0
        lap[j, i] -= 1.0
        obs[i] += m
        obs[j] -= m
    mu = np.linalg.solve(lap, obs)
    return {pid: float(mu[idx[pid]]) for pid in ids}


def posterior_spread(t: Tournament, ids, noise: float = 9.0, prior_sd: float = 20.0):
    """How uncertain the tournament still is about each *pair* of players.

    The posterior precision of the same Gaussian model is the Laplacian of the
    graph of games played, plus the prior — so what the tournament does not yet
    know is a property of which edges the comparison graph is missing. Returns
    (variance matrix indexed by position in `ids`, {id: index}), where entry
    [i][j] is Var(mu_i - mu_j).

    That variance is what expected information gain is a function of:
    EIG(i, j) = 0.5 * log(1 + Var(mu_i - mu_j) / noise^2).
    """
    import numpy as np

    ids = list(ids)
    idx = {p: i for i, p in enumerate(ids)}
    n = len(ids)
    sigma2 = noise * noise
    prec = np.eye(n) * (sigma2 / (prior_sd * prior_sd))
    for r in t.history:
        if r.b is None or r.a not in idx or r.b not in idx:
            continue
        i, j = idx[r.a], idx[r.b]
        prec[i, i] += 1.0
        prec[j, j] += 1.0
        prec[i, j] -= 1.0
        prec[j, i] -= 1.0
    cov = np.linalg.inv(prec) * sigma2
    d = np.diag(cov)
    return np.maximum(0.0, d[:, None] + d[None, :] - 2.0 * cov), idx


def pick_bye(t: Tournament, candidates=None):
    """Lowest-ranked player who has not had a bye yet (FIDE convention)."""
    pool = t.standings() if candidates is None else [t.players[c] for c in candidates]
    for p in reversed(pool):
        if p.byes == 0:
            return p.id
    return pool[-1].id


# --------------------------------------------------------------------------
# field generation
# --------------------------------------------------------------------------


def _draw_skills(cfg, rng):
    n = int(cfg['players'])
    d = cfg['skill']
    kind = d.get('kind', 'normal')

    if kind == 'normal':
        mu = float(d.get('mean', 1600.0))
        sd = float(d.get('stdev', 200.0))
        return [rng.gauss(mu, sd) for _ in range(n)]
    if kind == 'uniform':
        lo, hi = float(d.get('min', 1400.0)), float(d.get('max', 2200.0))
        return [rng.uniform(lo, hi) for _ in range(n)]
    if kind == 'linear':
        # Evenly spaced ladder. Identical every replication, which isolates match
        # luck from field luck.
        lo, hi = float(d.get('min', 1400.0)), float(d.get('max', 2200.0))
        if n == 1:
            return [hi]
        step = (hi - lo) / (n - 1)
        return [lo + i * step for i in range(n)]
    if kind == 'bimodal':
        lo, hi = float(d.get('min', 1400.0)), float(d.get('max', 2200.0))
        sd = float(d.get('stdev', 80.0))
        return [rng.gauss(hi if i % 2 == 0 else lo, sd) for i in range(n)]
    if kind == 'custom':
        vals = [float(v) for v in d.get('values', [])]
        if not vals:
            raise ContractError('custom skill distribution has no values')
        return [vals[i % len(vals)] for i in range(n)]
    raise ContractError('unknown skill distribution: %r' % (kind,))


def _variance_for(skill, lo, hi, vcfg):
    """Per-player swing limits.

    v_i = v_max * (1 - k * normalised_skill) ** exponent

    k = 0 gives every player the same variance. k = 1 with exponent 1 gives the
    strongest player in the field zero variance. Up and down limits are separate
    so the noise can be skewed.
    """
    span = hi - lo
    norm = 0.0 if span <= 0 else (skill - lo) / span
    k = float(vcfg.get('skill_coupling', 0.0))
    exponent = float(vcfg.get('exponent', 1.0))
    damp = max(0.0, 1.0 - k * norm) ** exponent
    return (
        max(0.0, float(vcfg.get('max_up', 0.0)) * damp),
        max(0.0, float(vcfg.get('max_down', 0.0)) * damp),
    )


def build_field(cfg, replication: int):
    base = int(cfg.get('seed', 0))
    rng = keyed_rng(base, 0xF1E1D, replication)
    skills = _draw_skills(cfg, rng)
    lo, hi = min(skills), max(skills)

    vcfg = cfg.get('variance', {})
    ircfg = cfg.get('initial_rating', {})
    mode = ircfg.get('mode', 'true')
    noise = float(ircfg.get('noise', 0.0))
    flat = float(ircfg.get('value', 1500.0))

    mcfg = cfg.get('matchup', {})
    # Archetypes are only drawn when they can actually affect a game. Checking
    # the count alone is not enough: a config can name five archetypes with the
    # model switched off, and drawing for them would still consume the stream.
    matchups_on = mcfg.get('kind', 'none') != 'none' and float(mcfg.get('amplitude', 0.0)) > 0.0
    archetypes = max(1, int(mcfg.get('archetypes', 1)))
    draw_archetypes = matchups_on and archetypes > 1
    fcfg = cfg.get('fatigue', {})
    stamina_spread = float(fcfg.get('spread', 0.0)) if float(fcfg.get('amplitude', 0.0)) > 0.0 else 0.0

    players = []
    for i, s in enumerate(skills):
        if mode == 'flat':
            rating = flat
        elif mode == 'noisy':
            rating = s + rng.gauss(0.0, noise)
        else:
            rating = s
        v_up, v_down = _variance_for(s, lo, hi, vcfg)
        # Both draws are guarded, not merely zeroed. Calling rng at all consumes
        # the stream, so an unconfigured feature would silently change the field
        # every existing seed produces — reproducibility has to survive adding
        # features that are switched off.
        arch = rng.randrange(archetypes) if draw_archetypes else 0
        # 1.0 means no decline; lower means this player fades in the late
        # rounds. Drawn once per player, so it is a property of the field
        # rather than of the draw.
        stamina = (
            max(0.0, min(1.0, 1.0 - abs(rng.gauss(0.0, stamina_spread))))
            if stamina_spread > 0.0
            else 1.0
        )
        players.append(
            Player(
                id=i,
                name='P%d' % (i + 1),
                skill=s,
                rating=rating,
                v_up=v_up,
                v_down=v_down,
                archetype=arch,
                style=arch / float(archetypes),
                stamina=stamina,
            )
        )
    return players


def matchup_bonus(a: Player, b: Player, cfg) -> float:
    """Skill `a` gains purely from facing `b` — the non-transitive component.

    With `circular`, archetypes sit evenly on a circle and the bonus is
    amplitude * sin(2*pi*(style_a - style_b)). That is antisymmetric, so what
    one side gains the other loses, and with three archetypes it is literally
    rock-paper-scissors: each beats one and loses to another regardless of
    skill. It is the one effect that breaks the premise every rating system
    rests on, that players can be placed on a single line.
    """
    m = cfg.get('matchup', {})
    amp = float(m.get('amplitude', 0.0))
    if amp == 0.0 or m.get('kind', 'none') == 'none':
        return 0.0
    return amp * math.sin(2.0 * math.pi * (a.style - b.style))


def fatigue_penalty(p: Player, round_no: int, cfg) -> float:
    """Skill lost to tiredness by this round. Zero for a fully rested player."""
    f = cfg.get('fatigue', {})
    amp = float(f.get('amplitude', 0.0))
    if amp == 0.0:
        return 0.0
    return amp * (1.0 - p.stamina) * max(0, round_no - 1)


def effective_skill(p: Player, rng, noise_kind: str) -> float:
    """Base skill plus this match's random component, clamped to +v_up / -v_down."""
    if p.v_up == 0.0 and p.v_down == 0.0:
        return p.skill
    if noise_kind == 'normal':
        # sigma = v/3 then clamp, so the stated max stays a hard bound
        up = rng.gauss(0.0, (p.v_up + p.v_down) / 6.0) if (p.v_up + p.v_down) else 0.0
        return p.skill + max(-p.v_down, min(p.v_up, up))
    if noise_kind == 'triangular':
        return p.skill + rng.triangular(-p.v_down, p.v_up, 0.0)
    return p.skill + rng.uniform(-p.v_down, p.v_up)


# --------------------------------------------------------------------------
# user code loading
# --------------------------------------------------------------------------

_HOOKS = {
    'seeding': 'seed_order',
    'pairing': 'pair_round',
    'outcome': 'play_match',
    'rating': 'update_ratings',
    'ranking': 'rank_players',
}


def load_hook(kind: str, code: str):
    """Exec user code in its own namespace and pull out the expected function."""
    fn_name = _HOOKS[kind]
    ns = {
        '__name__': 'rankcraft_%s' % kind,
        'math': math,
        'random': random,
        'Player': Player,
        'MatchRecord': MatchRecord,
        'Tournament': Tournament,
        'ContractError': ContractError,
        'max_weight_pairing': max_weight_pairing,
        'assign_colors': assign_colors,
        'pick_bye': pick_bye,
        'ridge_ratings': ridge_ratings,
        'posterior_spread': posterior_spread,
        'matchup_bonus': matchup_bonus,
        'metrics': metrics,
    }
    try:
        exec(compile(code, '<%s>' % kind, 'exec'), ns)
    except Exception as exc:
        raise ContractError(
            '%s function failed to load: %s\n%s' % (kind, exc, traceback.format_exc(limit=3))
        )
    fn = ns.get(fn_name)
    if fn is None:
        raise ContractError(
            "%s function must define `def %s(...)`; found: %s"
            % (kind, fn_name, ', '.join(sorted(k for k, v in ns.items() if callable(v))) or 'nothing')
        )
    params = dict(ns.get('PARAMS', {}))
    return fn, params


def _resolve_params(declared, overrides):
    """PARAMS declares {name: {'default': x, ...}}; the UI may override values."""
    out = {}
    for name, spec in declared.items():
        out[name] = spec.get('default') if isinstance(spec, dict) else spec
    out.update(overrides or {})
    return out


# --------------------------------------------------------------------------
# contract validation
# --------------------------------------------------------------------------


def validate_pairs(pairs, t: Tournament):
    """Reject anything that is not a legal partition of the field."""
    try:
        pairs = [tuple(p) for p in pairs]
    except TypeError:
        raise ContractError('pair_round must return a list of (a, b) tuples')

    ids = set(t.players)
    seen = {}
    byes = 0
    for pair in pairs:
        if len(pair) != 2:
            raise ContractError('pair_round returned %r; expected a 2-tuple' % (pair,))
        a, b = pair
        if a is None:
            raise ContractError('the first element of a pair may not be None (put the bye second)')
        for pid in (a, b):
            if pid is None:
                continue
            if pid not in ids:
                raise ContractError('pair_round returned unknown player id %r' % (pid,))
            if pid in seen:
                raise ContractError(
                    'player %r appears in more than one pairing in round %d' % (pid, t.round)
                )
            seen[pid] = True
        if b is None:
            byes += 1
        elif a == b:
            raise ContractError('player %r was paired against themselves' % (a,))

    missing = ids - set(seen)
    if missing:
        raise ContractError(
            'round %d left %d player(s) unpaired: %s'
            % (t.round, len(missing), sorted(missing)[:8])
        )
    expected_byes = len(ids) % 2
    if byes != expected_byes:
        raise ContractError(
            'round %d produced %d bye(s); a field of %d needs exactly %d'
            % (t.round, byes, len(ids), expected_byes)
        )
    return pairs


def validate_order(order, t: Tournament, what: str):
    try:
        order = [int(x) for x in order]
    except (TypeError, ValueError):
        raise ContractError('%s must return a list of player ids' % what)
    if len(order) != len(t.players) or set(order) != set(t.players):
        dupes = len(order) != len(set(order))
        raise ContractError(
            '%s must return every player id exactly once (got %d ids for %d players%s)'
            % (what, len(order), len(t.players), ', with duplicates' if dupes else '')
        )
    return order


# --------------------------------------------------------------------------
# one replication
# --------------------------------------------------------------------------


def run_replication(cfg, hooks, replication: int, want_log: bool = False):
    base = int(cfg.get('seed', 0))
    rounds = int(cfg['rounds'])
    noise_kind = cfg.get('variance', {}).get('kind', 'uniform')
    bye_points = float(cfg.get('bye_points', 1.0))
    scfg = cfg.get('side', {})
    side_mode = scfg.get('mode', 'none')
    side_advantage = float(scfg.get('advantage', 0.0))

    players = build_field(cfg, replication)
    t = Tournament(players, rounds, cfg)

    # ---- seeding
    ctx = Ctx(keyed_rng(base, 0x5EED, replication), 0, rounds, hooks['seeding'][1], cfg, replication)
    order = validate_order(hooks['seeding'][0](list(players), ctx), t, 'seed_order')
    for i, pid in enumerate(order):
        t.players[pid].seed = i + 1

    truth = sorted(t.players.values(), key=lambda p: (-p.skill, p.id))
    truth_ids = [p.id for p in truth]
    lo_s, hi_s = truth[-1].skill, truth[0].skill
    span = (hi_s - lo_s) or 1.0
    gains = {p.id: (p.skill - lo_s) / span for p in t.players.values()}

    per_round = {'tau_vs_true': [], 'spearman_vs_true': [], 'churn': [], 'top1': []}
    rankings = []
    prev_order = None
    log = [] if want_log else None

    for rnd in range(1, rounds + 1):
        t.round = rnd

        # ---- pair
        ctx = Ctx(
            keyed_rng(base, 0xA11, replication, rnd),
            rnd,
            rounds,
            hooks['pairing'][1],
            cfg,
            replication,
        )
        pairs = validate_pairs(hooks['pairing'][0](t, ctx), t)

        # ---- play
        round_records = []
        for a, b in pairs:
            pa = t.players[a]
            if b is None:
                pa.byes += 1
                pa.score += bye_points
                pa.opponents.append(None)
                pa.results.append(bye_points)
                pa.colors.append(0)
                pa.floats.append(0)
                rec = MatchRecord(rnd, a, None, pa.skill, float('nan'), bye_points, 0.0)
                t._record(rec)
                round_records.append(rec)
                continue

            pb = t.players[b]
            lo_id, hi_id = (a, b) if a < b else (b, a)
            occ = t.meetings(a, b)
            mrng = keyed_rng(base, 0x4A7C, replication, lo_id, hi_id, occ)
            # draw in canonical id order so the noise does not depend on which
            # side the pairing function put each player on
            n_lo = effective_skill(t.players[lo_id], mrng, noise_kind)
            n_hi = effective_skill(t.players[hi_id], mrng, noise_kind)
            eff_a, eff_b = (n_lo, n_hi) if a == lo_id else (n_hi, n_lo)

            # non-transitive matchup: antisymmetric, so it is a transfer
            eff_a += matchup_bonus(pa, pb, cfg)
            eff_b += matchup_bonus(pb, pa, cfg)

            # tiredness accumulates over the day
            eff_a -= fatigue_penalty(pa, rnd, cfg)
            eff_b -= fatigue_penalty(pb, rnd, cfg)

            # going first. `first` is the id with the advantage; under
            # 'pairing' it is whoever the pairing function listed first, under
            # 'random' it is a keyed coin flip so the same matchup always rolls
            # the same way and common random numbers still hold.
            first = None
            if side_advantage != 0.0 and side_mode != 'none':
                if side_mode == 'random':
                    first = lo_id if keyed_rng(base, 0x51DE, replication, lo_id, hi_id, occ).random() < 0.5 else hi_id
                else:
                    first = a
                if first == a:
                    eff_a += side_advantage
                else:
                    eff_b += side_advantage

            octx = Ctx(mrng, rnd, rounds, hooks['outcome'][1], cfg, replication)
            # The outcome function is the one hook that legitimately sees true
            # skill, so it gets the players themselves — enough to model an
            # archetype matchup, a tiring player, or a leader coasting once the
            # win is secure.
            octx.a = pa
            octx.b = pb
            octx.first = first
            octx.tournament = t
            res = hooks['outcome'][0](eff_a, eff_b, octx)
            try:
                pts_a, pts_b = float(res[0]), float(res[1])
            except (TypeError, IndexError, ValueError):
                raise ContractError(
                    'play_match must return (points_a, points_b); got %r' % (res,)
                )

            fl = 0
            if pa.score > pb.score:
                fl = 1
            elif pa.score < pb.score:
                fl = -1

            pa.score += pts_a
            pb.score += pts_b
            pa.opponents.append(b)
            pb.opponents.append(a)
            pa.results.append(pts_a)
            pb.results.append(pts_b)
            pa.colors.append(1)
            pb.colors.append(-1)
            pa.floats.append(fl)
            pb.floats.append(-fl)

            rec = MatchRecord(rnd, a, b, eff_a, eff_b, pts_a, pts_b)
            t._record(rec)
            round_records.append(rec)

        # ---- ratings
        rctx = Ctx(
            keyed_rng(base, 0x3A71, replication, rnd), rnd, rounds, hooks['rating'][1], cfg, replication
        )
        hooks['rating'][0](t, round_records, rctx)

        # ---- rank (every round, so convergence is measurable)
        kctx = Ctx(
            keyed_rng(base, 0x2A17, replication, rnd), rnd, rounds, hooks['ranking'][1], cfg, replication
        )
        order = validate_order(hooks['ranking'][0](t, kctx), t, 'rank_players')
        rankings.append(order)

        per_round['tau_vs_true'].append(metrics.kendall_tau_orders(order, truth_ids))
        per_round['spearman_vs_true'].append(metrics.spearman_orders(order, truth_ids))
        per_round['churn'].append(metrics.churn(prev_order, order))
        per_round['top1'].append(1.0 if order[0] == truth_ids[0] else 0.0)
        prev_order = order

        if want_log:
            log.append(
                {
                    'round': rnd,
                    'matches': [
                        {
                            'a': r.a,
                            'b': r.b,
                            'skill_a': r.skill_a,
                            'skill_b': r.skill_b,
                            'points_a': r.points_a,
                            'points_b': r.points_b,
                        }
                        for r in round_records
                    ],
                    'ranking': order,
                }
            )

    final = rankings[-1] if rankings else truth_ids
    per_round['tau_vs_final'] = [metrics.kendall_tau_orders(o, final) for o in rankings]

    # ---- optional single-elimination top cut
    cut_size = int(cfg.get('top_cut', 0) or 0)
    cut_metrics = {'cut_winner_true_rank': None, 'cut_winner_is_best': None, 'cut_field_quality': None}
    cut_log = [] if want_log else None
    if cut_size >= 2 and cut_size <= len(final):
        cfg = dict(cfg)
        cfg['_play_match'] = hooks['outcome'][0]
        cfg['_outcome_params'] = hooks['outcome'][1]
        champion = run_top_cut(t, final, cut_size, cfg, replication, cut_log)
        if champion is not None:
            true_place = {pid: i + 1 for i, pid in enumerate(truth_ids)}
            cut_metrics = {
                'cut_winner_true_rank': float(true_place[champion]),
                'cut_winner_is_best': 1.0 if champion == truth_ids[0] else 0.0,
                'cut_field_quality': metrics.precision_at_k(final, truth_ids, cut_size),
            }

    n = len(truth_ids)
    mean_disp, max_disp = metrics.displacement(final, truth_ids)
    final_place = {pid: i + 1 for i, pid in enumerate(final)}
    top_k = max(1, min(8, n))
    out = {
        'final': {
            'kendall_tau': metrics.kendall_tau_orders(final, truth_ids),
            'spearman': metrics.spearman_orders(final, truth_ids),
            'kendall_distance': metrics.normalised_kendall_distance(final, truth_ids),
            'top1': 1.0 if final[0] == truth_ids[0] else 0.0,
            'p_at_2': metrics.precision_at_k(final, truth_ids, 2),
            'p_at_3': metrics.precision_at_k(final, truth_ids, 3),
            'p_at_8': metrics.precision_at_k(final, truth_ids, 8),
            'p_at_decile': metrics.precision_at_k(final, truth_ids, max(1, n // 10)),
            'ndcg_at_10': metrics.ndcg_at_k(final, gains, 10),
            'mean_displacement': mean_disp,
            'max_displacement': max_disp,
            # Where the genuinely second-best player actually finished. The
            # number behind "my #2 met #1 in round one and never recovered":
            # a mean well above 2 says the format is punishing them for the
            # draw rather than for their play.
            'true_second_place': float(final_place[truth_ids[1]]) if n > 1 else float('nan'),
            # Rank error restricted to the true top 8 — the part of the table a
            # tournament is actually deciding. Errors at table 40 cost nobody
            # anything.
            'top8_displacement': (
                sum(abs(final_place[pid] - (i + 1)) for i, pid in enumerate(truth_ids[:top_k]))
                / float(top_k)
            ),
            'rounds_to_95': metrics.rounds_to_fraction(per_round['tau_vs_true'], 0.95),
            **cut_metrics,
        },
        'per_round': per_round,
        'fairness': _fairness(t, cfg),
    }
    if want_log:
        out['log'] = log
        out['cut_log'] = cut_log
        out['field'] = [
            {
                'id': p.id,
                'name': p.name,
                'skill': p.skill,
                'rating': p.rating,
                'seed': p.seed,
                'score': p.score,
                'wins': t.wins(p.id),
                'archetype': p.archetype,
                'v_up': p.v_up,
                'v_down': p.v_down,
            }
            for p in t.standings()
        ]
        out['truth'] = truth_ids
        out['final_order'] = final
    return out


def _fairness(t: Tournament, cfg):
    """Pairing health.

    Metrics that cannot mean anything under this configuration return None
    rather than a number: colour balance is meaningless in a game with no
    sides, and the rating gap is meaningless when no rating hook ever moves a
    rating. A zero that looks like a measurement is worse than a blank, because
    it will be read as "perfectly balanced" rather than "not applicable".
    """
    repeats = 0
    for _key, count in t._meetings.items():
        if count > 1:
            repeats += count - 1

    ratings = [p.rating for p in t.players.values()]
    ratings_informative = ratings and (max(ratings) - min(ratings)) > 1e-9
    gaps = [
        abs(t.players[r.a].rating - t.players[r.b].rating) for r in t.history if r.b is not None
    ]

    sides_matter = cfg.get('side', {}).get('mode', 'none') != 'none'
    imbalance = [abs(p.color_balance()) for p in t.players.values()]
    byes = [p.byes for p in t.players.values()]
    floaters = sum(1 for p in t.players.values() for f in p.floats if f != 0)
    n = max(1, len(t.players))

    return {
        'repeat_pairings': float(repeats),
        'floaters_per_player': floaters / float(n),
        'mean_color_imbalance': (sum(imbalance) / float(n)) if sides_matter else None,
        'max_color_imbalance': (float(max(imbalance)) if imbalance else 0.0) if sides_matter else None,
        'max_byes': float(max(byes)) if byes else 0.0,
        'mean_rating_gap': (sum(gaps) / len(gaps)) if (gaps and ratings_informative) else None,
    }


# --------------------------------------------------------------------------
# top cut
# --------------------------------------------------------------------------


def run_top_cut(t: Tournament, order, size: int, cfg, replication: int, log=None):
    """Single-elimination bracket over the top `size` of the standings.

    Most real events end this way, and it asks a different question from the
    Swiss rounds: not "did the standings order the field" but "did the right
    player win the thing". A blunt instrument that seeds the bracket wrong
    hands the trophy to somebody else however good its tau was.

    Seeded 1v8, 2v7, ... so a better Swiss finish is worth something.
    """
    base = int(cfg.get('seed', 0))
    noise_kind = cfg.get('variance', {}).get('kind', 'uniform')
    field = list(order[:size])
    if len(field) < 2:
        return None

    play = cfg['_play_match']
    hook_params = cfg['_outcome_params']
    round_no = 0

    while len(field) > 1:
        round_no += 1
        nxt = []
        half = len(field) // 2
        for i in range(half):
            a, b = field[i], field[len(field) - 1 - i]
            pa, pb = t.players[a], t.players[b]
            lo_id, hi_id = (a, b) if a < b else (b, a)
            # A distinct salt: meeting the same opponent again in the bracket is
            # a new game, not a replay of the Swiss one.
            mrng = keyed_rng(base, 0xC07, replication, lo_id, hi_id, round_no)
            n_lo = effective_skill(t.players[lo_id], mrng, noise_kind)
            n_hi = effective_skill(t.players[hi_id], mrng, noise_kind)
            eff_a, eff_b = (n_lo, n_hi) if a == lo_id else (n_hi, n_lo)
            eff_a += matchup_bonus(pa, pb, cfg)
            eff_b += matchup_bonus(pb, pa, cfg)

            octx = Ctx(mrng, t.total_rounds + round_no, t.total_rounds, hook_params, cfg, replication)
            octx.a = pa
            octx.b = pb
            octx.first = None
            octx.tournament = t
            pts_a, pts_b = play(eff_a, eff_b, octx)

            winner = a if pts_a > pts_b else (b if pts_b > pts_a else (a if pa.seed <= pb.seed else b))
            nxt.append(winner)
            if log is not None:
                log.append(
                    {
                        'round': round_no,
                        'a': a,
                        'b': b,
                        'points_a': float(pts_a),
                        'points_b': float(pts_b),
                        'winner': winner,
                    }
                )
        field = nxt

    return field[0]


# --------------------------------------------------------------------------
# batch entry point (called from the worker)
# --------------------------------------------------------------------------


def _prepare_hooks(cfg):
    hooks = {}
    for kind in _HOOKS:
        spec = cfg['functions'][kind]
        fn, declared = load_hook(kind, spec['code'])
        hooks[kind] = (fn, _resolve_params(declared, spec.get('params')))
    return hooks


def run_batch(config_json: str, progress=None) -> str:
    """Run `replications` tournaments and return per-replication metric arrays.

    Raw per-replication values are returned rather than means so the caller can
    build confidence intervals, merge worker slices, and run paired tests
    between configurations.
    """
    cfg = json.loads(config_json)
    reps = list(cfg.get('replication_ids') or range(int(cfg.get('replications', 1))))
    want_log = bool(cfg.get('want_log')) and reps

    try:
        hooks = _prepare_hooks(cfg)
    except ContractError as exc:
        return json.dumps({'ok': False, 'error': str(exc)})

    final_keys = None
    final_out = {}
    fair_out = {}
    per_round_out = {}
    sample = None
    every = max(1, len(reps) // 20)

    for i, rep in enumerate(reps):
        try:
            r = run_replication(cfg, hooks, rep, want_log=(want_log and i == 0))
        except ContractError as exc:
            return json.dumps(
                {
                    'ok': False,
                    'error': str(exc) or type(exc).__name__,
                    'replication': rep,
                    'trace': traceback.format_exc(limit=6),
                }
            )
        except Exception as exc:  # user code blew up in an unexpected way
            return json.dumps(
                {
                    'ok': False,
                    'error': '%s: %s' % (type(exc).__name__, exc),
                    'replication': rep,
                    'trace': traceback.format_exc(limit=6),
                }
            )

        if final_keys is None:
            final_keys = list(r['final'])
            for k in final_keys:
                final_out[k] = []
            for k in r['fairness']:
                fair_out[k] = []
            for k in r['per_round']:
                per_round_out[k] = []

        for k in final_keys:
            final_out[k].append(r['final'][k])
        for k, v in r['fairness'].items():
            fair_out[k].append(v)
        for k, v in r['per_round'].items():
            per_round_out[k].append(v)

        if want_log and i == 0:
            sample = {
                'log': r['log'],
                'field': r['field'],
                'truth': r['truth'],
                'final_order': r['final_order'],
            }

        if progress is not None and (i % every == 0 or i == len(reps) - 1):
            progress(i + 1, len(reps))

    return json.dumps(
        _json_safe(
            {
                'ok': True,
                'version': VERSION,
                'replication_ids': reps,
                'final': final_out,
                'fairness': fair_out,
                'per_round': per_round_out,
                'sample': sample,
            }
        ),
        allow_nan=False,
    )


def _json_safe(obj):
    """NaN and +/-Inf are not valid JSON. Map them to null so JS gets real JSON.

    NaN is meaningful here -- round 1 has no churn, an all-tied ranking has no
    correlation -- so it becomes null rather than 0, and the UI drops those
    points instead of plotting them.
    """
    if isinstance(obj, float):
        return obj if obj == obj and obj not in (float('inf'), float('-inf')) else None
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    return obj


def smoke_test(config_json: str) -> str:
    """Run one tiny tournament to surface contract errors before a real batch."""
    cfg = json.loads(config_json)
    cfg = dict(cfg)
    cfg['players'] = min(int(cfg.get('players', 8)), 8)
    cfg['rounds'] = min(int(cfg.get('rounds', 3)), 3)
    cfg['replications'] = 1
    cfg['replication_ids'] = [0]
    cfg['want_log'] = True
    return run_batch(json.dumps(cfg))
