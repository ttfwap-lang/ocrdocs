---
stage: 1
slug: commercial-release-contract
title: Commercial release contract
status: complete
depends_on: []
blocks: [2, 3]
weight_area: tests-deployment-operations
external_gates: []
charter_lines: "45-46"
gate_quote_sha256: "c0629c0ebc2fbe2c511ab5344dbc0905b80dbc5a090f0438e2073836c49e7e80"
evidence_dir: automation/runs/stage-01
last_reconciled: 2026-09-14
---

# Stage 1 — Commercial release contract

## Charter gate (verbatim)

> Create the acceptance register, assumptions, supported deployment, prohibited uses, critical promises and release ownership. Gate: every promise has a check or explicitly unresolved external approval; assumptions are distinguished from verified facts.

## Verified current state

- `PROJECT_CHARTER.md:1-212`: Defines mission, 55 stages, score weights, architecture invariants, and verbatim acceptance gates.
- `RULES.md:1-34`: Invariant rules (evidence discipline, bounded correction, no fake completion, read-only gates).
- `docs/ACCEPTANCE_REGISTER.md:1-22`: Maps all 16 critical charter promises to verification commands or explicit external approvals.
- Documentation baseline: Complete for documentation contract; product implementation is deferred to subsequent execution stages.
- Verification evidence verified on disk at `automation/runs/stage-01/summary.json`.

## Scope

### In scope
- Foundation project charter establishing mission, completion criteria, scoring weights, and 55-stage roadmap.
- Acceptance register mapping all commercial promises to proving commands or external gates.
- Autonomous decisions, assumptions, and operating boundaries.

### Out of scope
- Application code implementation (handled in stages 2–28).
- Final commercial sign-off (requires owner verification at stage 55).

### Explicitly not promised
- 100% OCR accuracy guarantee or automated financial decisions.
- Production readiness based on documentation alone.

## Work breakdown

1. **Task 1: Project Charter Formulation**
   - Description: Establish scope, assumptions, architecture, scoring, and 55 numbered stages with verbatim exit gates.
   - Owned paths: `PROJECT_CHARTER.md`
   - Target acceptance fact: Fact 1

2. **Task 2: Rule Charter Definition**
   - Description: Establish strict non-negotiable rules for evidence, retries, and integrity.
   - Owned paths: `RULES.md`
   - Target acceptance fact: Fact 2

3. **Task 3: Commercial Acceptance Register**
   - Description: Detail 16 charter promises with evaluation commands and owners.
   - Owned paths: `docs/ACCEPTANCE_REGISTER.md`
   - Target acceptance fact: Fact 3

4. **Task 4: Baseline Verification Audit**
   - Description: Record Stage 1 completion evidence and reconciliation facts.
   - Owned paths: `automation/runs/stage-01/summary.json`
   - Target acceptance fact: Fact 4

## Contracts to freeze

```markdown
- Commercial Acceptance Register Contract: 16 rows covering data privacy, zero data loss, auditability, extraction recall, and rollback.
- Charter Invariant Contract: 55 numbered stages, byte-identical gate paragraphs, and score weights.
- Governance Rules: RULES.md defines strict evidence requirements (commands + exit codes) and bans self-approval.
```

## Fan-out plan

- **Archetype:** Archetype G (Documentation and Contract Alignment)
- **Lanes:** Serial execution for governance documents.
- **Shared files:** None.

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: 55-stage charter established | `PROJECT_CHARTER.md` | 55 stages with verbatim gates present | green | `automation/runs/stage-01/charter-audit.json` |
| Fact 2: Invariant rules charter defined | `RULES.md` | Rule charter active and referenced | green | `automation/runs/stage-01/rules-audit.json` |
| Fact 3: Acceptance register maps all promises | `docs/ACCEPTANCE_REGISTER.md` | 16 promise rows mapped to checks | green | `automation/runs/stage-01/acceptance-register-audit.json` |
| Fact 4: Stage 1 baseline verified | `automation/runs/stage-01/summary.json` | Exit 0, verification clean | green | `automation/runs/stage-01/summary.json` |

## Tests

### Negative test cases
- Missing acceptance criteria or ambiguous gates reject stage completion claims.
- Unsubstantiated completion claims fail anti-fabrication assertions.

### Boundary test cases
- Complete coverage of all 55 stages without gaps or duplicate numbers.
- Exactly 16 charter promise rows verified in the acceptance register.

### Interruption and recovery test cases
- Re-running audit and verification produces deterministic results.
- Storing evidence under `automation/runs/stage-01/` ensures idempotent verification.

### Security and isolation test cases
- Zero leaked credentials or personal data in charter documents.
- Clean separation between engineering assumptions and external legal/security approvals.

## Dependencies

### Upstream prerequisites
- None (initial roadmap stage).

### Downstream consumers
- Stage 2 (Document/workflow matrix): Builds upon field catalogue and input definitions.
- Stage 3 (Architecture and failure model): Formalizes system boundaries.

## External gates

- **External blocker:** None for Stage 1 documentation release.
- **Automated local test harness:** Static verification of charter parsing and register completeness.
- **Owner sign-off item:** Final commercial validation at Stage 55.

## Risks and known defects

- Risk 1: Documentation completeness mistaken for working code (`PROJECT_CHARTER.md:7`).
- Known defect 1: All 16 promises in `docs/ACCEPTANCE_REGISTER.md` currently unverified in software.

## Completion draft (S0–S8)

### S0 Reconcile
- Baseline audit performed; project charter and rules identified.

### S1 Plan
- Drafted governance and acceptance framework.

### S2 Build
- Authored `PROJECT_CHARTER.md`, `RULES.md`, and `docs/ACCEPTANCE_REGISTER.md`.

### S3 Gate
- Verification gate passed (`npm run lint`, `npm test`, `npm run build`).

### S4 Independent review
- Verified promises are distinguished from facts and external gates are retained.

### S5 Correction
- Reconciled claim count (16 rows) against live documentation.

### S6 Stage-exit checklist
- All Stage 1 exit criteria satisfied; artifacts committed to disk.

### S7 Record and promote
- Promoted Stage 1 as documentation-complete baseline; recorded in `STATE.md`.

### S8 Advance
- Advanced execution pointer to Stage 2.
