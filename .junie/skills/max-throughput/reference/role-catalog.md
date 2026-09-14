# Role catalogue

The six team members are defined as custom subagents in `.junie/agents/`. Their definition
files carry the standing behaviour (read-only, no questions, return format); your brief
carries the task-specific part. Do not repeat what the definition already says — spend the
brief on scope, deliverable and forbidden actions.

## Spawn parameters that matter

| Parameter | Guidance |
|---|---|
| `agent` | the role id, e.g. `recon-scout`. Omit when continuing a run. |
| `mode` | `EXPLORE` for read-only roles, `CODE` for writers, `OTHER` for the runner. |
| `maxSteps` | from the table below. Too low forces a hand-off summary mid-task; too high invites wandering. |
| `modelTier` | omit for code writers so they inherit your tier; set `fast` for reading and running; `strong` for the reviewer. |
| `waitForResult` | `false` for a wave (spawn all, then one barrier). `true` only when you genuinely have nothing else to do. |
| `handle` | continue or steer an existing run instead of spawning a duplicate. |
| `projectDir` + `useWorktree` | only when two lanes must touch the same file and you accept a merge. |

Spawn a whole wave by emitting every `spawn_subagent` call in a **single response**. Calls
issued one per response are serial and defeat the purpose.

---

## `recon-scout` — read-only investigator

- Mode `EXPLORE`, tier `fast` (`standard` for dense or unfamiliar code), 20–35 steps.
- Writes nothing; cannot edit or run commands.
- Brief must contain: exact paths, the question in one sentence, max number of findings,
  and "conclusions with `file:line`, no file contents".
- Returns: ranked findings, each with `file:line`, impact, and a one-line fix suggestion;
  plus explicit "not found / not applicable" answers rather than silence.
- Failure mode to watch: transcript dumping. If it happens, re-brief with a hard cap
  ("max 10 bullets, max 15 words each") rather than asking again.

## `impl-lane` — implementation worker

- Mode `CODE`, inherit your tier (omit `modelTier`), 40–70 steps.
- Writes **only** inside the paths you list. Reads anywhere.
- Brief must contain: owned paths (exhaustive), the interface it must implement exactly as
  frozen in W2, forbidden paths, the acceptance fact it is responsible for, and the
  instruction to escalate rather than edit anything it does not own.
- Returns: files touched, what changed per file, the command that demonstrates it, and any
  escalation (the edit it wanted outside its scope, verbatim).
- Failure mode: scope creep into shared files. Prevented by listing forbidden paths
  explicitly, not by hoping.

## `test-author` — acceptance encoder

- Mode `CODE`, inherit your tier, 30–50 steps.
- Owns `tests/**` and nothing else. Never the same test file as another lane.
- Brief must contain: the behaviour to pin, the reproduction that must fail on current code,
  the conventions (`node --test`, `tests/*.test.mjs`), and the required edge cases —
  invalid input, boundaries, interruption, negative authorisation.
- Returns: test names, the exact command, and the observed **red then green** transitions.
- Non-negotiable: never weaken an assertion or skip a test to obtain a pass.

## `verification-runner` — evidence collector

- Mode `OTHER`, tier `fast`, 15–25 steps.
- Runs commands, never edits. Tools exclude `Write` and `Edit` by definition.
- Brief must contain: the exact commands (or
  `powershell -ExecutionPolicy Bypass -File .junie\skills\max-throughput\scripts\verify-gate.ps1`),
  and "do not fix anything — report".
- Returns: per check, the command, exit code, duration, and the first ~40 lines of failing
  output. Nothing else.
- Failure mode: helpfully fixing the failure. Its definition forbids edits; keep it that way
  so verification stays independent of implementation.

## `adversarial-reviewer` — defect hunter

- Mode `EXPLORE`, tier `strong`, 30–45 steps.
- Reads the diff and surrounding code; may run read-only inspection (`git diff`, `git log`).
- Brief must contain: what changed and where, the acceptance facts, and "try to break it —
  find the case where this is wrong". Ask for severity-ranked findings with `file:line`.
- Returns: findings ranked `blocker / major / minor`, each with a concrete failing scenario;
  and an explicit statement of what it checked and found sound.
- Rule: "looks fine" without a list of what was examined is not a review. A hypothesis is
  not proof — a blocker needs a concrete scenario, per `RULES.md`.

## `docs-scribe` — state and documentation

- Mode `CODE`, tier `fast`, 15–30 steps.
- Owns the document paths you assign, one document per scribe.
- Brief must contain: the file, the section, the facts to record (changes, commands,
  outcomes, unresolved risks), and "no secrets, no customer document contents".
- Returns: sections updated, in one or two lines.
- Failure mode: inventing progress. Give it the facts; forbid embellishment and any claim
  the gate did not produce.

---

## Retry and escalation

1. Result thin or off-target → continue the **same** run via `handle` with a tightened
   brief. Its context is already warm; a fresh spawn pays for that twice.
2. Still wrong → one escalation: raise `modelTier` or narrow the scope by half.
3. Still wrong → take it over yourself. Record it as a lane failure in the final report.

No third retry, no re-spawning the same brief in a loop. This mirrors the bounded-attempt
rule in `RULES.md`.
