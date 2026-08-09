# Roadmap

Feature tracker for RankCraft. **This file must be updated whenever work is done on the
application** — before finishing a change, move the affected items to their new state and add
any features the work revealed.

## States

| State | Meaning |
|---|---|
| **not started** | No development has been done on this feature. |
| **started** | Some work has been done; the feature is not complete. |
| **done** | The feature is complete and all tests pass. |
| **deferred** | Work is stopped and will not restart until the user changes the status. **Do not work on deferred items.** |
| **rejected** | Considered and found inappropriate. Must record why. |

Last updated: 2026-08-09 (second pass: every not-started item implemented except deployment)

---

## Simulation engine

| Feature | State | Notes |
|---|---|---|
| Tournament harness (`harness.py`) | **done** | Players, rounds, colours, byes, floats, history, contract validation. |
| Five plug points | **done** | `seed_order`, `pair_round`, `play_match`, `update_ratings`, `rank_players`. |
| Content-keyed RNG / common random numbers | **done** | See [ADR-003](ADR.md). Verified by the self-test. |
| Ranking called every round | **done** | Required for convergence curves. |
| Contract validation with human-readable errors | **done** | `validate_pairs`, `validate_order`; error text is UI. |
| Metrics (`metrics.py`) | **done** | Kendall τ-b, Spearman, NDCG, precision@k, displacement, convergence. |
| 40k top-heavy metrics | **done** | `p_at_2`, `true_second_place`, `top8_displacement`. |
| Non-transitive skill (rock-paper-scissors matchups) | **done** | Circular archetypes with an antisymmetric bonus. Measured: it drops τ from 0.80 to 0.47 at high amplitude, and `matchup_adjusted` recovers most of that (0.57 → 0.83). |
| Per-player fatigue / round-order effects | **done** | Per-player stamina drawn once; only uneven fatigue changes a ranking, which the self-test asserts. |
| Player choice to press or coast on score | **done** | `w40k_with_coasting` uses `ctx.a`/`ctx.b`/`ctx.tournament` to see who is still live. Prices the incentive problem a margin-aware ranking creates. |
| Side / first-turn advantage visible to `play_match` | **done** | Config `side.mode` (off / rolled off / set by pairing) plus `ctx.first`. Switching it on also makes the colour diagnostics meaningful. See [ADR-013](ADR.md). |
| Top-cut bracket after the Swiss rounds | **done** | Seeded single elimination after the Swiss rounds, with `cut_winner_is_best`, `cut_winner_true_rank` and `cut_field_quality`. |
| Fit the outcome model to real event results | **done** | The `/fit` page. Reports what is identifiable and says so — see [ADR-014](ADR.md). |

## Function library

| Feature | State | Notes |
|---|---|---|
| Pairing: random, random2, monrad, dutch_slide, burstein, mwm_tunable, accelerated, king_of_the_hill, by_live_rating | **done** | Reproduces the arXiv:2112.10522 ordering. |
| Ranking: score, Buchholz family, Sonneborn-Berger, cumulative, ARO, Bradley-Terry, Colley, Massey, PageRank, oracle, initial_seed | **done** | |
| Outcome: winner_takes_1, win_draw_loss, football_3_1_0, bradley_terry, margin_points | **done** | |
| Rating: none, elo, elo_decaying_k, glicko2, performance_rating | **done** | |
| Seeding: by_rating, random, snake, accelerated_groups | **done** | |
| 40k family: `w40k_battle_points`, `w40k_swiss`, `w40k_standings`, `w40k_standings_sos` | **done** | Score-based games where `Player.score` is battle points, not wins. See [ADR-009](ADR.md). |
| Margin estimators: `ridge_wl`, `ridge_margin`, `ridge_margin_capped`, `elo_mov`, `record_then_ridge` | **done** | `ridge_wl`/`ridge_margin` are deliberately the same estimator on different observations. |
| Information-gain pairing: `info_gain`, `info_gain_censored`, `info_gain_bracketed` | **done** | D-optimal design on the play graph. Measured as no better than Swiss on accuracy; retained for its zero-rematch property. |
| TrueSkill / TrueSkill2 rating hook | **done** | TrueSkill for 1v1. Beats Elo on an unrated field (τ 0.754 vs 0.684). |
| Whole History Rating | **done** | `whole_history` — a rating per round tied by a random-walk prior, fitted by Newton iteration. The only ranking that can represent a player who tired or improved. |

## Web application

| Feature | State | Notes |
|---|---|---|
| Six-step wizard | **done** | Field, Skill, Pairing, Ranking, Run, Results. |
| Python editor with API reference and parameter controls | **done** | CodeMirror 6; reference generated from `src/lib/apiDocs.ts`. |
| Smoke test before a batch | **done** | 8-player, 3-round run surfaces contract errors in a second. |
| Ground-truth-leak warnings | **done** | Flags `.skill` in pairing/ranking code and the perfect-seeding trap. |
| Worker pool with progress and cancellation | **done** | Contiguous slices; pool size never changes results. |
| Per-config wheel loading | **done** | numpy (11 MB) only loads when the selected code needs it. |
| Results: metric cards, convergence, scatter, histogram, diagnostics, inspector | **done** | |
| CSV / JSON export | **done** | Per-replication rows, not summaries. |
| Compare view with paired tests | **done** | Paired t-test and Wilcoxon under common random numbers. |
| Function library browser | **done** | |
| Save / load **configurations** in the UI | **done** | The config bar above the wizard, backed by `/api/configs` with a localStorage fallback. |
| Run history browser (outside Compare) | **done** | Saved runs listed on the run step, restorable into the results view. |
| Parameter sweep UI (vary one knob across a range) | **done** | The `/sweep` page: vary a function, a parameter, the field, or the world model. Every cell shares the seed, so the sweep is one paired sample. |
| Batch runner (queue several configs under one seed) | **done** | The same sweep mechanism — it queues the cells and fills the matrix. |
| Shareable config URL | **done** | A base64url diff against the defaults, so an unchanged config is under 20 characters. |
| `/dev/selftest` in-browser test page | **rejected** | Superseded by `npm run py:test`, which runs the same assertions headless under Node. A browser page would need manual running, could not gate CI, and would duplicate the Node script. See [ADR-005](ADR.md). |

## Persistence

| Feature | State | Notes |
|---|---|---|
| Optional database (501 + localStorage fallback) | **done** | App is fully usable with no `DATABASE_URL`. |
| Functions API + client store | **done** | |
| Runs API + client store | **done** | Full per-replication payload stored. See [ADR-007](ADR.md). |
| Configs API | **done** | Routes complete and driven by the config bar. |
| IndexedDB run cache | **done** | Runs survive a page reload with no database. See [ADR-006](ADR.md). |
| Anonymous owner id | **done** | Swapping for real auth is a column rename. |
| Neon schema provisioned and verified | **done** | `npm run db:setup` then `npm run db:check`, which verifies the live columns against what the code reads rather than trusting that the DDL ran. |
| Migrate existing work into the database | **done** | Client-side by necessity — see [ADR-015](ADR.md). `planMigration` is pure and tested; the banner appears only when there is something to move and somewhere to move it. |
| Operator tooling (`db:check`, `db:purge-owner`) | **done** | Schema drift check and a scoped purge that refuses to run without an explicit owner id. |
| Real authentication | **deferred** | Deliberately postponed; a login wall in front of a tool that is fun to just open. |
| Function versioning surfaced in the UI | **done** | Version shown in the library; the localStorage path bumps it too, so behaviour matches with and without a database. |

## Tooling and delivery

| Feature | State | Notes |
|---|---|---|
| Engine self-test (`npm run py:test`) | **done** | 89 assertions: the literature reproduction, worker-slice determinism, the disabled-feature RNG guard, and every built-in end to end. |
| Benchmark scripts (`bench`, `bench:rounds`, `bench:collision`) | **done** | All take `--seed` and print paired intervals. |
| VS Code debug target | **done** | Compound with `stopAll`; closing the browser stops the server. See [ADR-010](ADR.md). |
| README / CLAUDE.md | **done** | |
| `npm run verify` | **done** | Types, lint, unit tests and the engine suite in one command. |
| Roadmap and ADR documents | **done** | This file and `ADR.md`. |
| `vercel.json` and deployment | **done** | Region pinned to `iad1` beside the Neon region, immutable caching for the vendored wheels, revalidation for the engine files, and `no-store` on the owner-scoped API. |
| Vendoring the Pyodide runtime into `public/` | **deferred** | Currently CDN, overridable via `NEXT_PUBLIC_PYODIDE_URL`. Only worth doing if CDN availability becomes a problem. |
| COOP/COEP headers + SharedArrayBuffer | **deferred** | Would allow true mid-run interruption instead of terminating and respawning workers. Not worth the header constraints yet. |
| Automated browser tests in the repo | **done** | `e2e/smoke.spec.ts`, 16 checks including a real simulation, the reload-persistence regression, and a phone-width check that forces a wide font so it does not depend on the host's system-ui. |
| CI | **done** | `.github/workflows/ci.yml` — three jobs: types/lint/unit/build, the Python engine suite, and the browser suite. Verified green on a real runner, and it earned its keep immediately by catching a responsive bug Windows fonts were hiding. |

## Known defects

Found by review on 2026-08-09. None are marked `done` until fixed **and** covered by a test.

| Defect | State | Notes |
|---|---|---|
| Saving a setup silently discarded it with no database | **done** | `saveConfig` had no localStorage fallback, unlike saved functions: the input cleared and the panel closed either way, so it looked like it had worked. Found while auditing what there was to migrate. |
| Header nav overflowed the viewport on a phone | **done** | Introduced by growing the nav from three links to five. Invisible locally because Windows' system-ui is narrower than a Linux runner's; found by CI on the first push. The row now wraps, and the test forces a wide font so the check no longer depends on the host. |
| Wilcoxon tie correction is wrong by 6× | **done** | Corrected to /12 and pinned by a test that brute-forces the exact null distribution rather than trusting a remembered formula. |
| Cancelling a run leaves a promise that never settles | **done** | In-flight rejecters are tracked and fired before the workers are terminated; `CancelledError` distinguishes it from a failure. |
| `usePool` has a single status subscriber | **done** | Replaced with a subscriber set. |
| Fairness metrics report meaningless zeros in score-based games | **done** | Colour and rating-gap metrics return null when the configuration cannot give them meaning. |
| No test coverage on the TypeScript layer | **done** | 108 assertions over stats, pool, builtins parsing, sweep expansion, config links and the outcome fit. |

## Code quality

| Item | State | Notes |
|---|---|---|
| JS unit tests (`node --test`, no new dependency) | **done** | Node’s own runner plus a resolver hook — see [ADR-011](ADR.md). |
| Error boundary | **done** | Per-panel `Boundary` plus a route-level `error.tsx`. |
| Visible keyboard focus | **done** | One `:focus-visible` treatment for everything, asserted end to end. |
| `prefers-reduced-motion` | **done** | Honoured globally. |
| Lazy-load step components | **done** | Home route first load went from 377 kB to 113 kB. |
| CodeMirror is dark in light mode | **done** | Theme follows the page through a CodeMirror compartment, so switching does not discard undo history. |
| Shared prelude for built-in snippets | **done** | `ridge_ratings` and `posterior_spread` injected by `load_hook`; removed 4 copies of the ridge solve and 3 of the precision matrix. |
| Warn when the round count forces rematches | **done** | The rounds field warns near, and hard-flags past, the round-robin limit. |

## Research findings (not features)

Recorded so the same ground is not re-covered.

| Investigation | Outcome |
|---|---|
| Does the battle-point margin carry usable signal? | **Yes** — +0.069 ± 0.004 τ over the same estimator fed win/loss. |
| Is information-gain pairing better than Swiss? | **No measurable difference** (+0.002 ± 0.004) once the estimator reads margins. Retained for zero rematches. |
| Does compressing blowouts (`ln(margin+1)`) help? | **No** — 0.8575 vs 0.8579. A 0–100 scoreboard already censors its own blowouts. |
| Does correcting information gain for score censoring help? | **No** — best single cell (0.8603) but within noise. Saturation is too rare at realistic margins. |
| Does strength of schedule fix the round-1 collision? | **No, it makes it worse** — +0.97 ± 0.41 places for the true #2. It rewards losing *late*, not playing the best. |
| Is the round-1 #1-vs-#2 collision the main problem? | **No** — costs +0.09 ± 0.42 places under the classic system, not detectable. The instrument's resolution is the problem. |
