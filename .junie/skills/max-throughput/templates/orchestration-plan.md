# Orchestration plan template

Fill this in W2, before any lane writes. Keep it in your working notes and, for long tasks,
mirror the ownership table into `STATE.md` so an interruption is recoverable.

```text
GOAL (one sentence)
  <what the user gets when this is done>

DEFINITION OF DONE (checkable facts only)
  [ ] <e.g. npm test passes, including tests/foo.test.mjs which fails on the old code>
  [ ] <e.g. npm run lint exits 0>
  [ ] <e.g. POST /api/batch returns 422 with BatchError on malformed payload>
  [ ] <e.g. STATE.md records the change, commands and unresolved risks>

ARCHETYPE + PLAN
  <A..H from reference/wave-plans.md, and where you deviate from it>

FAN-OUT DECISION
  <fan out / stay serial, and the one reason why>

OWNERSHIP TABLE (one writer per file — no exceptions)
  | Lane | Agent | Owns (write) | Acceptance fact | Tier | Steps |
  |------|-------|--------------|-----------------|------|-------|
  | L1   |       |              |                 |      |       |
  | L2   |       |              |                 |      |       |
  | L3   |       |              |                 |      |       |
  | ME   | —     | <shared/core files I edit myself> |    | —    | —     |

FROZEN CONTRACTS (lanes implement, never redesign)
  <type / signature / payload / error shape, written out in full>

SHARED FILES I EDIT IN W2 (never delegated)
  <package.json, shared types, config, anything two lanes would both want>

BARRIERS
  B1 after W1 recon — needed before: writing the ownership table
  B2 after W3 build — needed before: running the gate
  <any extra barrier must be justified in one line>

WHAT I DO WHILE LANES RUN
  W1: <the decision-critical read>
  W3: <the shared/core file or the risk area>

ROLLBACK / RECOVERY
  <how to undo per lane if a lane fails: which files, which are new vs modified>
  <no blanket git reset; per RULES.md rollback is not assumed available>

THROUGHPUT LOG (fill as you go, report at the end)
  lanes: <n>   waves: <n>   barriers: <n>
  steps per lane: <l1=..., l2=...>   sum: <...>   critical path: <max>
  tier mix: <fast=..., standard=..., inherited=..., strong=...>
  gate: <command -> exit code>
```
