# Architecture decision records

Decisions that were **close calls**, or that were driven by a **non-obvious requirement**.

An ADR is not needed when a choice is clear, conventional, or has no real alternative. Next.js
because the sibling project uses it, zod for schema validation, Recharts for charts — none of
those need an entry. What earns an entry is a decision a competent person would plausibly have
made differently, or one whose reasoning would be lost and then re-litigated.

**Review this file whenever an architectural decision is made.** If the decision meets the bar
above, add an entry. Entries are append-only; supersede rather than edit.

---

## ADR-001 — Run user Python in the browser via Pyodide

**Status:** accepted · 2026-08-07

**Context.** The application executes user-authored Python. The obvious home for untrusted code is
a server sandbox, and there were four credible ones (Vercel Sandbox with Firecracker microVMs,
E2B, Modal, Cloudflare Sandbox). Pyodide — CPython compiled to WebAssembly — was the less
conventional option.

**Decision.** Pyodide in a pool of Web Workers.

**Why it was close.** Server sandboxes give real CPython with full pip, no WASM limits, and no
10 MB download. Pyodide gives up all of that. What decided it was that the code is the *user's
own*, run on the user's own machine, so the isolation a sandbox provides protects nobody who
needs protecting. Against that, Pyodide costs nothing per run, has no job queue or streaming
layer, works offline, and behaves identically in local development and on Vercel. A server
sandbox would have added a whole tier of infrastructure to solve a threat model that does not
exist here.

**Consequences.** Vercel only ever serves static assets and small JSON. No pip — packages must be
vendored as wheels (see ADR-008). Cancellation is awkward (see ADR-004). First run downloads
~10 MB, cached thereafter.

---

## ADR-002 — Run the whole replication batch inside Python

**Status:** accepted · 2026-08-07

**Context.** The natural decomposition is for JavaScript to own the tournament loop and call into
Python for each hook — it keeps orchestration, progress reporting and cancellation in the
language that has the UI.

**Decision.** JavaScript hands a worker one config blob containing all five code strings and a
slice of replication ids; Python runs the entire slice and returns aggregated arrays. The
JS/Python boundary is crossed twice per batch plus a progress ping.

**Why an ADR.** The obvious design is wrong for a non-obvious reason. A 64-player, 6-round,
200-replication run makes about 240,000 hook calls. Each JS↔Python crossing marshals proxies
across the WASM boundary at a cost that dwarfs the work being done inside the call, so the
boundary — not the simulation — would dominate the runtime.

**Consequences.** Progress is coarse (every ~5% of a slice) rather than per round. Cancellation
cannot be cooperative. Errors surface as a structured payload from `run_batch` rather than as
exceptions at a call site, which is why the contract validators carry human-readable messages.

---

## ADR-003 — Key every random draw by content, not by call order

**Status:** accepted · 2026-08-07

**Context.** The straightforward approach is one seeded RNG per replication, drawn from in
whatever order the simulation happens to need. That is reproducible, which sounds sufficient.

**Decision.** Every draw is keyed by *what it is about*:

- the field for replication *r* depends only on `(seed, r)`
- match noise depends only on `(seed, r, lo_id, hi_id, meeting#)`, drawn in canonical id order
- the RNG a pairing function receives depends only on `(seed, r, round)`

**Why an ADR.** This is the decision the entire comparison story rests on, and it is invisible
from the outside. Order-dependent RNG is reproducible but not *comparable*: two strategies would
see different match luck simply because they paired players in a different sequence, so a
difference between them would be confounded with a difference in dice. Content-keyed draws make
"player 7 versus player 12 in replication 40" get identical luck under every strategy, which
turns a comparison into a **paired** sample. In practice a few hundred paired replications
separate strategies that would need thousands of independent ones.

**Consequences.** Any future helper that draws from an unseeded source, or whose result depends
on call order, silently breaks the comparison rather than failing loudly — so user code is
documented to use `ctx.rng` only. Drawing in canonical id order is required, not stylistic: it
is what makes noise independent of which side a pairing function put a player on. The self-test
asserts both properties.

---

## ADR-004 — Cancellation terminates and respawns workers

**Status:** accepted · 2026-08-07

**Context.** Pyodide cannot be interrupted mid-computation without `SharedArrayBuffer` and
`setInterruptBuffer`, which require COOP/COEP headers on every response.

**Decision.** Cancelling a run terminates the workers and boots fresh ones.

**Why an ADR.** The alternative is not exotic — COOP/COEP is a documented Pyodide setup — so the
reasoning for declining it should be recorded. Those headers make the page cross-origin isolated,
which breaks the ability to load anything from a third-party origin without explicit CORP
headers, including the Pyodide CDN itself (ADR-001) unless the runtime is also vendored. That is
a large, permanent constraint on the whole application in exchange for making one rare user
action a little cleaner.

**Consequences.** Cancelling costs the ~10 s of a fresh boot on the next run. Revisit if runtime
vendoring happens for other reasons.

---

## ADR-005 — Built-in functions live in executable Python, not TypeScript constants

**Status:** accepted · 2026-08-07

**Context.** The UI needs the built-in library as data: names, descriptions, code, parameters. The
conventional home for that is a TypeScript constant array, typed and refactorable.

**Decision.** They live in `public/py/builtins/*.py` as real Python, split into editor snippets on
`##-- name | description --##` marker comments.

**Why an ADR.** Choosing a marker-delimited flat file over a typed data structure looks like a
downgrade. It buys one thing that matters more: the file the picker displays is the *same file*
the engine executes and the test suite runs. A TypeScript copy would be a second source of truth
that drifts, and the drift would be silent — a built-in shown in the UI could stop matching what
actually ran, which is a correctness problem in a tool whose output is a measurement. This is
also why the `/dev/selftest` browser page was rejected in favour of `npm run py:test`: one
executable source, one way to run it.

**Consequences.** Each snippet is exec'd in its own namespace, so a shared helper must be
duplicated into every snippet that uses it (`_solve` appears twice). No type checking on built-in
code — the self-test compensates by running every one of them end to end.

---

## ADR-006 — Completed runs cache in IndexedDB, not localStorage

**Status:** accepted · 2026-08-08 · corrects an earlier choice

**Context.** The original plan deliberately kept run results out of persistent storage: they are
large, and the zustand store's `partialize` excluded them. Browser testing then found that
results vanished on any hard navigation or refresh, which breaks Compare — the feature the
application exists for.

**Decision.** Runs persist to IndexedDB via `src/lib/store/runCache.ts`, keeping the last eight.
The zustand store still persists only config and step.

**Why an ADR.** The tempting fix is localStorage, since the persistence layer is already there.
It does not work: a 500-replication run is a few hundred KB of raw per-replication arrays and the
5 MB origin quota would be exhausted by a handful of them, failing at write time with no useful
recovery. IndexedDB has no comparable ceiling and is the correct tool, at the cost of async
hydration — which is why `useHydratedRuns` exists and why the results step renders a loading
state instead of "nothing has been run yet".

**Consequences.** Views reading runs must hydrate before deciding the list is empty; getting this
wrong reintroduces the original bug in a subtler form.

---

## ADR-007 — Store the full per-replication payload, not normalised metrics

**Status:** accepted · 2026-08-08 · supersedes the planned `run_metrics` table

**Context.** The plan called for a normalised `run_metrics` table holding per-round aggregates,
with raw per-replication data discarded as too large.

**Decision.** `runs.result` is a single jsonb column containing the complete `BatchResult`,
including every per-replication array. The `run_metrics` table was never built.

**Why an ADR.** Discarding the raw arrays would have quietly removed the application's main
capability. Compare's paired tests operate on per-replication *differences*; a mean cannot be
un-averaged, so a stored run reduced to aggregates can be charted but never paired-tested against
anything. The size objection turned out to be small — a 500-replication run is a few hundred KB
of JSON, well inside a jsonb column — and it is bounded by an 8 MB guard on the route.

**Consequences.** Listing runs must not return payloads; `/api/runs` sends them only under
`?full=1`. Denormalised `seed`, `replications` and `kendall_tau` columns exist so listing and
sorting never parse the blob.

---

## ADR-008 — Install Python wheels by URL and detect them from user code

**Status:** accepted · 2026-08-08

**Context.** Two functions need scientific libraries: optimal matching needs networkx, and the
information-gain pairings need numpy. Pyodide's `loadPackage('networkx')` resolves dependencies
from its lockfile.

**Decision.** Wheels are vendored in `public/py/wheels/` and installed by **URL**, which bypasses
dependency resolution. `requiredWheels()` scans the selected function code for the module name
and loads only what is needed; the pool rebuilds if a later run needs a wheel the live workers
lack.

**Why an ADR.** Both halves are counter-intuitive. Installing by name is the documented path, but
Pyodide's lock entry for networkx conservatively lists matplotlib, pillow and fonttools — pulling
in roughly 25 MB to use one graph algorithm from a library that in fact has no required
dependencies. And loading both wheels unconditionally would add 15 MB to the first run of every
configuration, when most configurations use neither.

**Consequences.** A new dependency needs an entry in `WHEELS` and a module name detectable in
user code. Wheel versions are pinned by filename and drift from the Pyodide runtime version is
possible; the self-test catches it by exercising every built-in.

---

## ADR-009 — In score-based games, `Player.score` holds the game score, not wins

**Status:** accepted · 2026-08-08

**Context.** Modelling Warhammer 40k, where each game produces 0–100 battle points per side. The
harness accumulates whatever `play_match` returns into `Player.score`, and `score_groups()` and
`standings()` are built on it. Returning win/loss from `play_match` would have kept all the
existing Swiss machinery working directly.

**Decision.** `w40k_battle_points` returns battle points. `Player.score` therefore accumulates
battle points, `score_groups()` is not a bracket structure, and pairing and ranking functions in
this family compute the win/loss record themselves from `t.results_against(pid)`.

**Why an ADR.** It deliberately breaks a convenience the harness offers, and the reason is the
entire point of the investigation: the margin is the object of study. Returning 1/0 would discard
it at the moment of recording, leaving no way for any downstream function to recover it —
`MatchRecord.skill_a` is the noisy true skill and reading it would be a ground-truth leak, not a
substitute. Keeping the raw score costs the built-in bracketing helpers and buys the only data
the question is about.

**Consequences.** Anyone extending this family must not "fix" the outcome function to return
wins. The trade produced a measured result — margins are worth +0.069 ± 0.004 τ over the same
estimator fed win/loss — so the cost was justified.

---

## ADR-010 — VS Code debug target is a compound with `stopAll`

**Status:** accepted · 2026-08-08

**Context.** The requirement was a single target that starts the dev server, opens a debugging
browser, and stops the server when the browser closes. The idiomatic mechanism is
`serverReadyAction: { action: "startDebugging" }`, which launches the browser only once the
server prints its URL — solving startup ordering elegantly and with no extra files.

**Decision.** A compound of two configurations with `"stopAll": true`, plus a `preLaunchTask`
that polls until the server responds.

**Why it was close.** `startDebugging` makes the browser a *child* debug session. Terminating a
child does not terminate its parent, so closing the browser would leave the dev server running —
exactly the requirement that was asked for. `stopAll` provides the lifecycle link, at the cost of
having to solve startup ordering separately.

**Why the port is 3210.** Port 3000 was occupied by another dev server on this machine, and Next
*silently* falls through to the next free port when it is. A wait step that accepted any HTTP 200
would have attached the debugger to a different application with no error, so the poll checks for
a RankCraft marker in the response body and fails loudly with instructions.

**Consequences.** The port is duplicated across `package.json` (`dev:debug`), `.vscode/launch.json`
and `.vscode/tasks.json` and all three must agree. `sourceMapPathOverrides` is deliberately
absent: setting it *replaces* the debugger's built-in rules, whose `webpack://?:*/*` entry already
resolves the `webpack://_N_E/./src/...` paths Next emits.

---

## ADR-011 — Node's own test runner, with a resolver hook, instead of a test framework

**Status:** accepted · 2026-08-09

**Context.** The TypeScript layer had no tests, which is how a wrong tie
correction reached the Compare view. The conventional fix is Vitest or Jest:
both resolve TypeScript and path aliases out of the box.

**Decision.** `node --test` over the sources as written, with a ~30-line
resolver hook in `scripts/test-resolver.mjs` supplying the two things Node's ESM
loader will not do for itself — extensionless specifiers and the `@/*` alias.

**Why it was close.** A framework would have been less work up front. Against
that: Node 24 already strips types natively, so the only gap was resolution, and
a test runner is a large dependency to carry for a gap that size — Vitest pulls
in Vite. The deciding factor was that running the *unmodified* sources keeps the
test environment honest. A framework transpiles, and a transpiler will happily
accept TypeScript the browser bundle also accepts but Node cannot execute.

**Consequences.** Two compiler options are now load-bearing rather than
stylistic, and both were switched on by this decision after the failures they
prevent showed up in practice:

- `verbatimModuleSyntax` — an unmarked type import survives stripping as a real
  runtime import of a name that does not exist.
- `erasableSyntaxOnly` — a parameter property (`constructor(readonly size)`)
  needs codegen and simply fails to load.

Both would otherwise be caught only at test time and look like mysterious
resolution errors. Test files import with explicit `.ts` extensions
(`allowImportingTsExtensions`), which is why the hook only has to cover `src`.

---

## ADR-012 — An optional model that is switched off must not touch the RNG

**Status:** accepted · 2026-08-09

**Context.** Adding matchups and fatigue meant drawing a per-player archetype
and stamina during field generation. The obvious implementation draws
unconditionally and multiplies by an amplitude of zero — the feature is off, so
the draw has no effect.

**Decision.** Every optional draw is guarded on the feature actually being able
to affect a game, not merely on its parameter being zero. `build_field` checks
`kind != 'none' and amplitude > 0` before drawing an archetype, not just
`archetypes > 1`.

**Why an ADR.** The guards look pointless and will be removed by someone
tidying up. They are not: calling `rng.gauss(0, 0)` still *advances the stream*,
so every subsequent draw shifts and every existing seed produces a different
field. Both halves of this were found the hard way — the first version zeroed
the parameter and moved the literature benchmark from 0.8094 to 0.8103; the
second guarded on the archetype count and was caught by a test asserting that a
fully-disabled configuration is byte-identical to one that never mentioned the
feature.

**Consequences.** Reproducibility survives adding features, which is what makes
a seed quoted in an old report still mean something. `py-selftest` asserts it
directly ("a disabled feature does not touch the random stream"); keep that test
passing when adding the next optional model.

---

## ADR-013 — The outcome hook sees the players; the others do not

**Status:** accepted · 2026-08-09

**Context.** Modelling a player who tires, who faces a bad matchup, or who
stops pressing once they are out of contention all need information
`play_match(skill_a, skill_b, ctx)` did not have. The uniform thing to do is
give every hook the same context.

**Decision.** Only the outcome hook receives `ctx.a`, `ctx.b`, `ctx.tournament`
and `ctx.first`. Pairing, ranking, seeding and rating keep the narrower context.

**Why an ADR.** The asymmetry is deliberate and looks like an oversight. The
outcome hook is the one function that legitimately sees ground truth — it is
handed true skill by definition — so giving it the `Player` objects costs
nothing. Handing the same objects to a pairing or ranking function would put
`p.skill` one attribute access away from code that must not read it, turning a
documented rule into an invitation. `looksLikeCheating` can flag `.skill` in
source text; it cannot police an object graph.

**Consequences.** Effects that depend on *who* is playing must be applied by the
harness before `play_match` (matchups, fatigue, side advantage all are), or
implemented inside the outcome function. A pairing function that wants to know
about archetypes uses `Player.archetype`, which is public information by
construction — you can see the army across the table.

---

## ADR-014 — The outcome fit reports strength spread, not points-per-skill

**Status:** accepted · 2026-08-09

**Context.** The fitting page recovers latent player strength from real results
and reports the parameters the simulator needs. The natural output is the
simulator's own `points_per_skill`: the slope of margin on skill gap.

**Decision.** `OutcomeFit` exposes `skillSd` — the spread of fitted strengths in
score units — and the rating axis is chosen afterwards in `fitToConfig`.

**Why an ADR.** `points_per_skill` is not identifiable from margins, and
reporting it as a finding would be reporting an artefact. Doubling every
player's skill while halving the slope predicts exactly the same games, so only
their product is a fact about the event; the split between them is a choice of
units. A test asserting that a five-fold stronger skill effect produces a larger
slope is what surfaced this — it failed, correctly, because the fitted slope
comes out near 1 either way.

**Consequences.** `fitToConfig` picks a rating axis four standard deviations
wide so the familiar 1400–2200 range covers the field, then derives
`points_per_skill` from that choice. Anyone quoting a fitted `points_per_skill`
as a property of their event is quoting the axis we picked. What the data does
fix — and what the page shows — is the par score, the residual spread, R², the
draw rate and the share of games at the scoreboard ceiling.
