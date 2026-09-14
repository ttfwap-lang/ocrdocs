# Integration gate checklist

Tick before reporting done. Anything unticked is either fixed or disclosed — never silently
dropped.

## Lane integration
- [ ] Every lane reported, or was stopped deliberately and that is recorded.
- [ ] Every escalation a lane returned ("I wanted to edit X but it is not mine") was applied or explicitly rejected with a reason.
- [ ] No lane wrote outside its scope. Verify against the real diff (`git status --short`, `git diff --stat`), not against the lane's own claim.
- [ ] No file was written by two lanes.
- [ ] No leftover scratch, temp or `.background_output_*` files from any lane.

## Contract integrity
- [ ] The frozen contract is implemented identically on both sides — no lane redefined a shared type locally.
- [ ] No duplicate implementation of the same thing in two lanes.
- [ ] Imports resolve across lane boundaries (this is what `npm run lint` proves).

## Evidence
- [ ] `npm run lint` — actually run, exit code recorded.
- [ ] `npm test` — actually run, exit code recorded.
- [ ] `npm run build` — actually run, exit code recorded (skip only for text-only changes, and say so).
- [ ] For a defect: the reproduction was observed **failing before** the fix and passing after.
- [ ] No check was weakened, skipped, disabled or deleted to reach green.
- [ ] Every acceptance fact in the Definition of Done maps to a real command output or an inspectable artifact.

## Review
- [ ] `adversarial-reviewer` ran on the final diff, not an intermediate state.
- [ ] Every `blocker` and `major` finding is fixed, or disclosed with a reason it is acceptable.
- [ ] The review said what it examined — not just "looks fine".

## Hygiene
- [ ] No secrets, credentials, tokens or customer document contents in code, tests, docs, logs or the final report.
- [ ] `Recovered_C/` untouched and still ignored.
- [ ] No commits made unless the user asked; no blanket `git reset`/`clean`; no user files deleted.

## Reporting
- [ ] `STATE.md` records changes, commands and outcomes, errors and fixes, and unresolved risks.
- [ ] `docs/ACCEPTANCE_REGISTER.md` updated if a stage gate actually moved.
- [ ] The user-facing report relays what the lanes did — their work is invisible to the user otherwise.
- [ ] Throughput accounting included: lanes, waves, barriers, steps per lane versus critical path, tier mix.
- [ ] Anything incomplete, blocked or assumed is stated plainly, not rounded up to success.
