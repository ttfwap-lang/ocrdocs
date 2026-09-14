# Pre-fan-out checklist

Tick every line before the first `spawn_subagent` of a build wave. It costs one step and
routinely saves several lanes' worth of thrown-away work.

## Decision
- [ ] The fan-out gate in `SKILL.md` §0 was applied, and the verdict was stated in one line.
- [ ] The task archetype is chosen from `reference/wave-plans.md`.
- [ ] Lane count matches the number of genuinely disjoint scopes — not the number of agents available.

## Scope safety
- [ ] Every lane's write scope is written as **explicit paths**, not a description.
- [ ] No file appears in two lanes' write scopes. Checked by reading the table, not assumed.
- [ ] Shared/core files are on **my** list and already edited, or scheduled before fan-out.
- [ ] Forbidden paths are named in every brief, including `Recovered_C/`, `node_modules/`, `dist/`, `automation/`.
- [ ] New files are preferred over edits wherever the design allows it.

## Contract
- [ ] Types, signatures, payloads and error cases crossing lane boundaries are frozen and written out verbatim.
- [ ] Each lane knows which single acceptance fact it owns.
- [ ] No lane needs a decision I have not already made — they cannot ask.

## Briefs
- [ ] Every brief has all six fields from `templates/agent-brief.md`.
- [ ] Every brief caps its output (max findings / max bullets) and forbids file dumps.
- [ ] Tiers assigned: `fast` for reading and running, my own tier for code, `strong` for review.
- [ ] `maxSteps` sized per role, not left to default.
- [ ] All spawns for this wave go out in **one response**, with `waitForResult=false`.

## My own lane
- [ ] I have a concrete task in hand for the duration of the wave.
- [ ] I know the exact next action that forces the barrier, and I will not join earlier.
- [ ] I will not read or reason about any delegated scope while it is out.

## Recovery
- [ ] I can tell, per lane, which files are new and which are modified, so a failed lane is undoable.
- [ ] Long task: the ownership table is mirrored into `STATE.md` in case of interruption.
