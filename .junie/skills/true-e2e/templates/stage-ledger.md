# True-E2E run ledger

Copy this file to `automation/true-e2e/ledger.md` at the start of a run and **append only**.
Rows are evidence: never rewrite or delete one, even when a later attempt supersedes it. Keep
secrets, credentials and customer document content out of it.

## Run header

- Run id: `<yyyyMMdd-HHmmss>`
- Range: stages `<N>..<M>` · driver: `runner` | `interactive`
- Window: `<hours>` h · deadline recorded in `automation/checkpoint.json`
- Definition of done: all stages in range promoted with evidence, or every remaining stage
  reduced to a named owner action.

## Stage rows

| UTC | Stage | Phase reached | Outcome | Gate evidence (exit codes) | Review | Next action |
|---|---|---|---|---|---|---|
| 2026-01-01T00:00:00Z | 2 | S4 review | `deferred` | lint 0, test 0, build 0 | rejected: 2 findings | pivot 1 with a different matrix source |
| | | | | | | |

Outcome vocabulary — use exactly these: `promoted`, `correcting`, `pivoted`, `deferred`,
`blocked-owner`, `interrupted`. Nothing else, and never `complete` for a stage that did not
pass `checklists/stage-exit.md`.

## Window rows

| UTC | Window | Stages promoted | Stages deferred | Halt class (`reference/halt-resume.md`) | Resume action taken |
|---|---|---|---|---|---|
| | | | | | |

## Owner actions (the only legitimate blockers)

One line each, with the exact thing that would unblock it. Empty is the goal.

- [ ] `<stage>` — `<named artifact, credential, approval or host>` — unblocks: `<what proceeds>`

## Progress guard

Track this honestly; it is what prevents a hot loop from masquerading as persistence.

| Sweep | Real state change observed? | What changed |
|---|---|---|
| 1 | yes/no | |

Three consecutive `no` rows means: write the terminal external ledger and report — do not
launch a fourth identical sweep.
