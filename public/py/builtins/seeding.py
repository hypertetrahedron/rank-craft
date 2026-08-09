# RankCraft built-in seeding functions.
#
# `seed_order(players, ctx) -> list[int]` returns player ids, best seed first.
# The harness writes the result back as `Player.seed` (1-based), which is what
# round-1 pairings and standings tiebreaks read.
#
# Each block below is a self-contained editor snippet: name, description, then
# the code. They are split on the ##--## markers by src/lib/builtins.ts.

##-- by_rating | Seed by starting rating. The standard: strongest first. --##
def seed_order(players, ctx):
    return [p.id for p in sorted(players, key=lambda p: (-p.rating, p.id))]


##-- random | Shuffle the field. Removes the information a rating-based seed gives round 1. --##
def seed_order(players, ctx):
    ids = [p.id for p in players]
    ctx.rng.shuffle(ids)
    return ids


##-- snake | Rating order, but alternate the direction within blocks of 4. Spreads strong players across the seeding table. --##
PARAMS = {'block': {'default': 4, 'min': 2, 'max': 32, 'step': 1}}


def seed_order(players, ctx):
    block = int(ctx.params['block'])
    ranked = sorted(players, key=lambda p: (-p.rating, p.id))
    out = []
    for i in range(0, len(ranked), block):
        chunk = ranked[i : i + block]
        if (i // block) % 2 == 1:
            chunk = list(reversed(chunk))
        out.extend(chunk)
    return [p.id for p in out]


##-- accelerated_groups | Split the field into an upper and lower half by rating, then interleave. Pairs strong-vs-strong sooner. --##
def seed_order(players, ctx):
    ranked = sorted(players, key=lambda p: (-p.rating, p.id))
    half = (len(ranked) + 1) // 2
    top, bottom = ranked[:half], ranked[half:]
    out = []
    for i in range(half):
        out.append(top[i])
        if i < len(bottom):
            out.append(bottom[i])
    return [p.id for p in out]
