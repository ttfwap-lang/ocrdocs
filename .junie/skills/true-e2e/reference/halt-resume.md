# Halt taxonomy and automatic resume actions

Every way this loop can stop, and what it does instead of stopping. If an observed condition
is not in this table, classify it into the nearest row and record the mapping in the ledger —
never invent a new reason to end the run.

Legend for **Class**: `auto` = resume without asking, immediately · `owner` = only a named
human action can clear it, so the sweep continues elsewhere and the blocker becomes a
one-line owner request · `terminal` = the run genuinely ends.

| # | Observed condition | Source | Class | Resume action |
|---|---|---|---|---|
| 1 | A stage finished and was promoted | `checkpoint.status=running`, `nextStage=N+1` | auto | Start stage N+1's S1 in the same step. This is the most commonly violated row. |
| 2 | `lint`/`build`/`test`/downstream check failed | `verify-*`, `downstream-*` | auto | Diagnose the actual output, fix, re-run S3 and S4. Attempt budget applies. |
| 3 | Independent review rejected the candidate | `review` | auto | Treat findings as work items (S5), re-verify, re-review with a fresh reviewer. |
| 4 | Same phase failed 4 times in a row, or 8 attempts | `failure.consecutive`, `attempt` | auto | Abandon the unaccepted candidate, preserve evidence, pivot with a materially different plan. |
| 5 | Pivot budget exhausted for this stage | `Pivot/retry budget exhausted` | auto → defer | Mark the stage `deferred` with its diagnosis; move to the next runnable stage; re-attempt next sweep. Extending the budget for a fresh approach is allowed once per window and must be recorded in `STATE.md` (`-ExtendPivots`). |
| 6 | Subprocess timeout, crash, spawn failure, transient tool error | per-command evidence | auto | Retry once with the same plan; if it repeats, treat as row 2 with the diagnosis attached. |
| 7 | Window deadline reached (≤72 h) | `Total runtime budget exhausted` | owner | Chain the next window. Past the persisted deadline a new window needs an `automation/RENEW` token from the owner; the supervisor consumes one token, records the new deadline, and continues. Never rewrite the deadline silently. |
| 8 | `automation/STOP` present | `Stop requested` | owner | Halt this driver, report it in one line, leave the file in place. Its removal is the owner's resume action. |
| 9 | Not authenticated / unauthorized / invalid token | permanent-failure classifier | owner | Do not loop on it. Report the exact one-line action (re-authenticate the CLI) and keep sweeping stages that do not need that credential. |
| 10 | Missing external input: credentials, permitted documents, legal/security review, customer acceptance, an independent operator | stage acceptance | owner | Defer only the stages that truly need it, with the named artifact that would unblock them, and carry on with everything else. Never assume the approval. |
| 11 | Source conflict, live lock, another runner owns the project | `assertProtected`, lock probe | owner | Never overwrite. Report the conflicting path or PID; if it is a live sibling driver, let it finish and resume after it. |
| 12 | Session or host ended, process killed, machine slept | absence of process | auto | Nothing is lost: reconcile from the checkpoint and journal and resume mid-stage. Report the interruption honestly; never call it continuous operation. |
| 13 | Context window filling up, transcript long, "this is taking a while" | you | auto | Not a halt condition at all. Compress into the ledger and continue. |
| 14 | Three consecutive sweeps with no state change and no new evidence | progress guard | terminal | Write the terminal external ledger: every remaining stage, its blocker, the exact unblocking action. Then report. |
| 15 | All stages in range promoted with evidence | `status=roadmap-complete` | terminal | Verify the register has no open engineering-side gate, then report completion with the commands that prove it. |

## Rules that apply to the whole table

- **Rows 1–6 and 12–13 never produce a message that ends the work.** They produce the next
  action, taken immediately.
- **`owner` rows never block the whole roadmap.** They block the stages that actually depend
  on them. Blocking 55 stages on one credential is the failure mode this skill exists to fix.
- **No hot loops.** A retry needs a recorded diagnosis; a repeat without a new diagnosis is
  the same attempt, and it counts against the budget instead of running again.
- **No condition may be cleared by editing a gate.** Deleting `STOP`, rewriting the deadline,
  weakening a check, forging a review approval or hand-editing `completed[]` are all
  falsification, not recovery.
- **Everything is written down where the next session will find it**: `automation/true-e2e/ledger.md`
  for the run, `STATE.md` for the project, `docs/ACCEPTANCE_REGISTER.md` for the promises.
