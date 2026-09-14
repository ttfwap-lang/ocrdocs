# The anti-systems

Every safeguard in this setup exists because autonomous work fails in a specific, repeatable
way. Each entry below names the **failure mode** (what goes wrong when the safeguard is
absent), the **mechanism** (what actually prevents it), the **detection signal** (how you
notice a violation after the fact) and the **clearing evidence** (what proves it was honoured).

A safeguard that has no detection signal is a slogan. If you add one, give it all four fields.

---

## 1. Anti-fake-pass

- **Failure mode:** a stage is reported complete because the work *looks* finished — a summary
  says "all tests pass", but no test ran, or the check that would have failed was never run.
- **Mechanism:** a stage needs **two independent proofs**: the gate's exit codes, and the
  stage's own acceptance artifacts existing as files/output. Both, always.
- **Detection:** a completed stage whose evidence paths do not exist, or a report with no
  command/exit-code pair behind a runtime claim.
- **Clearing evidence:** per-check logs with exit code `0`, plus each acceptance artifact
  listed by relative path and verified to exist.

## 2. Anti-self-approval

- **Failure mode:** the author judges its own work, so its blind spots are also its reviewer's
  blind spots. A successful agent exit gets read as an approval.
- **Mechanism:** review is a separate invocation with **fresh context**, read-only, adversarial
  by mandate, after a green gate, receiving the before/after change set and every earlier
  finding for the stage. Author ≠ reviewer is a hard stage failure, not a preference.
- **Detection:** the reviewer identity equals the author identity; approval with a non-empty
  findings list; a finding closed by a reply instead of a change.
- **Clearing evidence:** a review verdict naming the files inspected and the checks it re-ran,
  approved with an empty findings list, produced by a reviewer that wrote nothing.

## 3. Anti-gate-tampering

- **Failure mode:** the cheapest way to pass a gate is to edit the gate. Rules get relaxed,
  the charter's acceptance wording gets softened, `completed[]` gets hand-edited.
- **Mechanism:** gate files are **read-only to stage work**: the rule charter, the stage
  charter, the runner's own code and tests, the verification scripts, and the automation
  control files. Only the orchestrator changes them, only as an owner-recorded decision.
- **Detection:** a diff that touches a gate file inside a stage's change set.
- **Clearing evidence:** the stage's change set contains no gate path; any gate change has its
  own recorded rationale outside stage work.

## 4. Anti-check-weakening

- **Failure mode:** the check stays but stops checking — a skip marker, a deleted assertion, a
  widened tolerance, a mocked-out failure path, a timeout raised until the flake hides.
- **Mechanism:** an explicit stage-exit line, plus the reviewer's standing mandate to hunt for
  exactly this, plus the rule that a failing check is diagnosed and never softened.
- **Detection:** tests removed or annotated in a diff; assertions becoming laxer; a suite whose
  test count fell while "coverage improved".
- **Clearing evidence:** test count and assertion strength unchanged or improved, and for each
  defect a reproduction that failed before the fix.

## 5. Anti-hot-loop

- **Failure mode:** the same failing command is retried dozens of times, burning budget and
  producing no information.
- **Mechanism:** bounded attempts, and the requirement that **every retry carries a new
  recorded diagnosis**. A repeat without one is the same attempt and consumes budget rather
  than running again.
- **Detection:** consecutive identical commands with identical output and no diagnosis between
  them.
- **Clearing evidence:** each attempt has a distinct diagnosis and a distinct change.

## 6. Anti-runaway-pivot

- **Failure mode:** a small, local failure (a timeout, a missing credential, one flaky test)
  triggers an architectural rewrite that destroys working code.
- **Mechanism:** pivots must be **proportional to the defect** and materially different from
  the approach that failed; the pivot budget is small and recorded; working code and existing
  user changes are preserved.
- **Detection:** a change set far larger than the failure it responds to; deleted working
  subsystems unrelated to the failing check.
- **Clearing evidence:** the pivot's plan names what is materially different and why the
  smaller fix was insufficient.

## 7. Anti-voluntary-stop

- **Failure mode:** the run ends itself — "shall I continue?", "next steps for you",
  stopping because a stage finished, a context filled, or the work got long.
- **Mechanism:** finishing a stage is a **state transition**, not a deliverable. Only two
  honest end states exist: everything in range genuinely complete, or a terminal ledger where
  every remaining item is blocked on a named action no agent can take.
- **Detection:** a message that ends with a question or a "ready when you are" while runnable
  work remained.
- **Clearing evidence:** the next stage's planning appears in the same step as the previous
  stage's promotion.

## 8. Anti-frozen-roadmap

- **Failure mode:** one unmet external dependency blocks the entire roadmap — the historical
  worst case here: a single missing credential froze all 55 stages.
- **Mechanism:** blockers are scoped to the stages that truly depend on them. The blocked
  stage is **deferred with the exact unblocking action**; the sweep continues with the next
  runnable stage and revisits deferred stages each sweep.
- **Detection:** zero progress across many stages attributed to one blocker.
- **Clearing evidence:** a ledger showing deferred stages alongside continued work elsewhere.

## 9. Anti-stall (the progress guard)

- **Failure mode:** the opposite of stopping too early — sweeping forever over stages that
  cannot move, so the run looks busy while nothing changes.
- **Mechanism:** a sweep must change something real: a promotion, a new failing-then-passing
  test, a new diagnosis or a changed blocker. **Three consecutive sweeps with no state change
  and no new evidence** means the remaining set is externally gated; write the terminal ledger.
- **Detection:** three sweeps, identical state, no new evidence files.
- **Clearing evidence:** each sweep names the real state change it produced.

## 10. Anti-amnesia

- **Failure mode:** a session end, a crash or a sleeping host loses the work, or worse, leaves
  a half-promoted candidate that the next session reads as complete.
- **Mechanism:** durable checkpoint, recoverable promotion journal rolled forward before any
  new work, and an **append-only** ledger. Reconciliation reads disk, never memory.
- **Detection:** a pending journal entry older than the last checkpoint; a ledger rewritten
  rather than appended.
- **Clearing evidence:** the next session resumes mid-stage from the checkpoint and says so.

## 11. Anti-collision

- **Failure mode:** two parallel lanes edit one file; one lane's work is silently overwritten
  and the speed gain becomes rework.
- **Mechanism:** **one writer per file**, an explicit ownership table frozen before any lane
  writes, shared files edited by the orchestrator before fan-out, and isolated worktrees when
  two writers are unavoidable. A lane that needs a file it does not own reports the edit and
  moves on.
- **Detection:** the same path in two lanes' change sets; a merge conflict inside one wave.
- **Clearing evidence:** the ownership table, and change sets that respect it.

## 12. Anti-secret-leak

- **Failure mode:** credentials, tokens or real customer data end up in logs, state files,
  briefs, reports or version control — permanently, and often in a place designed to be shared.
- **Mechanism:** no secrets in arguments, VCS, state, logs or reports; off-limits paths are
  never opened or quoted and are excluded from version control; real data is not sent to
  external models without an approved data-sharing configuration. Findings report the path,
  the line and the *kind* of value, never the value.
- **Detection:** a secret-shaped string in any tracked or logged artifact.
- **Clearing evidence:** reports that reference locations and kinds only.

## 13. Anti-assumed-approval

- **Failure mode:** the agent imagines the external world cooperated — a credential granted,
  legal or security review passed, a customer accepted, an operator present.
- **Mechanism:** engineering assumptions are allowed and must be documented; **external
  approvals can never be assumed**. They are one-line owner actions naming the exact artifact
  that would satisfy them, and the dependent stage stays blocked.
- **Detection:** an acceptance row marked verified whose evidence is an assumption; language
  like "presumably approved".
- **Clearing evidence:** the register keeps `unverified` until the real artifact exists.

## 14. Anti-silent-extension

- **Failure mode:** a bounded run quietly buys itself more time — the deadline is rewritten,
  a stop signal is deleted, limits are "worked around" to keep going.
- **Mechanism:** the persisted deadline is a gate. A window past it needs an owner-placed
  renewal token, consumed exactly once, moved into evidence and recorded. A stop signal is
  honoured absolutely: reported, never removed, never worked around — its removal is the
  owner's resume action.
- **Detection:** a changed deadline with no consumed token; a missing stop file with no owner
  action recorded.
- **Clearing evidence:** the consumed token in the evidence directory and the new deadline in
  the state file.

---

## Two meta-rules

- **The boot rule is what keeps all fourteen alive.** Safeguards that are only read when
  someone remembers them are not safeguards. The guidelines file forces the skill set to be
  applied — and re-read when it may have changed — at the **start of every message**, and to
  declare that in one line. A message without a boot line is out of process.
- **No safeguard may be cleared by weakening another.** Deleting a stop file, rewriting a
  deadline, forging an approval, hand-editing progress state or softening a check are all
  falsification, not recovery. The correct move is always: diagnose, or defer with a named
  blocker.
