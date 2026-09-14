# ocrdocs operating guidelines

These guidelines are loaded on every session and rank above habit, convenience and speed
arguments. `RULES.md` still wins over anything written here; this file only decides **how
work is organised**, never what counts as evidence.

## 0. Mandatory skill boot — start of every message, no exceptions

Before any analysis, answer, plan or tool call, in this order:

1. **Apply the skill set.** Treat `.junie/skills/*/SKILL.md` as active instructions for this
   message, not as optional reference material. If a skill body is not already in your
   context for this session, read it with `agent_skill_read_doc` **first** — before the
   first exploratory command.
2. **Re-read when it can have changed.** Re-read a skill body at the start of a message when
   any of these is true: it is the first message of the session; the skill folder was created
   or edited during this session; the task archetype changed (review → build → stage run);
   you are about to fan out, spawn an agent, or run a verification gate; or you are simply
   not certain you are holding the latest text. When in doubt, re-read — a stale skill is a
   silent defect.
3. **Declare it.** The first line of your internal step notes for every message is the boot
   line, exactly in this shape:

   `SKILLS: autonomy-core=<applied|not-applicable> | max-throughput=applied | true-e2e=<applied|not-applicable> | guidelines=v1`

   A message without a boot line is out of process; stop and restart the step.
4. **Select, then say why in one line.** Use §1. Choosing "neither" is legitimate, but it
   must be a stated decision, not an omission.
5. **Never paraphrase a skill you have not read.** Do not name, quote or claim to follow a
   skill whose body you did not load in this session.

This applies to every message in every mode, including chat-style answers, single-command
runs and one-line edits. Cheap tasks pay only steps 1, 3 and 4, which cost one line.

## 1. Skill selection matrix

| Situation | Skill | Notes |
|---|---|---|
| Installing, porting, auditing or explaining this setup, its rules, its per-stage verification or its anti-systems | `autonomy-core` | The package the other two stand on: boot contract, rule charter, S0–S8 verification, the fourteen anti-systems, installer |
| Multi-file feature, refactor, migration, audit, whole-app E2E review | `max-throughput` | Run its §0 fan-out gate; serial is an allowed outcome |
| "Finish the whole roadmap", "don't stop", multi-stage or unattended execution across hours/days/weeks | `true-e2e` | Drives `PROJECT_CHARTER.md` stages through the review/correction system; uses `max-throughput` inside each stage |
| Single-file trivial edit, lookup, one command | neither | State that, then act |
| Anything touching stage acceptance, promotion or `automation/` control state | `true-e2e` | Even for a single stage — its halt and evidence rules apply |

`true-e2e` is the outer loop; `max-throughput` is the inner engine; `autonomy-core` is the
portable ground both stand on. When both execution skills apply, `true-e2e` owns sequencing
and stopping decisions, `max-throughput` owns how one stage's work is split.

## 2. Non-negotiables that no skill may relax

- Evidence is command output with an exit code. "Should work", a worker's self-report and a
  successful agent exit are not stage passes (`RULES.md`, `docs/AUTONOMY.md`).
- A defect needs a reproduction that fails **before** the fix.
- Never weaken, skip, disable or delete a check to obtain a pass; never mark a stage complete
  while its acceptance evidence or an external gate is outstanding.
- Never self-approve: the reviewer of a change is never the author of that change, and a
  correction round is re-verified and re-reviewed with fresh context.
- No secrets in code, logs, briefs, tasks or reports. `Recovered_C/` is off limits.
- No blanket `git reset`/`clean`, no deleting user files, no commits unless asked.
- `.junie/` holds guidance only. No temporary artifacts, run logs or evidence there; use
  `automation/runs/` or `$env:TEMP`.
- Automation control files (`automation/STOP`, `automation/checkpoint.json`,
  `automation/promotion.json`), `RULES.md`, `PROJECT_CHARTER.md` and the runner's own code
  and tests are gates, not workspace. An implementation lane never edits them; the
  orchestrator changes them only under the rules in the `true-e2e` skill, and records it.

## 3. Repository gate

```powershell
npm run lint    # tsc --noEmit
npm test        # node --test tests/*.test.mjs
npm run build   # vite build + esbuild bundle of server.ts
```

Run them concurrently with captured evidence:

```powershell
powershell -ExecutionPolicy Bypass -File .junie\skills\max-throughput\scripts\verify-gate.ps1
```

## 4. Reporting

Every message that changed anything ends with: what changed, the commands and exit codes
that prove it, and what is still open. Unreported work is lost work; unproven work is not
done.
