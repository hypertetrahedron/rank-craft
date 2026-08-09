# RankCraft built-in match outcome functions.
#
# `play_match(skill_a, skill_b, ctx) -> (points_a, points_b)`
#
# The skills you receive are EFFECTIVE skills: base skill with this match's
# random component already applied by the harness (step 2 of the wizard). If the
# variance is zero, skill_a and skill_b are the raw true skills, so the stronger
# player wins every time.
#
# The two numbers you return are the currency of the whole simulation. They
# accumulate into Player.score, they define the score groups the pairing
# function sees, and every tiebreak reads them.

##-- winner_takes_1 | Chess scoring: 1 for the win, 0 for the loss, 0.5 each on an exact tie. --##
def play_match(skill_a, skill_b, ctx):
    if skill_a > skill_b:
        return (1.0, 0.0)
    if skill_b > skill_a:
        return (0.0, 1.0)
    return (0.5, 0.5)


##-- win_draw_loss | Chess scoring with a draw band: skills closer than `draw_margin` split the point. --##
PARAMS = {'draw_margin': {'default': 40.0, 'min': 0.0, 'max': 400.0, 'step': 5.0}}


def play_match(skill_a, skill_b, ctx):
    d = skill_a - skill_b
    if abs(d) <= ctx.params['draw_margin']:
        return (0.5, 0.5)
    return (1.0, 0.0) if d > 0 else (0.0, 1.0)


##-- football_3_1_0 | Three points for a win, one each for a draw. Rewards winning far more than drawing, which changes how score groups form. --##
PARAMS = {'draw_margin': {'default': 40.0, 'min': 0.0, 'max': 400.0, 'step': 5.0}}


def play_match(skill_a, skill_b, ctx):
    d = skill_a - skill_b
    if abs(d) <= ctx.params['draw_margin']:
        return (1.0, 1.0)
    return (3.0, 0.0) if d > 0 else (0.0, 3.0)


##-- bradley_terry | Probabilistic: P(a wins) = 1 / (1 + 10 ** (-(skill_a - skill_b) / scale)). Ignores the step-2 variance model and derives all randomness from the skill gap itself. --##
PARAMS = {'scale': {'default': 400.0, 'min': 25.0, 'max': 1200.0, 'step': 25.0}}


def play_match(skill_a, skill_b, ctx):
    p = 1.0 / (1.0 + 10.0 ** (-(skill_a - skill_b) / ctx.params['scale']))
    return (1.0, 0.0) if ctx.rng.random() < p else (0.0, 1.0)


##-- w40k_battle_points | Warhammer 40k: both players score 0-100 battle points, and the higher score wins. The margin is real information the win/loss record throws away — but the 0-100 cap censors blowouts, so a thrashing tells you less than the raw gap suggests. Returns integers, so genuine draws happen. --##
PARAMS = {
    # Battle points a perfectly matched pair each end on. Real 40k games tend to
    # land in the 70s-80s for both players.
    'par_score': {'default': 78.0, 'min': 40.0, 'max': 95.0, 'step': 1.0},
    # How many battle points of margin one point of skill gap is worth. With a
    # 1400-2200 field, 0.05 turns a 400-point skill gap into a 20 point margin.
    'points_per_skill': {'default': 0.05, 'min': 0.005, 'max': 0.3, 'step': 0.005},
}


def play_match(skill_a, skill_b, ctx):
    par = ctx.params['par_score']
    swing = (skill_a - skill_b) * ctx.params['points_per_skill'] / 2.0
    a = min(100.0, max(0.0, round(par + swing)))
    b = min(100.0, max(0.0, round(par - swing)))
    return (a, b)


##-- margin_points | Best-of-N series. The favourite still usually wins, but the score carries the margin, so a narrow win is worth less than a rout. --##
PARAMS = {
    'games': {'default': 3, 'min': 1, 'max': 15, 'step': 2},
    'scale': {'default': 400.0, 'min': 25.0, 'max': 1200.0, 'step': 25.0},
}


def play_match(skill_a, skill_b, ctx):
    p = 1.0 / (1.0 + 10.0 ** (-(skill_a - skill_b) / ctx.params['scale']))
    games = int(ctx.params['games'])
    wins_a = sum(1 for _ in range(games) if ctx.rng.random() < p)
    return (float(wins_a), float(games - wins_a))


##-- w40k_with_coasting | Battle points, but players who have nothing left to play for stop pressing. This is the honest cost of any margin-aware ranking: once the standings reward every point, a player who is out of contention has no reason to keep scoring, and a player who has already clinched has every reason to run up the total. Uses `ctx.a`, `ctx.b` and `ctx.tournament` to see who is still live. --##
PARAMS = {
    'par_score': {'default': 78.0, 'min': 40.0, 'max': 95.0, 'step': 1.0},
    'points_per_skill': {'default': 0.05, 'min': 0.005, 'max': 0.3, 'step': 0.005},
    # How hard a player who has nothing to gain still tries. 1.0 is no effect.
    'coast_effort': {'default': 0.6, 'min': 0.0, 'max': 1.0, 'step': 0.05},
    # Wins needed to still be playing for something in the final round.
    'contention_wins': {'default': 4.0, 'min': 0.0, 'max': 12.0, 'step': 0.5},
}


def _still_playing_for_something(t, p, ctx):
    """A player is live if they can still reach the contention threshold."""
    if ctx.round < ctx.total_rounds:
        return True
    remaining = ctx.total_rounds - ctx.round + 1
    return t.wins(p.id) + remaining >= ctx.params['contention_wins']


def play_match(skill_a, skill_b, ctx):
    par = ctx.params['par_score']
    swing = (skill_a - skill_b) * ctx.params['points_per_skill'] / 2.0
    a = par + swing
    b = par - swing

    t = ctx.tournament
    effort = ctx.params['coast_effort']
    # A coasting player drifts back toward par: they still win or lose the game,
    # they just stop chasing the last few points.
    if not _still_playing_for_something(t, ctx.a, ctx):
        a = par + (a - par) * effort
    if not _still_playing_for_something(t, ctx.b, ctx):
        b = par + (b - par) * effort

    return (min(100.0, max(0.0, round(a))), min(100.0, max(0.0, round(b))))


##-- w40k_first_turn | Battle points where going first is worth something, which in 40k it demonstrably is. The harness has already applied the side advantage to the effective skill it hands you — `ctx.first` names the player who got it, or None when sides are switched off in step 2. --##
PARAMS = {
    'par_score': {'default': 78.0, 'min': 40.0, 'max': 95.0, 'step': 1.0},
    'points_per_skill': {'default': 0.05, 'min': 0.005, 'max': 0.3, 'step': 0.005},
}


def play_match(skill_a, skill_b, ctx):
    par = ctx.params['par_score']
    swing = (skill_a - skill_b) * ctx.params['points_per_skill'] / 2.0
    a = min(100.0, max(0.0, round(par + swing)))
    b = min(100.0, max(0.0, round(par - swing)))
    return (a, b)
