# Stage 1 acceptance register

Status: engineering contract executed under autonomous assumptions; actual product gates remain open until their listed evidence exists. User authorization to proceed is not external legal, security or customer acceptance. Release ownership belongs to the project owner; the agent implements and records evidence but cannot impersonate an independent approver.

| Promise / constraint | Evidence and gate | Current status |
| --- | --- | --- |
| Real uploaded and Drive-imported documents reach results | Browser/worker/database tests for real bytes plus authorized Drive integration; stages 16–20, 29–30, 38 | Unverified; Drive credentials required |
| Supported documents have honest extract/review/reject outcomes | Versioned format/layout/field matrix and fixture coverage; stage 2 | Next stage |
| Critical values retain applicant association and leading zeros | Matcher/contract/export regressions and reviewed labelled examples; stages 9–11, 27–28, 36 | Unverified |
| Jobs and originals survive interruption | Transaction/lease/fault/reconnection and integrity checks; stages 12–13, 19, 23–25 | Not implemented end to end |
| Human approval precedes downstream use | Versioned correction/approval/export tests; stages 27–28 | Required, not implemented |
| Users cannot access another user's unauthorized documents | Role/document endpoint and download denial tests plus external review; stages 14–15, 35, 45, 50 | Required, not verified |
| No simulated results or metrics in live mode | Missing-service/credential and fixture-separation tests; stages 4, 22, 32 | Existing simulations require correction |
| Provisional 95% required-field exact match and 99% critical precision targets | Versioned permitted held-out corpus, reviewed labels, per-field/layout denominators, recall/review burden and uncertainty; stages 8, 36–37, 42 | Targets only; no qualifying benchmark exists |
| Recovery within four hours from a backup no older than 24 hours | Clean-host restore, original/result integrity, access and export checks timed by another operator; stage 41 | Target only |
| Private local OCR and explicit external data-sharing boundary | Configuration/network/worker permissions and redaction tests; stages 14–18, 29, 34–35 | Policy selected; enforcement unverified |
| Retention/deletion and offboarding match customer obligations | Storage inventory, interrupted deletion, restore/deletion reconciliation and qualified policy review; stages 34, 45, 51 | External obligations not assumed |
| Dependencies and models permit intended use | License inventory/notices and qualified interpretation as necessary; stages 5, 18, 47 | Pending inventory/review |
| Reproducible build and reliable verification | Clean installation and positive/negative test pipeline; stages 5–7, 38–39 | Engineering evidence verified for stages 5–7; clean production evidence pending |
| Operational support is transferable | Operator-run install/rotate/restore/incident exercises; stage 53 | External operator not yet assigned |
| 99/100 readiness is justified | Weighted dossier plus mandatory security/integrity/recovery/license/workflow gates; stages 43, 54–55 | Not reached; no completion claim |
| Unattended execution remains bounded and truthful | Controller tests and actual invocation evidence; rules/automation documentation | Controller tests pass; sustained real run pending |

## Stage 1 review outcome

- Mission, architecture and all 55 stages are present in PROJECT_CHARTER.md.
- Explicitly selected assumptions permit implementation without routine clarification while preserving external gates.
- Every core promise above maps to an acceptance check or named type of external evidence; nothing is marked implemented solely because it is described here.
- Immediate next work is the field/format/workflow inventory and matrix in Stage 2; details are recorded in STATE.md.