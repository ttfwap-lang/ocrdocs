# Autonomous operating rules

Read PROJECT_CHARTER.md, STATE.md and the current checkpoint before changing anything. The user authorizes implementation and documented engineering assumptions, not fabricated evidence or bypassing security, authentication, tool limits or external approvals.

## Continuous execution protocol

1. **Execute:** Implement the current stage's bounded plan and write tests with the change. For a defect, demonstrate the reproduction failing before the fix. Preserve useful code and existing user changes.
2. **Comprehensive review:** Review implementation, security, failure paths and downstream impact. Run the actual build, type checks, new tests and all relevant downstream suites. A separate review invocation must examine evidence; successful agent exit alone is not a stage pass.
3. **State update:** Record changes, commands/outcomes, errors, fixes, unresolved risks and checkpoint identity in persistent STATE.md and runner evidence. Never log secrets or original customer documents.
4. **Next-stage planning:** Read the current state and the next charter stage. Produce concrete ordered tasks, affected components, test/reproduction strategy, acceptance evidence and blockers before executing it.
5. **Auto-proceed:** Continue with the next ready stage without routine approval prompts while authorization, authentication, budgets, deadlines and verification permit. Complete the roadmap only when all gates actually pass; never manufacture completion to keep the loop moving.

## Limits, recovery and pivots

- Request up to 72 hours of runtime using a real installed agent and supported CLI flags. No infinite retries, fake maximum-token flags, unbounded spending claims, or bypass of provider/session limits.
- An ordinary verification failure is retried with recorded diagnosis. After the **fourth consecutive failure of the same check** (more than three), discard only the isolated unaccepted candidate, preserve evidence, and require a materially different implementation plan before a new attempt.
- Architectural pivots must be proportional to the defect: a timeout or missing credential is not evidence that the whole application needs a rewrite. Never weaken, skip or delete a failing check to obtain a pass.
- Bound attempts, pivots, subprocess time, output and total runtime. Repeated failure after the pivot budget is exhausted produces a durable blocked checkpoint, not a hot loop. Do not retry permanent authentication or authorization failures indefinitely.
- No blanket git reset/clean, deletion of user files, or automatic commits. This project was initially found without a git repository; do not assume git rollback is available.
- Work in an isolated candidate directory. Promote only reviewed, verified source changes after detecting conflicts with the original snapshot. Never treat a working directory as an OS security sandbox; the agent runs with host privileges unless separately isolated.
- Protect the runner, its control/evidence files and operating rules from self-modification during an unattended candidate. No candidate may rewrite its own acceptance gates or controller history to mark itself passed.
- Preserve a recoverable promotion journal; interruption must not turn a partially copied candidate into a completed stage.
- Make conservative engineering assumptions without asking routine questions, and document them. Missing credentials, lawful data permission, independent security/legal review and customer approval cannot be replaced with assumptions.
- Pause safely for a stop request, exhausted budgets, integrity/conflict failures, missing authentication, or external gates. A host shutdown/session end can interrupt automation; report it honestly and resume from verified checkpoints rather than pretending continuous operation.

## Verification and scope discipline

- All runtime claims require actual commands, outcomes and versioned evidence. Distinguish source inspection, fake-runner unit fixtures, real-agent execution and production verification.
- For new code cover happy paths, invalid input, edge cases, interruption and negative authorization. Keep randomness reproducible where supported.
- Preserve leading zeros, document/applicant association, uncertainty and reviewer corrections. Never equate heuristic confidence/checksums/completeness with accuracy/identity/recall.
- No secrets in arguments, source control, STATE.md, logs or generated reports. Do not send real documents to external models without approved data-sharing configuration.
- Do not install persistent services, schedule privileged tasks, deploy publicly or access sensitive Recovered_C contents merely to sustain the loop. Any unattended host must have explicit retention and shutdown controls.
- Only mark a stage complete when both required verification and its semantic acceptance evidence pass. An unresolved external gate keeps that stage blocked.
- Keep persistent state accurate even when work is incomplete. The planning target is not the current completion score.