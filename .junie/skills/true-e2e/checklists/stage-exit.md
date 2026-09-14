# Stage-exit checklist

Tick every line before a stage is promoted or reported as complete. An unticked line means
the stage stays open — `deferred` at best. Copy the ticked list into the ledger row.

## Acceptance

- [ ] The stage's own wording in `PROJECT_CHARTER.md` was re-read this attempt, and every
      requirement it lists has a matching artifact or command outcome.
- [ ] Stage acceptance evidence exists as real files/output, listed by relative path, and each
      listed path actually exists in the candidate.
- [ ] The affected rows of `docs/ACCEPTANCE_REGISTER.md` are updated with the true status —
      `unverified` stays `unverified` if its external evidence is still missing.
- [ ] No external approval (credential, legal, security, customer, independent operator) is
      assumed, implied or described as obtained.

## Verification

- [ ] `npm run lint`, `npm test`, `npm run build` all exited `0` on the candidate, with the
      output captured.
- [ ] Every downstream/declared check from the implementation report was rerun by the driver,
      not merely claimed by the author.
- [ ] For a defect: the reproduction failed **before** the fix, and the same test passes now.
- [ ] For new code: happy path, invalid input, edge case, interruption and negative
      authorization are covered; randomness is seeded where supported.
- [ ] No test, assertion, timeout or check was weakened, skipped, disabled or deleted; no
      `@Ignore`/`skip`/`--skipTests` equivalent was introduced.

## Review

- [ ] An independent, fresh-context review ran **after** a green gate.
- [ ] The reviewer did not author any part of the change.
- [ ] The review returned `approved:true` with an empty findings list; every earlier finding
      for this stage was closed by a change, not by argument, and re-verified.
- [ ] Review evidence names the files inspected and the checks it re-ran.

## Integrity

- [ ] No gate file was modified by stage work: `RULES.md`, `PROJECT_CHARTER.md`,
      `scripts/autonomy/**`, its tests, `package.json` verification scripts,
      `automation/STOP`, `automation/checkpoint.json`, `automation/promotion.json`.
- [ ] Promotion is journaled with before/after hashes and conflict-checked against the
      accepted snapshot; no concurrent edit was overwritten.
- [ ] `STATE.md` records changes, commands and outcomes, errors, fixes, unresolved risks and
      the checkpoint identity — and no secrets or customer document content.
- [ ] Nothing was written into `.junie/`; evidence lives under `automation/`.

## Continuation

- [ ] Downstream refinement (`scripts/stages/refine-downstream.mjs --stage N`) executed
      for all remaining stages (N+1..55), index regenerated, and `tests/stages.test.mjs`
      verified before S8 advance.
- [ ] The ledger row for this stage is appended, including any deferred sibling stages.
- [ ] The next stage is identified and its S1 is starting in this same step — no approval
      question, no pause, no "next steps for you".
- [ ] If and only if a blocker is `owner`-class: it is written as one line naming the exact
      action that would unblock it, and the sweep continues with other stages.
