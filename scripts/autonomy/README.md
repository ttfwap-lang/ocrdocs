# Controller maintenance and verification

Use `node scripts\autonomy\preflight.mjs` for a real, billed, read-only authentication/process-transport probe. It is separate from the fake-agent unit tests. Prompts are written to files to avoid Windows batch quoting errors, and stdin is a closed pipe rather than the Windows null device.

## Stopped-controller update

If a controller defect is fixed while a candidate exists:

1. Request a boundary stop with `automation\STOP`, or stop the foreground invocation with Ctrl+C; wait for the runner to exit and its lock to be released.
2. Fix the controller, add a failing reproduction before the fix, and run `npm test`, `npm run lint`, and `npm run build` against accepted source.
3. Keep STOP present and run `node scripts\autonomy\refresh-controller.mjs`.
4. Maintenance refuses running checkpoints, pending promotions, modified candidate controls or changes to accepted non-controller source. It only refreshes `scripts\autonomy` and `tests\autonomy.test.mjs`, records the old/new controls, and preserves candidate application work, attempt counts and the original deadline.
5. Remove the STOP file deliberately, then resume with the normal launcher. The candidate is not marked passed by maintenance: implementation, checks and fresh review must run before promotion.

An interruption during controller maintenance can require inspection of the recorded controller-refresh evidence before proceeding; never replace a baseline blindly. This maintenance mechanism is not an agent permission to rewrite its own acceptance gates.

For a previously exhausted pivot budget, `start.ps1 -MaxPivots 2` (or at most 3) explicitly permits another fresh approach without resetting the overall deadline. Do not extend budgets to hide a permanent failure.

## Review findings and verified corrections

- The initial counter test failed when a new pivot inherited an exhausted retry count; corrected and regression-tested.
- A real filesystem reproduction rejected Windows cloud placeholders as links; corrected while preserving rejection of real junctions.
- Real CLI preflights reproduced multiline batch argument failure and null-device stdin failure; file prompts and closed-pipe input fixed the transport.
- A fresh read-only AI review identified UTF-8 splitting/output-byte limits and stale pending journal stage linkage; both reproduced in failing tests and were corrected.
- Deadline retention across restarts is intentional and tested, not permission to obtain fresh unlimited windows. Pending promotions are journaled roll-forward operations, not a claim of filesystem-wide atomicity. Do not deploy application source live while promotion/maintenance is in progress.
- Failed-spawn, timeout and abort handling are exercised using actual subprocesses; a review hypothesis is not itself proof of a failure.
- Per-attempt `.autonomy\failure.json` supplies actual bounded/redacted failed-check output or review findings to the next implementation attempt; controller logs retain the full bounded command record.

The broader host, permissions, operating procedures and known limitations are documented in `docs\AUTONOMY.md`.