# RankCraft

Simulate Swiss-system tournaments against a field whose **true skill is known by
construction**, then measure how accurately each pairing and ranking strategy
recovers it — and how many rounds it needed.

Every strategy is user-editable Python, running in your browser.

```bash
npm install
npm run dev          # http://localhost:3000 — no database needed
npm run py:test      # verify the simulation engine
npm run verify       # everything except the browser suite
```

In VS Code, press **F5** and pick **Debug RankCraft** — see [Debugging](#debugging).

Feature status lives in [ROADMAP.md](ROADMAP.md); the reasoning behind the non-obvious
architectural choices lives in [ADR.md](ADR.md).

## Why

The question "does this pairing algorithm plus this tiebreak actually rank
players by skill?" has an academic answer — Biró, Fleiner & Palincza simulated
Dutch, Burstein, Monrad and Random systems and ranked them by normalised Kendall
tau ([arXiv:2112.10522](https://arxiv.org/pdf/2112.10522)) — but it is a paper,
not something you can poke. RankCraft is the tool: because skill is synthetic,
every configuration gets an objective accuracy number, a convergence curve, and
an error bar.

The engine reproduces the paper's headline ordering. `npm run py:test` asserts it:

```
burstein 0.8094  dutch_slide 0.8005  random2 0.7994  random 0.7444  monrad 0.7427
```

## The five plug points

The harness owns all bookkeeping — scores, colours, byes, floats, history,
validation — so each function answers exactly one question.

| Hook | Signature | Job |
|---|---|---|
| Seeding | `seed_order(players, ctx) -> list[int]` | The seeding table round 1 pairs from |
| Pairing | `pair_round(t, ctx) -> list[(a, b \| None)]` | Who plays whom, each round |
| Outcome | `play_match(skill_a, skill_b, ctx) -> (points_a, points_b)` | Two skills in, two point totals out |
| Rating | `update_ratings(t, results, ctx) -> None` | Elo/Glicko-style update after each round |
| Ranking | `rank_players(t, ctx) -> list[int]` | The standings — called after **every** round |

`play_match` is the pivot. The two numbers it returns are the currency of the
whole simulation: they accumulate into `Player.score`, they define the score
groups the pairing function sees, and every tiebreak reads them. Chess is
`(1, 0)`, a draw is `(0.5, 0.5)`, football is `(3, 0)`, a best-of-5 is
`(3, 2)`.

`rank_players` runs after every round rather than only the last. That is what
makes the convergence curve measurable, and it costs a user function nothing.

Full API reference sits beside every editor in the app, generated from
`src/lib/apiDocs.ts`.

## Determinism and common random numbers

Every random draw is keyed by *content*, never by call order:

- the field for replication *r* depends only on `(seed, r)`
- the noise in a match depends only on `(seed, r, lo_id, hi_id, meeting#)`
- the RNG a pairing function receives depends only on `(seed, r, round)`

So "player 7 versus player 12 in replication 40" gets identical luck no matter
which strategy paired them. Two configurations on the same seed are therefore a
**paired** sample, and the Compare view tests the differences rather than the two
means — which is why a few hundred replications separate strategies that would
otherwise need thousands.

The same property makes worker-pool size a pure performance knob: slices are
contiguous and merged in order, so 1 worker and 8 workers produce identical
output. `npm run py:test` asserts that too.

## Architecture

```
browser main thread          worker × N                  Pyodide (CPython → WASM)
  config + code strings ────► init ──────────────────────► exec the 5 hooks
  replications 0..249                                      run the whole slice
           ◄──────────── progress ◄──────────────────────── every ~5%
           ◄──────────── metrics  ◄──────────────────────── per-replication arrays
  merge slices → confidence intervals, paired tests, charts
```

The **entire** replication batch runs inside Python. The JS/Python boundary is
crossed twice per batch, not once per round — crossing it per round is what
would make this slow.

Workers return raw per-replication values rather than means: a mean cannot be
un-averaged, and the paired tests need the individual replications.

| Path | What |
|---|---|
| `public/py/harness.py` | Simulation engine, contracts, validation, keyed RNG |
| `public/py/metrics.py` | Kendall τ-b, Spearman, NDCG, displacement, convergence |
| `public/py/builtins/*.py` | The reference function library — real Python, split into editor snippets on `##-- name \| description --##` markers |
| `src/workers/sim.worker.ts` | One Pyodide instance per worker |
| `src/lib/pyodide/pool.ts` | Slice partitioning, progress, merge |
| `src/lib/stats.ts` | Confidence intervals, paired t-test, Wilcoxon |
| `src/lib/apiDocs.ts` | The contract shown beside every editor |

The built-in library is **the same file the engine executes and the test suite
runs** — what you read in the picker is what actually ran.

## Score-based games (the 40k family)

The built-in library includes a set of functions for tournaments where each game
produces a **score**, not just a winner — Warhammer 40k, where both players end
on 0–100 battle points, is the worked example.

`w40k_battle_points` is the outcome model; `w40k_swiss` pairs the way a real
event does (bucket by record, fold the bracket, margins ignored);
`w40k_standings` ranks the way a real event does (record, then total battle
points). Against those baselines:

- `ridge_wl` / `ridge_margin` are the *same* estimator fed win/loss versus fed
  margins, so the difference between them is exactly what the margin is worth.
- `info_gain`, `info_gain_censored` and `info_gain_bracketed` pair to maximise
  expected information gain rather than to match records — D-optimal design on
  the play graph, where the posterior precision is the graph Laplacian plus a
  prior.

The `/sweep` page runs any of this as a matrix from the browser; the scripts below
do the same thing headlessly and print paired intervals:

```bash
npm run bench -- --players 64 --rounds 6 --reps 200   # pairing × ranking matrix
npm run bench:rounds                                   # accuracy vs round count
npm run bench:collision                                # forces true #1 vs #2 in round 1
```

Everything runs under common random numbers, so every cell of the matrix sees an
identical field and identical match luck and the comparisons are paired.

## Reading the numbers

Two built-in ranking functions are reference points rather than strategies:

- **`oracle`** ranks by true skill. τ = 1.0 by definition. The ceiling.
- **`initial_seed`** ignores every result and ranks by seeding. The floor — how
  good you would look without holding the tournament at all.

Run both on the same seed. A τ of 0.82 is unreadable without them.

**The seeding-rating setting is a trap worth knowing about.** With *perfect*
seeding, seed order *is* true-skill order, and every ranking function tiebreaks
on seed — so ground truth leaks into the standings, accuracy reads ~1.0 after
round one, and then *falls* as real results arrive. The default is therefore
imperfect seeding. The UI flags the perfect setting when you choose it.

Fairness is reported next to accuracy on purpose. A pairing system that recovers
the true order by handing out rematches and lopsided colours has not solved the
problem; it has moved the cost somewhere the accuracy metric cannot see.

## Debugging

`.vscode/launch.json` defines one target to use: the **Debug RankCraft**
compound. It starts the dev server, waits until that server is genuinely
serving, opens a debugging browser at it, and — because the compound sets
`stopAll` — **closing the browser window stops the server too**, so no orphaned
process is left holding the port or the `.next` directory.

Breakpoints bind in all three places the app runs: React components and hooks,
API routes under `src/app/api` (the `node-terminal` launch type auto-attaches to
the child processes Next spawns), and `src/workers/sim.worker.ts` — the debugger
attaches to Web Workers on its own, which is the only practical way to inspect
the Pyodide bridge.

Two details worth knowing:

- **The debug target uses port 3210, not 3000.** Port 3000 is frequently taken
  by another dev server, and Next quietly moves to the next free port when it
  is — which would leave the debugger attached to a different app entirely. The
  wait step checks for a RankCraft marker in the response rather than settling
  for any HTTP 200, so a port collision fails loudly with instructions instead
  of silently debugging the wrong thing. The port lives in three files that must
  agree: `package.json` (`dev:debug`), `.vscode/launch.json`, `.vscode/tasks.json`.
- **The browser keeps a persistent profile** at `.vscode/.chrome-profile`
  (gitignored). Saved functions live in `localStorage` and completed runs in
  IndexedDB when no database is configured, so a throwaway profile would wipe
  your work on every F5. Delete that directory to start clean.

## Known limits

- The built-in pairing systems are faithful-in-spirit reconstructions, not
  certified FIDE implementations. `dutch_slide` is bracket-local with escalation
  into the next score group; it still averages ~0.8 forced rematches per
  32-player, 7-round tournament when the bottom bracket is exhausted, which the
  diagnostics panel reports. `burstein` matches globally and reaches zero.
- Cancelling a run terminates and respawns the workers. Pyodide cannot be
  interrupted mid-computation without `SharedArrayBuffer`, which needs
  COOP/COEP headers.
- `networkx` is vendored as a 3.6 MB wheel in `public/py/wheels/` and loaded
  lazily, only when a pairing function calls `max_weight_pairing`. It is
  installed by URL rather than by name so Pyodide's dependency resolution — whose
  lock entry conservatively pulls in matplotlib — is skipped.
- Recharts renders the charts. The palette is validated for colour-vision
  deficiency in both themes; three light-mode slots fall below 3:1 contrast, so
  every chart that uses them ships direct labels and a table view.

## Deployment

Vercel plus Neon. The database is **optional** — with no `DATABASE_URL` the API
routes answer 501 and the client falls back to `localStorage` and IndexedDB,
which is how it runs locally.

```bash
cp .env.example .env.local     # or let the Neon integration populate it
npm run db:setup               # create the tables (idempotent)
npm run db:check               # verify the live columns match what the code reads
```

`db:check` exists because `db:setup` reporting "ok" only means the DDL ran. It
compares the live columns against the ones the application actually reads, and
prints row counts and database size. `npm run db:purge-owner <uuid>` clears one
anonymous identity; it refuses to run without an explicit id so it cannot become
an accidental "empty the database".

`vercel.json` pins functions to `iad1`, beside the Neon region — every API route
makes a database round trip, so putting them on the other side of the country
would dominate their latency. The vendored Pyodide wheels are served
`immutable` (they are versioned by filename, and numpy alone is 11 MB), the
engine `.py` files revalidate because they change with a deploy, and the
owner-scoped API is `no-store` — a shared cache serving one browser's saved
functions to another would be a data leak rather than a performance win.

Nothing about the simulation touches the server: Pyodide runs in the browser, so
Vercel only ever serves static assets and small JSON.

The browser suite normally runs against a local dev server, which has no
database and so writes nothing. `E2E_BASE_URL=https://… npm run e2e` points it
at a real deployment instead — worth doing, because the Pyodide worker is
bundled differently in production — but note that the two tests which run a
simulation will save their results to whatever database that deployment uses.
`npm run db:purge-owner <uuid>` clears them.

### Bringing existing work into a new database

There is no server-side migration script, and the absence is deliberate — see
[ADR-015](ADR.md). The database starts empty and every saved function, setup and
completed run lives in the browser that made it, so only that browser can upload
them. Open the app with a database configured and a banner offers to; local
copies are kept, and re-running it uploads nothing twice.

### A note on Windows network drives

On a mapped network drive, `next build` can fail the first time with
`ENOENT: ... .next/types/...`. It is a race in Next's type generation, not a
code error — run it again.
