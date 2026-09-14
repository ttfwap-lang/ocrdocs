# Agent brief template

State these six fields internally before **every** spawn, and put fields 1–5 in the `task`
text you send. A spawn without a brief is the single most common cause of wasted lanes.

```text
1. EXCLUSIVE SCOPE
   Read:   <paths you may read, or "anywhere">
   Write:  <exact paths you own — or "nothing, this is read-only">
   Forbidden: <paths owned by other lanes; always include Recovered_C/, node_modules/, dist/>

2. OBJECTIVE (one sentence)
   <the single outcome this lane is responsible for>

3. CONTRACT (frozen in W2 — implement exactly, do not redesign)
   <names, signatures, payload shapes, error cases, types this lane must match>

4. DELIVERABLE / OUTPUT CONTRACT
   Return: <e.g. "max 8 findings: severity | file:line | impact | one-line fix">
   Do NOT return: file contents, transcripts, step-by-step narration.

5. RULES
   - You cannot ask questions. If a decision is missing, take the most conservative option
     and report it as an assumption.
   - Do not edit anything outside your Write paths. If you need such an edit, stop, report
     the exact change you wanted, and continue with the rest.
   - Do not weaken, skip or disable any check to get a pass.
   - No secrets, credentials or customer document contents in your output.
   - Claims need real command output. "Should work" is not evidence.

6. (orchestrator only, not sent) MY PARALLEL WORK + JOIN POINT
   While this runs I will: <the piece you kept for yourself>
   I will join before: <the first action that needs this result>
```

## Worked example — recon scout

```text
EXCLUSIVE SCOPE — read: server.ts, server/**. Write: nothing (read-only).
OBJECTIVE — establish how WebSocket sessions are created, authenticated and torn down.
DELIVERABLE — max 8 bullets: file:line | mechanism | risk. Name the exact function that
owns each phase. Explicitly say "not present" if authentication does not exist.
DO NOT return file contents or a narrative of your search.
RULES — read-only; no edits; no questions; report assumptions.
```

## Worked example — implementation lane

```text
EXCLUSIVE SCOPE — read: anywhere. Write: src/components/**, src/hooks/** ONLY.
  Forbidden: src/types/api.ts (I own it), server/**, tests/**, Recovered_C/**.
OBJECTIVE — render the document review queue against the frozen DocumentBatch contract.
CONTRACT — import { DocumentBatch, BatchError } from '../types/api'; never redefine them.
  Loading, empty, error and partial-OCR states must all be handled.
DELIVERABLE — files touched + one line each + the command proving it compiles.
RULES — if you need a change in src/types/api.ts, stop and report the exact diff you
  wanted; do not edit it. No questions. No check weakening.
```
