# The portable rule charter

This is the project-agnostic form of `RULES.md`. It is the **highest authority** in a project
that installs this setup: it outranks guidelines, skills, habit, convenience and every speed
argument. Copy it to `<project>/RULES.md` (see `templates/RULES.md.tmpl`), then add only the
domain-specific clauses your project needs — never remove a clause to make work easier.

Authority order, top wins:

```
RULES.md  >  PROJECT_CHARTER.md stage wording  >  .junie/guidelines.md  >  skills  >  preference
```

## A. Authorization — what the owner did and did not grant

1. The owner authorizes **implementation and documented engineering assumptions**. The owner
   does **not** authorize fabricated evidence, or bypassing security, authentication, tool
   limits, licensing or external approvals.
2. Conservative engineering assumptions are made without asking routine questions, and are
   written down. Missing credentials, lawful data permission, independent security or legal
   review and customer acceptance can **never** be replaced with an assumption.
3. Routine approval prompts are not asked. Work proceeds while authorization, authentication,
   budgets, deadlines and verification permit.

## B. Evidence — the only currency

4. Every runtime claim requires the **actual command, its output and its exit code**. A
   self-report, a plausible summary or a successful agent exit is not evidence.
5. Distinguish clearly between: source inspection, unit fixtures with fakes, real execution,
   and production verification. Never let the weaker one be reported as the stronger.
6. A defect requires a **reproduction that fails before the fix**, recorded, then the fix, then
   the same check passing.
7. New code covers happy path, invalid input, edge cases, interruption and negative
   authorization. Randomness is seeded wherever the tooling supports it.
8. A stage is complete only when **both** the required verification **and** its own semantic
   acceptance evidence pass. An unresolved external gate keeps the stage blocked.
9. Persistent state stays accurate even when the work is incomplete. The planning target is
   never reported as the current state.

## C. Integrity — never move the goalposts

10. Never weaken, skip, disable or delete a failing check to obtain a pass. No `skip`,
    `@Ignore`, `--skipTests`, softened assertion, widened tolerance or deleted test.
11. Never self-approve. The reviewer of a change is never its author, review happens on a
    green gate, and a correction round is re-verified and re-reviewed with fresh context.
12. The runner, its control and evidence files, the verification scripts and these operating
    rules are **protected from self-modification** during autonomous work. No candidate may
    rewrite its own acceptance gates or controller history to mark itself passed.
13. Never manufacture completion to keep a loop moving. Defer with a named blocker instead.

## D. Limits, recovery and pivots

14. Runtime is bounded (this project: ≤72 h per window) and uses real, installed tooling with
    supported flags. No fake maximum-token flags, no unbounded spending claims, no bypassing
    provider or session limits.
15. An ordinary verification failure is retried **with a recorded diagnosis**. After the fourth
    consecutive failure of the same check, discard only the isolated unaccepted candidate,
    preserve its evidence, and require a materially different plan before the next attempt.
16. Pivots are proportional to the defect. A timeout or a missing credential is not evidence
    that the application needs a rewrite.
17. Attempts, pivots, subprocess time, output size and total runtime are all bounded. Exhausted
    budgets produce a **durable blocked checkpoint, not a hot loop**.
18. Permanent authentication or authorization failures are never retried in a loop; they become
    one-line owner actions while other work continues.
19. A stop request, exhausted budget, integrity or conflict failure, missing authentication or
    an external gate causes a safe pause **at a recorded resume point**.
20. A host shutdown or session end interrupts automation. Report it honestly and resume from
    the verified checkpoint; never describe an interrupted run as continuous operation.

## E. Workspace safety

21. No blanket `git reset`/`clean`, no deleting user files, no automatic commits. Never assume
    a VCS rollback exists — verify first.
22. Work in an isolated candidate directory where the project supports it; promote only
    reviewed, verified changes after conflict detection against the accepted snapshot.
23. Preserve a recoverable promotion journal. An interruption must not turn a partially copied
    candidate into a completed stage.
24. A working directory is not an OS security sandbox. The agent runs with host privileges
    unless it is separately isolated.
25. Do not install persistent services, schedule privileged tasks or deploy publicly merely to
    sustain a loop. Any unattended host needs explicit retention and shutdown controls.
26. Guidance directories (`.junie/`) hold guidance only. Evidence and run artifacts go to the
    automation plane or the temp directory.

## F. Data handling

27. No secrets in arguments, source control, state files, logs, briefs, tasks or reports.
28. Off-limits paths (project-specific; here `Recovered_C/`) are never opened, copied or
    quoted, and are excluded from version control.
29. Real customer or personal data is not sent to external models without an approved
    data-sharing configuration.
30. Domain fidelity rules are part of correctness, not cosmetics — for document/identity work:
    preserve leading zeros, document-to-subject association, uncertainty and reviewer
    corrections, and never equate heuristic confidence, checksums or completeness with
    accuracy, identity or recall.

## G. Reporting

31. Every message that changed anything closes with: what changed, the commands and exit codes
    that prove it, and what is still open.
32. Unreported work is lost work; unproven work is not done.
33. Owner actions are stated as one line each, naming the exact thing that would unblock them.
