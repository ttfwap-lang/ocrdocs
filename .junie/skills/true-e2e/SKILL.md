---
name: true-e2e
description: "Drive every PROJECT_CHARTER.md stage to a real, evidenced pass - sequentially, automatically, with no approval prompts and no voluntary stops - by running the existing review/correction system (max-throughput waves plus the autonomy runner's plan/execute/verify/independent-review/promote cycle) on each stage and auto-advancing to the next the moment a stage's gate actually passes. Use for /true-e2e, true e2e, finish the whole roadmap, do not stop, run for hours days or weeks, unattended multi-stage execution, and any work that touches stage acceptance or automation control state."
---

# True End-to-End Stage Completion

`/true-e2e` is the **outer loop**. `max-throughput` is the engine it drives. This skill adds
exactly one thing the engine does not have: a *termination and continuation contract*, so
that finishing one stage never means the run is over.

**The contract, in one sentence:** every stage of `PROJECT_CHARTER.md` is taken through the
existing review/correction system until its gate really passes, the next stage starts in the
same breath with no prompt and no pause, and the loop keeps going across restarts, sessions,
hours, days or weeks until either all 55 stages are genuinely complete or the only work left
is proven to require an action no agent can perform.

## 0. What "never stopping" means here — read before anything else

"Never stop" is a rule about **choice**, not about physics. It means:

- **Never stop voluntarily.** No "shall I continue?", no "next steps for you", no stopping
  because a stage finished, a session felt long, a context filled up, or the work got boring.
  Finishing stage N is not a deliverable; it is a state transition to stage N+1.
- **Never stop on a recoverable failure.** Every failure class in
  `reference/halt-resume.md` has a resume action. Take it and continue.
- **Never stop the *roadmap* for one stuck stage.** Defer that stage, sweep on to the next
  runnable one, and revisit the deferred set every sweep (§3). This is the single biggest
  fix to the previous behaviour, where one missing credential froze all 55 stages.
- **Never manufacture the end.** `RULES.md` forbids fake completion, and a fabricated pass
  would make the whole run worthless. So the loop does not lie to keep moving, and it does
  not stop to avoid lying: it *defers*, and it keeps working on everything else.

Therefore only two honest outcomes end a `/true-e2e` run:

1. **Complete** — every stage in range is promoted with real evidence, and
   `docs/ACCEPTANCE_REGISTER.md` has no remaining engineering-side gate.
2. **Terminal external ledger** — every remaining stage is blocked on a named action no
   agent can take (owner authorization, credentials, external review, a human operator,
   a machine that must stay powered on), each one written down with the exact thing that
   would unblock it. You keep working until nothing but that list remains.

Anything else — a failing check, a rejected review, a crashed subprocess, an expired window,
an exhausted pivot budget, a lost session — is a *resume point*, not an outcome.

## 1. Boot (you alone, one step)

1. Load `.junie/guidelines.md` and `max-throughput/SKILL.md`. Emit the boot line.
2. Read the live state, in this order, every time — never from memory:
   `automation/checkpoint.json`, `automation/promotion.json`, `STATE.md` tail,
   `docs/ACCEPTANCE_REGISTER.md`, and the target stage text in `PROJECT_CHARTER.md`.
3. Reconcile before working: a `pending` promotion journal is rolled forward first; a stale
   `automation/runner.lock` whose PID is gone is reclaimed; `automation/STOP` is reported,
   never silently deleted (§4).
4. Open or continue the run ledger at `automation/true-e2e/ledger.md`
   (`templates/stage-ledger.md`). One row per stage attempt, appended, never rewritten.
   Artifacts never go in `.junie/`.
5. State the range and the mode in one line: stages `N..M`, driver = `runner` (unattended)
   or `interactive` (you drive the same cycle by hand in this session).

## 2. The per-stage cycle — the review/correction system, then automatic advance

Full detail in `reference/stage-cycle.md`. Shape:

```
S0 reconcile ─► S1 plan ─► S2 build (max-throughput W1–W3) ─► S3 gate ─► S4 adversarial review
                                   ▲                                            │
                                   └──── S5 correction round (bounded) ◄────────┘
                                                                                │ approved
S6 stage-exit checklist ─► S7 record + promote ─► S7.5 refine downstream ─► S8 advance to N+1 ─┘
```

Rules that make it sound:

- **S3 before S4.** A reviewer must never be handed a red gate; that wastes the expensive
  tier on failures a command already found.
- **S4 is adversarial and fresh.** The reviewer never wrote the code, receives the
  before/after change set plus every prior finding for this stage, and must try to break it.
  Author-approves-own-work is an automatic stage failure.
- **S5 is bounded and re-verified.** A correction round re-runs S3 **and** S4 with a fresh
  reviewer; no finding is closed by argument. Budget: 3 correction rounds, then one
  materially different approach (pivot), then defer. This mirrors `RULES.md`'s
  four-consecutive-failure rule; it is a ceiling on *thrash*, not permission to give up —
  a deferred stage is re-attempted on the next sweep with a new plan.
- **S6 is the checklist, not a feeling** (`checklists/stage-exit.md`): stage acceptance
  evidence exists as files and command output; the register row is updated; no check was
  weakened; nothing external was assumed.
- **S8 has no approval gate.** The moment S7 lands, begin stage N+1 in the same step. Do not
  summarise-and-stop; summaries are appended to the ledger while the next stage is already
  planning.

## 3. The sweep — how the roadmap actually finishes

The loop is not a single pass; it is repeated sweeps over the remaining set.

1. Build the **runnable set**: stages in range that are neither completed nor blocked on an
   unmet external gate.
2. Take them in charter order. Run §2 on each. Auto-advance.
3. When a stage cannot pass after its S5 budget, mark it `deferred` with the precise reason
   and continue with the next runnable stage — never end the sweep.
4. When the runnable set empties, **sweep again** over deferred stages: environments change,
   dependencies from later stages land, and a second attempt starts from unchanged accepted
   source with a different plan.
5. **Progress guard (anti-hot-loop):** a sweep must change something real — a promotion, a
   new failing-then-passing test, a new diagnosis, a changed blocker. Three consecutive
   sweeps with zero state change and no new evidence means the remaining set is externally
   gated: write the terminal external ledger (§0 outcome 2) and report. Spinning is not
   persistence; it burns the budget that real work needs.

## 4. Continuity across windows, sessions and days

The runner is bounded by design: ≤72 h per deadline, `automation/STOP`, a pivot ceiling, and
session-scoped processes. Weeks of work are therefore **chained windows**, not one process.

- Use `scripts/true-e2e-loop.ps1` as the supervisor. It reconciles state, launches
  `scripts/autonomy/runner.mjs`, classifies the outcome from `automation/checkpoint.json`,
  appends ledger evidence, and starts the next window automatically.
- **Deadline renewal is explicit and owner-authorized.** The persisted deadline is a gate;
  nothing silently extends it. A new window past the deadline requires an
  `automation/RENEW` token file placed by the project owner; the supervisor consumes exactly
  one token per window, moves it to `automation/true-e2e/renewals/` as evidence, and records
  the new deadline in `STATE.md`. No token, no window — that is reported as a one-line owner
  action, and interactive work on non-runner stages continues meanwhile.
- **`automation/STOP` is honoured absolutely.** It is the owner's stop signal. Report it,
  never remove it, never work around it. Removing it is the owner's resume action.
- **A session ending is not a result.** The checkpoint, ledger and promotion journal are
  written so the next session resumes mid-stage. Report honestly that the window ended;
  never describe an interrupted run as continuous operation.
- **The host is a requirement, not a claim.** Days or weeks of unattended execution need a
  machine that stays awake, authenticated and running the foreground supervisor. If you
  cannot verify that, say so and keep driving the cycle interactively.

## 5. Non-negotiable invariants

1. No stage is marked complete without its own acceptance evidence *and* a green repository
   gate *and* an approving independent review.
2. No self-approval, ever, at any level: author ≠ reviewer, and the loop never reviews its
   own gates.
3. The loop never edits its own gates: `RULES.md`, `PROJECT_CHARTER.md`, the runner code and
   tests, `automation/STOP`, and the mandatory `package.json` verification scripts are
   read-only to stage work. Changing a gate is an owner-recorded decision.
4. Never weaken, skip, disable or delete a check to make a stage pass or to advance faster.
5. Bounded retries everywhere: attempts, correction rounds, pivots, sweeps, subprocess time,
   window length. Persistence comes from *resuming*, not from unbounded retrying.
6. Permanent authentication/authorization failures are not retried in a loop; they become
   one-line owner actions and the sweep continues elsewhere.
7. Every claim in a report carries the command and exit code that produced it.
8. Evidence goes to `automation/`; `.junie/` stays guidance-only.

## 6. Commands

```powershell
# Dry run: show the decision, the resume action and the planned windows. Launches nothing.
powershell -ExecutionPolicy Bypass -File .junie\skills\true-e2e\scripts\true-e2e-loop.ps1 -DryRun

# Chain windows until the roadmap completes or a terminal external ledger is reached.
powershell -ExecutionPolicy Bypass -File .junie\skills\true-e2e\scripts\true-e2e-loop.ps1 -Windows 0

# One bounded stage window with a fresh pivot budget, recorded in STATE.md.
powershell -ExecutionPolicy Bypass -File .junie\skills\true-e2e\scripts\true-e2e-loop.ps1 `
    -StartStage 2 -EndStage 2 -WindowHours 4 -ExtendPivots
```

Exit codes: `0` complete · `1` error · `2` repo root not found · `3` halted honouring an owner
gate (STOP, expired deadline without a renewal token, exhausted pivot budget, permanent auth
failure, a competing live runner) · `4` stalled (three windows with no state change) or the
window budget ran out before completion. Only `0` may ever be reported as "done"; `3` and `4`
mean the loop is paused at a recorded resume point, so say exactly what resumes it.

## 7. Reporting

Close every message — including mid-run ones — with: stages completed this window, stages
deferred and why, the commands and exit codes behind those claims, the next stage the loop
will start, and the owner actions (if any) that are the *only* remaining blockers. Never
report a stage as passed on the strength of an agent's self-report.

## 8. Bundled material

- `reference/stage-cycle.md` — S0–S8 in full, with per-phase evidence and correction budgets.
- `reference/halt-resume.md` — every halt class mapped to its automatic resume action.
- `checklists/stage-exit.md` — tick before any stage is promoted.
- `templates/stage-ledger.md` — the append-only run ledger.
- `scripts/true-e2e-loop.ps1` — resumable window supervisor with progress guard.
- `.junie/skills/max-throughput/` — the inner engine: waves, roles, ownership, verify gate.
- `.junie/skills/autonomy-core/` — the portable package: boot contract, rule charter, the
  generalised per-stage verification cycle, the fourteen anti-systems, document templates and
  the installer for a new project.
