# Wave plans by task archetype

Pick one in W0, adapt the lane count to the real file spread, then follow it. Every plan
assumes the rules in `SKILL.md`: disjoint path ownership, one writer per file, at most two
barriers, and the orchestrator keeping one piece of work in hand at all times.

## Layer map of this repo (use it to cut disjoint scopes)

| Layer | Paths |
|---|---|
| Frontend | `src/**`, `index.html`, `vite.config.ts` |
| Server / transport | `server.ts`, `server/**` |
| OCR engine | `scripts/ocr_spark_engine.py`, `scripts/quick_run.py` |
| Autonomy controller | `scripts/autonomy/**`, `tests/autonomy*.test.mjs` |
| Deploy / infra | `scripts/deploy.sh`, `scripts/dgx_*.sh`, `scripts/check_dgx_codebase.sh`, `scripts/github/*.ps1` |
| Fixtures / data | `src/data/**`, `metadata.json` |
| Governance / docs | `PROJECT_CHARTER.md`, `RULES.md`, `STATE.md`, `README.md`, `docs/**` |
| Scratch / debug | `patch*.cjs`, `patch.js`, `test-ws*.cjs` |
| Never touch | `Recovered_C/**`, `node_modules/**`, `dist/**`, `automation/**` |

---

## A. Whole-app E2E review or audit

Widest, cheapest, most valuable fan-out: nothing is written, so lanes cannot collide.

| Wave | Width | Roles |
|---|---|---|
| W1 | 4–6 | `recon-scout` per layer, `modelTier=fast` (`standard` for server + autonomy) |
| W2 | 1 | you: merge findings into one ranked register, de-duplicate overlaps |
| W3 | 2–4 | `impl-lane` per accepted fix block, only if repairs were requested |
| W4 | 2 | `verification-runner` + `adversarial-reviewer` |

Scout brief per layer: correctness defects, error/failure paths, security and data handling,
dead or duplicated code, and anything contradicting `PROJECT_CHARTER.md` or `RULES.md`.
Demand: max 10 findings, each with severity, `file:line`, one-line impact, one-line fix.
Forbid: file dumps, fixes, style nitpicking.

You do the cross-cutting read yourself while they run: `STATE.md` versus
`docs/ACCEPTANCE_REGISTER.md`, i.e. what the project claims is done.

DoD: one ranked register, severity-ordered, no duplicate findings, each with evidence.

## B. Bug or defect

| Wave | Width | Roles |
|---|---|---|
| W1 | 2 | scout A: the failing path; scout B: callers, similar sites, existing coverage |
| W2 | 1 | you: root cause + the exact reproduction that must fail first |
| W3 | 2 | `test-author` (failing reproduction in `tests/`) ‖ `impl-lane` (the fix) |
| W4 | 2 | `verification-runner` ‖ `adversarial-reviewer` on the diff |

Critical ordering: the test author must record the test failing **before** the fix lands.
If both lanes run at once, have the author capture the red run first and report the exact
command, then the runner re-runs it green in W4. Never let the fix lane edit `tests/`.

## C. Multi-file feature (UI + API)

| Wave | Width | Roles |
|---|---|---|
| W1 | 2–3 | scouts: current UI composition, server routes/transport, data shapes in `src/data/**` |
| W2 | 1 | you: freeze the contract — payload shape, error cases, prop/type names; write the shared type yourself |
| W3 | 3–4 | `impl-lane` frontend ‖ `impl-lane` server ‖ `test-author` ‖ `docs-scribe` |
| W4 | 2 | `verification-runner` ‖ `adversarial-reviewer` |

The shared type or interface file is **yours**, authored in W2 before fan-out. Lanes import
it; they never redefine it. This is what keeps two lanes from inventing two contracts.

## D. Refactor, rename or migration

| Wave | Width | Roles |
|---|---|---|
| W1 | 2 | scout A: full call-site inventory with `file:line`; scout B: behaviour currently pinned by tests |
| W2 | 1 | you: perform the definition change and any single-file hot spot |
| W3 | 2–4 | `impl-lane` per disjoint call-site cluster (by directory) |
| W4 | 2 | `verification-runner` ‖ `adversarial-reviewer` on semantics drift |

For a pure symbol rename, do **not** fan out — one rename operation beats any team.
Fan out only for mechanical edits that a rename cannot express.

## E. Test backfill

| Wave | Width | Roles |
|---|---|---|
| W1 | 1–2 | scouts: untested modules and existing test conventions in `tests/` |
| W2 | 1 | you: assign one **new test file per lane** — never two lanes in one test file |
| W3 | 2–4 | `test-author` per new file (parallel by construction: all new files) |
| W4 | 1 | `verification-runner` on `npm test` |

Cover happy path, invalid input, edge cases and interruption per `RULES.md`. Keep randomness
seeded. A test that passes on broken code is worse than no test — require each lane to state
what it observed fail.

## F. Dependency or infra upgrade

| Wave | Width | Roles |
|---|---|---|
| W1 | 2–3 | scouts: usage sites of the dependency, breaking-change notes, build/config coupling |
| W2 | 1 | you: the version bump in `package.json` (single shared file — never delegated) |
| W3 | 2–3 | `impl-lane` per affected area |
| W4 | 2 | `verification-runner` on the full gate ‖ `adversarial-reviewer` |

Full gate here, not a subset: an upgrade can break `build` while `lint` stays green.

## G. Docs and state sync

| Wave | Width | Roles |
|---|---|---|
| W1 | 1–2 | scouts: what actually changed (diff, commits) versus what the docs claim |
| W3 | 2–3 | `docs-scribe` per file — `STATE.md`, `docs/ACCEPTANCE_REGISTER.md`, `README.md` |
| W4 | 1 | you: read for contradictions between the three |

One scribe per document, always. No verification gate needed for text-only changes; do not
burn a build on prose.

## H. Security or data-exposure audit

| Wave | Width | Roles |
|---|---|---|
| W1 | 3–4 | scout: secrets/credentials in tracked files ‖ scout: PII in `src/data/**` and fixtures ‖ scout: git history and `.gitignore` coverage ‖ scout: deploy scripts and endpoints |
| W2 | 1 | you: verdict plus ordered, minimal remediation list |
| W3 | 1–3 | `impl-lane` per remediation block, only on explicit approval |

Read-only by default. Never print a secret's value into a report — report the path, the line
and the kind. History rewrites and credential rotation need explicit user authorisation.
