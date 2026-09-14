# Bounded autonomous execution

## What is implemented

The Node controller invokes the installed Junie CLI in separate planning, implementation and review calls. Candidate changes are isolated under `automation\runs`; the controller reruns `bun install --frozen-lockfile`, `npm run lint`, `npm run build`, `npm run test`, and declared downstream checks. Successful agent exit is insufficient: valid stage artifacts, passing checks and an approving fresh-context review are required before conflict-checked, journaled promotion.

The independent invocation is another AI code review, **not an independent external security/legal assessment**. Agents and subprocesses have host privileges: a candidate directory is not an OS sandbox. Use a dedicated account/VM containing only authorized source and no production secrets for extended unattended operation. Do not expose the development app publicly.

## Verified environment and supported invocation

At initialization Node v24.19.0, npm 11.17.0 and Junie CLI 26.9.7 were verified; Bun and Python executables were found. A real noninteractive read-only Junie request returned `OCRDOCS_AGENT_PREFLIGHT_OK`. This verifies current cached authentication, not a three-day credit or authentication guarantee.

Use a PowerShell terminal rooted at the project, kept alive on the host:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\autonomy\start.ps1 -Hours 72
```

For a bounded first-stage smoke run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\autonomy\start.ps1 -Hours 72 -StartStage 2 -EndStage 2 -CommandSeconds 900
```

The start stage is used only for a new checkpoint. Existing checkpoints resume their next uncompleted stage; changing StartStage cannot skip failed work. EndStage limits this invocation without marking the remaining roadmap complete. Subsequent launches retain the original deadline, so restarting does not grant unlimited additional runtime.

## Automation lifetime

- The script can run for **up to** 72 elapsed hours while its foreground host remains alive, awake, connected and authenticated. Runtime includes retries and time spent between resumptions.
- The current IDE agent tool's background processes are session-scoped and terminate when that session ends. Launching one here is **not** a persistent 72-hour service.
- No scheduled task, system service, CI credential, new API credit allocation, infinite retry setting or unsupported token-budget flag is silently installed.
- A future dedicated unattended host should run this same foreground command as its supervised workload with an explicit shutdown deadline, protected credentials and retained checkpoints. This is a deployment requirement, not an already configured service.
- The runner does not measure or guarantee monetary spend. Time, attempts and pivots are bounded; provider billing and account limits remain provider-controlled.
- Work longer than one deadline is performed as **chained windows**, not as one process. `.junie\skills\true-e2e\scripts\true-e2e-loop.ps1` supervises the chain: it honours `automation\STOP` without removing it, launches this runner per window with captured evidence under `automation\true-e2e`, and stops the chain after three windows without any checkpoint change instead of hot-looping. A window past the persisted deadline requires an owner-placed `automation\RENEW` token, which the supervisor consumes once, moves to `automation\true-e2e\renewals` as evidence and records in STATE.md; nothing extends a deadline silently. Its `-ExtendPivots` switch resets an exhausted pivot budget at most once per invocation, also recorded. This is a supervised foreground workload, not an installed service.

## State and artifacts

- `PROJECT_CHARTER.md`: authoritative scope, assumptions, architecture and 55 gated stages.
- `RULES.md`: execution/review/state/next-plan/proceed protocol and safety boundaries.
- `STATE.md`: human-readable actual outcomes and next-stage pointers.
- `automation\checkpoint.json`: durable next stage, attempts, pivots, failures, completed stage IDs and original deadline.
- `automation\promotion.json`: pending/completed journal with before/after hashes and recoverable content; a pending verified promotion is reconciled before new work.
- `automation\runs\stage-N-pivot-P\candidate\.autonomy`: plan, implementation report, before/after change evidence and review.
- Per-command JSON evidence records actual exit status, termination reason and bounded/redacted output; known environment secrets and bearer values are redacted, but this is not a substitute for keeping secrets out of source and task output.

The candidate allowlist contains `src`, `server`, `scripts`, `tests`, `docs` and existing application configuration/root documentation; it excludes recovered documents, dependency directories, built assets and controller state. New source belongs in those source directories. The charter, rules, state, runner code/tests and mandatory package verification commands cannot be changed by a candidate. A needed controller/guidance change is a recorded gate, not something an implementation agent may silently perform.

## Recovery, stopping and conflicts

- Use Ctrl+C to stop an active foreground invocation and terminate its owned subprocess tree. Creating an empty `automation\STOP` file in the IDE requests a stop at the next command/stage boundary. Remove that file only when deliberately resuming.
- After the fourth consecutive failure of the same verification phase, the unaccepted candidate is abandoned and preserved as evidence; the next candidate starts from unchanged accepted source and requires a different plan. One pivot is the default; each approach also has an eight-attempt ceiling for alternating failures.
- Authentication failure, external blockers, deadline expiry, exhausted retry budget or source conflict produce a nonzero exit and durable blocked status. They do not trigger infinite retries or fake completion.
- Stale locks are reclaimed only if their recorded process is no longer present. An unreadable/live lock is not automatically overridden.
- Verified interrupted promotions can roll forward idempotently if each target still matches its expected before/after hash. A conflicting edit stops recovery without overwriting it.
- Do not edit accepted source while a stage is running. Conflict checks are conservative and deliberately reject concurrent changes rather than guessing who owns them.
- Preserved failed candidates consume disk space. Review evidence and remove only known obsolete runner-created artifacts after ensuring no active/pending run depends on them; no blanket cleanup is performed.

## Verification scope and limitations

`npm test` tests the controller using explicitly labelled fake-agent fixtures plus real child-process timeout, abort and exit-status checks. Those tests do not establish OCR accuracy, production security or application completion. Real-stage evidence is recorded separately. External security review, customer acceptance, legal approval, Drive access and permitted evaluation documents cannot be manufactured by this loop.