---
name: max-throughput
description: "Orchestrate a parallel team of subagents - recon scouts, implementation lanes, test author, verification runner, adversarial reviewer, docs scribe - to complete end-to-end tasks in a fraction of the wall-clock time at equal quality. Use for max throughput, max effort, multi-agent, swarm, full-team, use-all-agents or parallel fan-out requests, whole-app E2E reviews and audits, multi-file features, refactors and migrations."
---

# Max Throughput Orchestration

You are the **orchestrator**. Your job is not to write the most code — it is to keep the
critical path as short as possible while every acceptance gate still really passes.

This skill is the **engine for one unit of work**. When the unit is a charter stage, or the
request is to finish the roadmap and not stop, the `true-e2e` skill is the outer loop that
owns sequencing, stopping and resuming — start there, and it will call this pipeline per
stage. `.junie/guidelines.md` requires both skills to be applied from the start of every
message.

Wall-clock time is the length of the **critical path**, not the total amount of work.
Two lanes that never touch the same file finish in the time of the slower one. Two lanes
that fight over one file finish slower than doing it yourself. Everything below exists to
maximise the first case and forbid the second.

## 0. Gate: is fan-out actually faster?

Run this gate first, in one step, and say which way you went.

Fan out when **two or more** are true:
- the work splits into scopes that can be named by **disjoint file paths**;
- there is real unknown territory to map (more than ~4 files you have not read);
- there is independent non-code work in parallel with code work (tests, docs, review, verification);
- the task spans more than one layer of this repo (`src/`, `server*`, `scripts/*.py`, `scripts/autonomy/`, `tests/`, `docs/`).

Stay serial when:
- the change is 1–3 steps or lives in a single file (briefing costs more than doing it);
- every candidate lane would edit the same file;
- the task is a known lookup, or one command and its output;
- the next action depends on the previous result at every point (a genuine chain).

> Serial is a legitimate outcome of this skill. Say so in one line and proceed — do not
> fan out to look busy.

## 1. The wave pipeline

```mermaid
graph LR
    W0[W0 Intake] --> W1[W1 Recon fan-out]
    W1 --> W2[W2 Contract freeze]
    W2 --> W3[W3 Build fan-out]
    W3 --> W4[W4 Verify + review]
    W4 --> W5[W5 Land]
```

Two barriers only for a normal task: one after W1, one after W3. A barrier is any
`wait_for_subagent`; each one serialises the whole team, so spend them deliberately.

### W0 — Intake (you alone, 1 step)

1. Restate the goal in one sentence.
2. Write the **Definition of Done** as checkable facts, not intentions
   ("`npm test` passes including a new test that fails on the old code", not "fix the bug").
3. Pick a plan from `reference/wave-plans.md` by task archetype.
4. Write the lane sketch: how many lanes, what each owns.

### W1 — Recon fan-out (parallel, read-only, cheap tier)

- 2–4 `recon-scout` agents, `mode=EXPLORE`, `modelTier=fast` (use `standard` for dense or
  unfamiliar territory). Each gets **disjoint paths**.
- Ask for conclusions and `file:line` evidence, never file dumps. A scout that returns a
  transcript has cost you context, which is the one resource you cannot parallelise.
- **Keep the single most decision-critical read for yourself** and do it while they run.
  Never sit at a barrier with idle hands.
- Then join once, and treat what comes back as settled — see §5.

### W2 — Contract freeze (you alone, 1–2 steps)

The highest-leverage step in the whole pipeline. Before any lane writes a byte, decide and
write down, in `templates/orchestration-plan.md` form:

- the **ownership table**: every file that will change, and the *single* lane that owns it;
- the **interfaces**: exact names, signatures, props, payload shapes and error contracts that
  cross a lane boundary;
- the **shared-file list**: files two lanes would both want. You edit those yourself, in W2,
  before fan-out. Never hand the same file to two lanes and hope.

Skipping W2 is how parallelism turns into merge conflicts and rework, which erases the
entire speed gain and then some.

### W3 — Build fan-out (parallel, CODE)

- One `impl-lane` per ownership block; plus `test-author` (owns `tests/`); plus `docs-scribe`
  (owns `STATE.md`, `docs/`, `README.md`) if documentation is in scope.
- Code-editing lanes run at **your own tier** — omit `modelTier` so they inherit it. Never
  send code edits to a cheaper model than your own.
- Every lane brief must carry the six fields from `templates/agent-brief.md`. No exceptions.
- Lanes may **read** anywhere and **write** only inside their owned paths. Anything
  cross-cutting is escalated back to you as a finding, never edited on the side.
- 3–5 concurrent lanes is the productive band. Beyond ~6 you get review debt and
  rate-limit thrash, and the barrier waits for the slowest one anyway.
- While they run, take the piece you deliberately kept: usually the shared/core file, the
  risk area, or drafting the verification command set.

### W4 — Verify and review (parallel, one wave)

Launch both at once — this is free parallelism people routinely waste:

- `verification-runner` (`mode=OTHER`, tier `fast`): runs the real gate and returns exit
  codes and failing output. Use `scripts/verify-gate.ps1`, which runs `lint`, `test` and
  `build` concurrently instead of end to end.
- `adversarial-reviewer` (`mode=EXPLORE`, tier `strong`): reads the diff and hunts for
  defects, missed edge cases and security or data-handling problems, ranked, with
  `file:line`. Its job is to break the change, not to praise it.

`checklists/integration-gate.md` is the list you must be able to tick before W5.

### W5 — Land (you alone)

- Triage reviewer findings: fix trivia yourself; spawn one narrowly scoped repair lane for
  anything substantial.
- Re-run only what could have changed. A full re-run of a green gate is wasted wall-clock.
- Update `STATE.md` and, if a stage gate moved, `docs/ACCEPTANCE_REGISTER.md`.
- Report: what changed, the evidence, and the throughput accounting from §7.
- **Do not stop here if a stage or a queue of work remains.** W5 is a state transition, not
  an ending: hand back to `true-e2e`, which starts the next stage in the same step. Only the
  two outcomes in `true-e2e` §0 — genuine completion, or a ledger of named owner actions —
  end a run.

## 2. Role catalogue

Six agents live in `.junie/agents/`; full briefs and return contracts in
`reference/role-catalog.md`.

| Agent | Mode | Tier | Steps | Writes | Returns |
|---|---|---|---|---|---|
| `recon-scout` | EXPLORE | fast / standard | 20–35 | nothing | conclusions + `file:line` evidence |
| `impl-lane` | CODE | inherit yours | 40–70 | owned paths only | files touched + how to verify |
| `test-author` | CODE | inherit yours | 30–50 | `tests/` only | test names + observed fail-then-pass |
| `verification-runner` | OTHER | fast | 15–25 | nothing | commands, exit codes, failing output |
| `adversarial-reviewer` | EXPLORE | strong | 30–45 | nothing | ranked findings, severity, `file:line` |
| `docs-scribe` | CODE | fast | 15–30 | docs paths only | sections updated |

Tier discipline: cheap for reading and running, your tier for writing code, strong for
finding defects. That mix is where "far less time at comparable quality" actually comes from.

### If a role id is not spawnable yet

Agent definitions are scanned when a session starts, so a role added during the current
session is not yet registered and a spawn fails with `Unknown agent: <role>`. Until the next
session, fall back to `general_purpose` with the same `mode` and `modelTier`, and paste that
role's hard rules and output format from `.junie/agents/<role>.md` into the brief. Identical
behaviour, one extra paragraph of briefing — never a reason to abandon the fan-out.

## 3. Non-negotiable rules

1. **One writer per file.** Always. No overlapping ownership, ever.
2. **Never delegate the whole task to one agent.** That is not orchestration, it is a relay
   with extra latency.
3. **Name the scope in paths.** "Related tests", "the affected code", "conventions" are not
   scopes; `src/components/**` and `server/routes/*.ts` are.
4. **Every spawn states its brief** (scope, deliverable, forbidden, output contract, budget,
   what you do meanwhile). Vague briefs come back as vague work.
5. **No nested fan-out.** Workers do not spawn workers. You are the only orchestrator.
6. **No questions from workers** — they cannot ask. Front-load every decision they need, or
   tell them which assumption to take and to report it.
7. **Bounded retries.** One retry with a tightened brief; one tier escalation; then take it
   over yourself. Matches the retry discipline in `RULES.md` — no hot loops.
8. **Relay the digest.** The user never sees a worker's screen. Unreported work is lost work.

## 4. Parallel-safe write patterns

Prefer, in this order:
1. **New files** — perfectly parallel, zero conflict surface.
2. **Disjoint existing files** — safe once the ownership table exists.
3. **Same file, different lanes** — forbidden. Either you do it, or the lanes are serialised
   behind you, or they work in isolated worktrees (`scripts/new-lane-worktree.ps1`,
   or `useWorktree=true` with `projectDir` when spawning) and you merge.

If a lane discovers it needs a file it does not own, it stops, reports the exact edit it
wanted, and moves on. You apply it. This one rule prevents nearly all lost work.

## 5. Delegation is a transfer of ownership

Once a scope is delegated, that scope is **not yours** until the result lands:
- do not search it, open it, or reason about it in parallel;
- if it is no longer needed, stop the agent — do not race it;
- when it reports, **do not re-derive or double-check its findings**. Re-verification
  destroys the saving you just bought. Verify *outcomes* through the gate in W4, not
  *findings* by redoing the reading.

## 6. This repo's gate

Real commands, from `package.json`:

```powershell
npm run lint    # tsc --noEmit
npm test        # node --test tests/*.test.mjs
npm run build   # vite build + esbuild bundle of server.ts
```

Run them **concurrently** with evidence capture:

```powershell
powershell -ExecutionPolicy Bypass -File .junie\skills\max-throughput\scripts\verify-gate.ps1
# A subset needs -Command: with -File, "lint,test" arrives as one string and "lint test"
# would bind "test" to -EvidenceDir.
powershell -ExecutionPolicy Bypass -Command "& .junie\skills\max-throughput\scripts\verify-gate.ps1 -Checks lint,test"
```

Inherited constraints — `RULES.md` wins over any speed argument:
- a defect needs a **reproduction that fails first**, then the fix;
- never weaken, skip, disable or delete a failing check to get a pass;
- no secrets in code, logs, briefs or reports; `Recovered_C/` is off limits and gitignored;
- no blanket `git reset`/`clean`, no deleting user files, no commits unless asked;
- claims require actual commands and outcomes — a worker's "should work" is not evidence.

## 7. Throughput accounting (report this)

Close with honest, measured numbers — never invented timings:

- lanes spawned, waves used, barriers paid;
- per-lane steps, and the sum (serial-equivalent) versus the longest lane (critical path);
- tier mix, i.e. what was done cheaply without touching code quality;
- gate result with exit codes, and what remains open.

## 8. Anti-patterns that cost more than they save

- Fanning out before W2, so lanes collide and half the work is thrown away.
- One giant agent with the whole task, then a second one to check it.
- Waiting at a barrier with nothing of your own in flight.
- Cheap tiers writing code, or strong tiers running `npm test`.
- Asking for "everything you find" and getting a transcript that floods your context.
- Re-reading what a scout already established.
- Eight lanes on a four-file change.
- A green report where the gate was never actually run.

## 9. Bundled material

- `reference/wave-plans.md` — ready wave plans per task archetype (E2E review, bug, feature, refactor, test backfill, upgrade, docs).
- `reference/role-catalog.md` — full brief template and return contract for each of the six agents.
- `templates/agent-brief.md` — the six-field brief to fill per spawn.
- `templates/orchestration-plan.md` — DoD, ownership table, interfaces, barriers.
- `checklists/preflight.md` — tick before fan-out.
- `checklists/integration-gate.md` — tick before landing.
- `scripts/verify-gate.ps1` — concurrent lint/test/build with captured evidence.
- `scripts/new-lane-worktree.ps1` — isolated git worktree per lane when two lanes must touch one file.
- `.junie/skills/true-e2e/` — the outer loop: per-stage S0–S8 cycle, halt/resume taxonomy,
  stage-exit checklist and the chained-window supervisor.
- `.junie/skills/autonomy-core/` — the portable package under both: boot contract, rule
  charter, per-stage verification, the fourteen anti-systems, and the installer that carries
  this setup to the next project.
