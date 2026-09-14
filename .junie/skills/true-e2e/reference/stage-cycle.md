# The per-stage cycle (S0–S8)

One stage = one pass of S0–S8. The cycle is identical whether the driver is
`scripts/autonomy/runner.mjs` (unattended) or you in a session (interactive); only the
executor changes, never the gates. Phase names match the runner's own phase keys where they
exist, so `automation/checkpoint.json` failures map straight onto this table.

| Phase | Owner | Evidence that closes it | Runner phase key |
|---|---|---|---|
| S0 reconcile | you | checkpoint + journal read, locks resolved | — |
| S1 plan | `recon-scout` ×2–4, then you | `.autonomy/plan.json` with ≥3 steps, tests, acceptance, blockers | `plan` |
| S2 build | `impl-lane` ×N + `test-author` | `.autonomy/report.json`, changed files, failing-then-passing test | `execute` |
| S3 gate | `verification-runner` | `install`, `lint`, `build`, `test` + declared downstream checks, exit codes captured | `install`, `verify-*`, `downstream-*` |
| S4 review | `adversarial-reviewer` (fresh) | `.autonomy/review.json` with `approved:true` and an empty findings list | `review` |
| S5 correction | you + one repair lane | each finding closed by a change plus a re-run of S3 **and** S4 | back to `execute` |
| S6 stage exit | you | `checklists/stage-exit.md` fully ticked | — |
| S7 record + promote | you | journaled promotion, `STATE.md` + register updated | `promote` |
| S7.5 downstream refinement | you | `node scripts/stages/refine-downstream.mjs --stage N` executed, dossiers N+1..55 enriched, index regenerated, guard verified | — |
| S8 advance | you | next stage's S1 already started | — |

## S0 — Reconcile (never skip, even mid-session)

1. `automation/promotion.json` with `status:"pending"` is rolled forward **before** any new
   work; a partially copied candidate is not a completed stage.
2. `automation/runner.lock`: reclaim only if its recorded PID is gone. A live or unreadable
   lock means another driver owns the project — do not race it.
3. `automation/STOP` present: report and halt this driver. Never delete it.
4. Read the target stage's own text in `PROJECT_CHARTER.md`. The stage's acceptance wording,
   not your memory of it, is the gate.

## S1 — Plan

- Fan out `recon-scout`s over **disjoint paths** for anything you have not read; keep the
  most decision-critical read for yourself while they run.
- Freeze the contract before any lane writes (max-throughput W2): ownership table,
  interfaces, shared-file list. One writer per file, always.
- The plan names the tests that will prove the stage, including the negative and interruption
  cases, and lists external blockers explicitly. An invented blocker is as bad as a fake pass.
- On a pivot, the plan must say what is *materially different* from the approach that failed.

## S2 — Build

- Lanes write only inside owned paths; anything cross-cutting comes back to you as a finding.
- Defects need the reproduction to fail first. Record the failing output, then fix.
- Never touch the gate files (`RULES.md`, `PROJECT_CHARTER.md`, runner code/tests,
  `package.json` verification scripts, `automation/` control state).

## S3 — Gate (always before review)

```powershell
powershell -ExecutionPolicy Bypass -File .junie\skills\max-throughput\scripts\verify-gate.ps1
```

- Unattended runs additionally rerun `bun install --frozen-lockfile` and every downstream
  check the implementation report declared. A check the report forgot is not proof.
- A red gate returns to S2 with the failing output attached. It never advances to S4.

## S4 — Adversarial review

- Fresh context, `mode=EXPLORE`, strong tier, read-only. Input: the before/after change set,
  the plan, the stage's acceptance wording and **all previous findings for this stage**.
- The reviewer hunts for fake functionality, weakened tests, unproven external approvals,
  missing negative paths, data-handling and identity/leading-zero defects, and incomplete
  acceptance gates. Ranked findings with `file:line`.
- `approved:true` with a non-empty findings list is a rejection. Successful agent exit is not
  a pass.

## S5 — Correction rounds (bounded)

| Round | Action |
|---|---|
| 1–3 | Fix findings (trivia yourself, substance in one narrowly scoped repair lane), then re-run S3 **and** S4 with a fresh reviewer |
| 4th consecutive failure of the same phase | Abandon the unaccepted candidate, preserve its evidence, replan from unchanged accepted source with a materially different approach (pivot) |
| Pivot budget exhausted | Mark the stage `deferred` with the exact failing phase, diagnosis and what would change the outcome; continue the sweep with the next runnable stage |

Never close a finding by explanation alone, never re-use the reviewer that produced the
finding to bless its own fix, and never reduce an assertion to get past a round.

## S6 — Stage exit

Work `checklists/stage-exit.md` top to bottom. Anything unticked keeps the stage open — at
most `deferred`, never `complete`.

## S7 — Record and promote

- Promotion is conflict-checked and journaled: before/after hashes, recoverable content, then
  commit the checkpoint (`nextStage = N+1`, attempts and pivots reset).
- `STATE.md` records what actually changed, the commands and outcomes, errors, fixes,
  unresolved risks and the checkpoint identity. No secrets, no customer document content.
- Update the affected row of `docs/ACCEPTANCE_REGISTER.md`. A promise whose evidence is still
  missing stays unverified even if the stage passed.

## S7.5 — Downstream review and refinement

Immediately following stage promotion and before S8 advance:

1. Execute the automated downstream cascade:
   ```powershell
   node scripts/stages/refine-downstream.mjs --stage N
   ```
2. The cascade parses newly created models, REST routes, database tables, and TypeScript types from Stage N's candidate changes and promotion journal.
3. It sweeps all remaining downstream dossiers (`stage-(N+1)` through `stage-55`):
   - Updates `## Verified current state` with concrete `file:line` references for newly established components.
   - Enriches `## Work breakdown` with explicit downstream integration notes on tasks consuming Stage N deliverables.
   - Aligns `## Contracts to freeze` with newly established TypeScript interfaces and schemas.
   - Updates `## Dependencies` to mark Stage N as `[PROMOTED]`.
4. It re-computes front-matter metadata, verifies verbatim charter gate quote integrity, and regenerates `docs/stages/README.md`.
5. It runs the full machine guard verification across all 55 stages to guarantee zero invariant drift before S8 advance begins.

## S8 — Advance, immediately

Start S1 of stage N+1 in the same step in which S7 landed. No approval question, no "ready
when you are", no stopping to summarise. The ledger row is the summary, and it is written
while the next stage is already being planned.
