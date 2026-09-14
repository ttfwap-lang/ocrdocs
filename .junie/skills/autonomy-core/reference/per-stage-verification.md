# Per-stage verification, generalised

The cycle that turns one charter stage into an evidenced pass. It is identical whether the
driver is an unattended runner or an agent working interactively in a session — **only the
executor changes, never the gates**. This is the portable form of `true-e2e`'s S0–S8; that
skill adds the sweep, the halt taxonomy and the window chaining on top.

| Phase | Owner | Closes only with | Never |
|---|---|---|---|
| S0 reconcile | orchestrator | control state read from disk, pending journal rolled forward, locks resolved, stop signal honoured | working from memory of the last session |
| S1 plan | recon scouts, then orchestrator | ordered steps, named tests incl. negative/interruption cases, acceptance evidence list, explicit blockers | a plan whose acceptance is a feeling |
| S2 build | implementation lanes + test author | changed files, a reproduction that failed first, tests written with the change | one lane writing another lane's files |
| S3 gate | verification runner | every check's command, output and exit code; declared downstream checks re-run by the driver | trusting the author's "checks pass" |
| S4 review | adversarial reviewer, fresh context | approval with an empty findings list, naming files inspected and checks re-run | the author reviewing, or reviewing a red gate |
| S5 correction | orchestrator + one repair lane | each finding closed by a change, then S3 **and** S4 re-run with a fresh reviewer | closing a finding by argument |
| S6 stage exit | orchestrator | the stage-exit checklist fully ticked | ticking a line you did not check |
| S7 record + promote | orchestrator | journaled, conflict-checked promotion; state file and acceptance register updated | promoting over a concurrent edit |
| S8 advance | orchestrator | the next stage's S1 begun **in the same step** | stopping to summarise or to ask |

## Why the order is exactly this

- **S0 first, always.** Autonomous work spans sessions. Any phase that trusts memory instead
  of the control files will eventually double-promote or lose a stage.
- **S3 before S4.** Machines find mechanical failures faster and cheaper than reviewers do.
  Reviewing a red gate wastes the expensive tier on findings a command already had.
- **S4 after S3 and before S6.** The checklist is a *procedural* gate; the reviewer is a
  *semantic* one. Neither substitutes for the other: the checklist cannot notice fake
  functionality, and a reviewer cannot certify that a promotion was journaled.
- **S5 loops back to S3, not to S6.** A fix invalidates the gate it was not tested against.
- **S7 before S8, atomically.** The checkpoint must move in the same step in which the
  promotion lands, or an interruption leaves the stage half-complete.
- **S8 is not optional.** The end of a stage is a state transition. Treating it as a
  deliverable is the single most common failure of "autonomous" runs.

## Budgets (the numbers are the ceiling on thrash, not the goal)

| Budget | Default | On exhaustion |
|---|---|---|
| Correction rounds per stage | 3 | one materially different approach (pivot) |
| Consecutive failures of the same check | 4 | discard the unaccepted candidate, preserve evidence, replan |
| Pivots per stage | 1 per window (renewable once, recorded) | mark the stage `deferred` with a diagnosis |
| Sweeps with zero state change | 3 | write the terminal external ledger and report |
| Window runtime | ≤72 h | chain a new window; past the persisted deadline an owner renewal token is required |

Every retry needs a **new recorded diagnosis**. A repeat without one is the same attempt and
counts against the budget instead of running again — that is what keeps persistence from
becoming a hot loop.

## Evidence artifacts to keep per stage

1. The gate log per check, with its exit code (evidence directory, never the guidance folder).
2. The failing-then-passing output for every defect fixed.
3. The plan, the implementation report and the review verdict with its findings history.
4. The promotion journal entry: before/after hashes and the conflict check.
5. One append-only ledger row: stage, attempt, outcome, commands, blockers, next stage.
6. The acceptance-register row, updated to the *true* status — `unverified` stays `unverified`
   while its external evidence is missing.

## Three failure shapes and their correct handling

| Shape | Wrong response | Correct response |
|---|---|---|
| A check fails for a real defect | weaken the check, or retry unchanged | diagnose from the actual output, fix, re-gate, re-review |
| A stage needs something no agent can do (credential, legal sign-off, a human operator) | assume it, or stop the whole roadmap | defer *that* stage with the exact unblocking action, continue with the rest |
| The stage is genuinely hard and three rounds failed | declare partial success | pivot once with a materially different plan, then defer with the diagnosis and re-attempt next sweep |
