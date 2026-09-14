# Install-verification checklist

Tick every line before telling anyone the setup is installed. A file listing is not an
install; an exercised gate is. Anything unticked means the system is **off** in that project,
whatever the folder structure suggests.

## Files present

- [ ] `.junie/guidelines.md` exists and forces the skill boot at the **start of every
      message**, in every mode, with a one-line boot declaration.
- [ ] `RULES.md` exists, is declared as the highest authority, and includes the evidence,
      integrity, limits, workspace-safety and data-handling clauses.
- [ ] `PROJECT_CHARTER.md` exists with numbered stages, each carrying its own acceptance
      wording — not a wish list.
- [ ] `STATE.md` and `docs/ACCEPTANCE_REGISTER.md` exist, even if nearly empty.
- [ ] `.junie/skills/{autonomy-core,max-throughput,true-e2e}/SKILL.md` are all present and
      each has valid `name` + `description` front-matter.
- [ ] `.junie/agents/` contains the six role definitions used by the waves.
- [ ] `automation/` exists for control state and evidence, and nothing under `.junie/` is an
      artifact.
- [ ] Off-limits and evidence paths are in `.gitignore`; no secrets are tracked.

## The gate actually works

- [ ] Each project check runs from a clean checkout and the command names in the guidelines
      match the ones in the project's manifest — no invented script names.
- [ ] `verify-gate.ps1` (or the project's own gate) returns exit code `0` when everything
      passes.
- [ ] **Proved once, deliberately:** a temporary, intentional failure makes the gate return a
      non-zero exit code and print the failing output. The temporary failure is then reverted.
- [ ] Evidence logs land outside the repository (temp or the automation plane) and contain the
      per-check exit codes.

## The cycle is executable

- [ ] Stage 1 can be planned from the charter text alone, with named tests and named
      acceptance evidence.
- [ ] An independent reviewer role exists and can be invoked with fresh context; the driver
      knows author ≠ reviewer.
- [ ] The correction budget, pivot budget and window bound are written down with numbers.
- [ ] A resume path exists: if the session died right now, the next one could tell from disk
      which stage is in flight and what it had proven.
- [ ] If the project has no unattended runner, the interactive driver is named instead, and the
      gates are unchanged.

## The anti-systems have teeth

- [ ] Gate files are enumerated somewhere as read-only to stage work.
- [ ] The owner's stop signal is documented, and honouring it (never deleting it) is stated.
- [ ] Deadline renewal requires an owner token, and the token is consumed once and recorded.
- [ ] A deferral path exists: a blocked stage is deferred with a named unblocking action while
      other stages continue.
- [ ] The progress guard is defined with a number (e.g. three no-change sweeps ⇒ terminal
      ledger) so persistence cannot become spinning.
- [ ] The reporting contract is stated: what changed, the commands and exit codes, what is
      still open.

## Final

- [ ] Someone who has never seen this project could read `.junie/guidelines.md`, then
      `autonomy-core/SKILL.md`, and start stage 1 correctly without asking a question.
