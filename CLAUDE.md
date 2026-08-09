# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Purpose

RankCraft simulates Swiss-system tournaments over a synthetic field whose **true
skill is known by construction**, then scores the resulting ranking against that
ground truth. Five plug points are user-supplied Python executed in the browser
via Pyodide. See [README.md](README.md) for the full picture.

## Two documents that must be maintained

### [ROADMAP.md](ROADMAP.md) — update it on every change

Tracks every feature and its state: **not started**, **started**, **done**
(complete *and* tests passing), **deferred**, **rejected**.

- **Any time work is done on the application, update the roadmap** as part of
  that change — not afterwards, and not only when a feature completes. Moving an
  item to `started` when you begin is part of the work.
- **Never work on a `deferred` item.** Deferred means stopped until the user
  changes the status. If a deferred item seems necessary, say so and stop; do not
  quietly restart it.
- Only mark `done` when the feature is complete and `npm run py:test`,
  `npm run typecheck` and `npm run lint` all pass.
- A `rejected` item must record **why** it was rejected, so the same idea is not
  re-proposed.
- Work that reveals a new feature, gap or limitation adds a row. The "Research
  findings" table at the bottom records questions already answered by
  measurement, so the same ground is not re-covered.

### [ADR.md](ADR.md) — review it on every architectural decision

Architectural decision records, for **close calls and non-obvious
requirement-driven choices only**.

- **Any time an architectural decision is made, review this file** and add an
  entry if the decision meets the bar.
- **No entry needed** when the choice is clear, conventional, or has no real
  alternative. Picking Next.js to match the sibling project, zod for schemas,
  Recharts for charts — none of these earn an entry, and adding them makes the
  file useless by burying the decisions that matter.
- **An entry is warranted** when a competent person would plausibly have chosen
  differently, or when a peculiar requirement drove the outcome. The test to
  apply: *would someone reading the code later be tempted to "fix" this, not
  knowing why it is the way it is?* If yes, write the entry — and say what the
  obvious alternative was and why it loses.
- Entries are append-only. Supersede rather than edit; ADR-006 and ADR-007 both
  correct earlier decisions and say so.

## Commands

```bash
npm run dev          # dev server at localhost:3000
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint
npm test             # node --test over src/**/*.test.ts (fast, ~0.3 s)
npm run e2e          # Playwright against a real browser
npm run verify       # typecheck + lint + test + py:test, in one command
npm run py:test      # the real test suite — boots Pyodide under Node and
                     # exercises the whole engine (~2 min)
npm run dev:debug    # dev server on port 3210 — what the VS Code target runs
npm run db:setup     # create Neon tables (needs .env.local)
```

In VS Code, F5 → **Debug RankCraft** (a compound with `stopAll`, so closing the
browser stops the server). It runs on **3210, not 3000**, because 3000 is often
occupied and Next silently falls through to the next free port. The port is
duplicated in `package.json` (`dev:debug`), `.vscode/launch.json` and
`.vscode/tasks.json` — change all three together. Do not add
`sourceMapPathOverrides` to the browser config: that key *replaces* js-debug's
built-in set, whose `webpack://?:*/*` rule already resolves Next's
`webpack://_N_E/./src/...` sources.

### Three suites, and what each one is for

`npm test` covers the pure TypeScript — statistics, slice partitioning, builtin
parsing, sweep expansion, config links, the outcome fit. It runs the sources
*as written* through Node's type stripping, which is why `verbatimModuleSyntax`
and `erasableSyntaxOnly` are switched on: unmarked type imports and parameter
properties load fine in the browser bundle and fail outright under Node. See
[ADR-011](ADR.md).

`npm run e2e` drives the real app. Several defects only ever surfaced this way —
runs vanishing on a hard navigation, a chart collapsing on a degenerate
distribution. Number fields carry a `data-field` attribute for stable selection;
prefer it to matching visible text.

**`npm run py:test` is the engine suite.** It asserts
known metric values, the zero-variance invariant, determinism across worker
slice boundaries, contract rejection, that every built-in runs end to end, and
that the literature ordering reproduces. Run it after touching anything under
`public/py/`.

## Architecture

The **entire replication batch runs inside Python**, one slice per worker. JS
crosses the boundary twice per batch plus a progress ping. Doing it per round
would dominate the runtime — do not restructure the loop to call into Python
per round.

Workers return **raw per-replication arrays**, not means. A mean cannot be
un-averaged, and the paired tests in Compare need the individual replications.
Aggregation lives in `src/lib/stats.ts`.

### Determinism is a hard invariant

Every random draw is keyed by content, never by call order — see the module
docstring in `public/py/harness.py`. Match noise is keyed on
`(seed, replication, lo_id, hi_id, meeting#)` and drawn in canonical id order,
so it does not depend on which side a pairing function put a player. This is
what makes two configurations a *paired* sample.

Consequences to preserve:

- Slices are contiguous and merged in order, so pool size never changes results.
- User code must use `ctx.rng`, never the bare `random` module. The API docs say
  so; do not add helpers that leak an unseeded RNG.
- Anything that introduces call-order-dependent randomness breaks the whole
  comparison story, not just one metric.

### Score-based games (the `w40k_*` / `ridge_*` / `info_gain*` family)

These model tournaments where a game yields a **score**, not just a winner.
`w40k_battle_points` returns 0–100 per side, so `Player.score` accumulates
*battle points*, not wins — which means `t.score_groups()` and `standings()`
are not the Swiss brackets you want. Pairing and ranking functions in this
family use `t.wins(pid)` — maintained by the harness — and set `bracket_by:
'wins'` so `score_groups()` buckets by record rather than by points. Do not
"fix" this by making the outcome function return 1/0: the margin is the entire
subject of the investigation.

`ridge_wl` and `ridge_margin` are deliberately the same estimator fed different
observations. Keep them in lockstep — their whole purpose is that the only
difference between them is win/loss versus margin.

The `info_gain*` pairings need **numpy**, which `requiredWheels()` in
`src/lib/pyodide/pool.ts` detects by scanning the code for the module name.
A new function that needs a new package needs an entry in `WHEELS`.

### The built-ins are executable documentation

`public/py/builtins/*.py` is real Python, split into editor snippets on
`##-- name | description --##` markers by `src/lib/builtins.ts`. The same file is
what the engine runs, what the picker shows, and what `py:test` exercises.

**Each snippet must be self-contained** — everything between one marker and the
next is exec'd in its own namespace. A shared helper (like `_solve`) must be
duplicated into every snippet that uses it.

`math`, `random`, `metrics`, `max_weight_pairing`, `assign_colors`, `pick_bye`,
`ridge_ratings`, `posterior_spread` and `matchup_bonus` are injected into that
namespace by `load_hook`; snippets do not import them. Reach for a new injected
helper rather than a fourth copy of the same solve — that is what removed the
duplication ADR-005 originally accepted.

### Optional models must not touch the random stream

Adding a feature that is switched off must leave every existing seed producing
exactly the field it always did. Calling `rng.gauss(0, 0)` still advances the
stream, so guard the *draw*, not just the parameter — see [ADR-012](ADR.md) and
the "a disabled feature does not touch the random stream" assertion in
`py-selftest`.

### Ground truth leaks are the main correctness hazard

`Player.skill` is ground truth. Only the `oracle` ranking may read it —
`looksLikeCheating()` in `src/lib/builtins.ts` warns when other code does.

The subtler leak: **every ranking tiebreaks on `Player.seed`**, so a perfect
seeding rating (`initial_rating.mode === 'true'`) makes seed order identical to
true-skill order and accuracy reads ~1.0 after round one. The default is
`noisy` for exactly this reason, and the UI flags `true` when selected. If you
change seeding or standings ordering, re-check this.

## Contracts

`validate_pairs` and `validate_order` in `harness.py` reject anything the
harness cannot use, with messages aimed at the person who wrote the function —
not stack traces. Keep them that way; the error text is UI.

`src/lib/apiDocs.ts` is the single source of truth for the reference panel shown
beside every editor. **It must be updated in the same change as any signature or
field change in `harness.py`.** Nothing enforces this automatically.

## Charts

Load the `dataviz` skill before writing chart code. The categorical palette in
`globals.css` is validated for colour-vision deficiency against the card
surface in both themes. Three light-mode slots sit below 3:1 contrast, so any
chart using them needs direct labels and a table view — `ConvergenceChart` shows
the pattern.

Colours are CSS custom properties (`var(--series-N)`), never hex literals, so
theme switching happens in one place.

## Database

Optional by design. `db()` returns `null` with no `DATABASE_URL`, routes answer
501, and the client stores in `localStorage` instead. **Do not add a code path
that requires the database** — running with nothing configured is the primary
local workflow.

## Gotchas

- On a mapped network drive, the first `next build` after adding a route can
  fail with `ENOENT: .next/types/...`. Race in Next's type generation; re-run.
- `networkx` is a vendored wheel installed by URL, not by name, to skip
  Pyodide's dependency resolution (its lock entry pulls in matplotlib). It loads
  lazily on first `max_weight_pairing` call.
- `json.dumps` must stay `allow_nan=False` with `_json_safe` mapping NaN to
  `null`. Bare `NaN` is not valid JSON and `JSON.parse` rejects it.
- Run results are large; the zustand store deliberately does **not** persist
  them (`partialize`).
