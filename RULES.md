# Operating rules

Engineering rules for the ocrdocs banking-OCR application and its gx10 GPU-worker pipeline.
This file is protected from self-modification by the project's own tooling.

## Continuous execution protocol

1. **Execute:** Implement the bounded plan for the change at hand and write a test with the change. For a defect, demonstrate the reproduction failing before the fix. Preserve useful existing code and user changes.
2. **Comprehensive review:** Review implementation, security, failure paths and downstream impact. Run the build, type checks (`tsc --noEmit`), the new test and all relevant downstream suites.
3. **State update:** Record changes, commands/outcomes, errors, fixes, unresolved risks in persistent STATE.md. Never log secrets or original customer documents.
4. **Next-step planning:** Read the current state and the next verifiable step. Produce concrete ordered tasks, affected components, test/reproduction strategy and blockers before executing.

## Limits, recovery and pivots

- Bound runtime, subprocess time, output and attempt counts. Boundless retries, fake maximum-token flags, unbounded spending claims, or bypass of provider/session limits are not allowed.
- A verification failure is retried with recorded diagnosis. After repeated consecutive failures of the same check, discard the isolated unaccepted candidate and require a materially different implementation plan before a new attempt.
- Architectural pivots must be proportional to the defect: a timeout or a missing credential is not an indication that the whole application needs a rewrite. Never weaken, skip or delete a failing check to obtain a pass.
- No blanket git reset/clean, deletion of user files, or automatic commits. This project may be found without a git repository; do not assume git rollback is available.
- Work in an isolated candidate directory. Promote only reviewed source changes after detecting conflicts with the original snapshot.
- Protect the controller, its control files and these operating rules from self-modification during unattended work, except when the project owner directly instructs changes. No candidate may rewrite its own acceptance gates or controller history to mark itself passed.
- Preserve a recoverable promotion journal; interruption must not turn a partially copied candidate into a completed promotion.
- Make conservative engineering assumptions without asking routine questions, and document them.
- Pause safely for a stop request, exhausted budgets, integrity/conflict failures, or missing authentication. A host shutdown or session end can interrupt automation; report it honestly and resume from checkpoints rather than pretending continuous operation.

## Verification and scope discipline

- All runtime claims require actual commands and outcomes. Distinguish source inspection, fake-runner unit fixtures, real-agent execution and production verification.
- For new code cover happy paths, invalid input, edge cases, interruption and negative authorization. Keep randomness reproducible where supported.
- Preserve leading zeros, document/applicant association, uncertainty and reviewer corrections. Never equate heuristic confidence/checksums/completeness with accuracy/identity/recall.
- No secrets in arguments, source control, STATE.md, logs or generated reports. Do not send real documents to external models without approved data-sharing configuration.
- Do not install persistent services, schedule privileged tasks, deploy publicly or access sensitive Recovered_C contents merely to sustain a loop. Any unattended host must have explicit retention and shutdown controls.
- Keep persistent state accurate even when work is incomplete. The target is verified progress, never a declared score.
