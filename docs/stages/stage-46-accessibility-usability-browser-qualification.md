---
stage: 46
slug: accessibility-usability-browser-qualification
title: Accessibility/usability/browser qualification
status: not-started
depends_on: [26,43]
blocks: [52,55]
weight_area: interface-workflow
external_gates: []
charter_lines: "180-181"
gate_quote_sha256: "63c28385ec614f5d44497d350b999677e6d60cc85c29a992dcb0e01038100aaa"
evidence_dir: automation/runs/stage-46
last_reconciled: 2026-09-13
---

# Stage 46 — Accessibility/usability/browser qualification



## Charter gate (verbatim)

> Define browser/accessibility targets and test keyboard/focus/labels/announcements/contrast/zoom/previews/errors and long documents. Gate: primary journeys and representative assistive checks pass; scanner-only results do not imply certification.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:180-181`: Define browser/accessibility targets and test keyboard/focus/labels/announcements/contrast/zoom/previews/errors and long documents. Primary journeys and representative assistive checks pass.
- Accessibility audit unperformed: Frontend UI components currently lack comprehensive ARIA attributes, keyboard navigation trapping, and screen-reader announcements.
- Color contrast unmeasured: Need automated WCAG 2.1 AA audit verifying color contrast ratios (>= 4.5:1 for normal text).
- Keyboard navigation: Review workspace must be fully operable without a mouse.

## Scope

### In scope
- WCAG 2.1 AA compliance audit and remediation across all primary React UI views.
- Keyboard-only navigation support: tab order, focus visible indicators, and shortcuts in ReviewWorkspace.
- Screen reader support: ARIA live regions for streaming status events and descriptive field labels.
- Responsive layout and zoom: verify UI remains functional at 200% browser zoom.

### Out of scope
- WCAG AAA compliance (strict high-contrast specialized mode).
- Braille display hardware driver integration.

### Explicitly not promised
- Screen reader accessibility for raw scanned bitmap images inside the PDF viewer.

## Work breakdown

1. **Task 1: ARIA and Screen Reader Accessibility Enhancement**
   - Description: Add ARIA attributes, role tags, and live announcements to document and review components.
   - Owned paths: `src/components/ReviewWorkspace.tsx,src/components/DocumentListView.tsx`
   - Target acceptance fact: Fact 1: UI components equipped with ARIA roles and live regions

2. **Task 2: Keyboard Navigation and Focus Management**
   - Description: Implement logical tab ordering, visible focus rings, and keyboard shortcuts in review workspace.
   - Owned paths: `src/utils/keyboardNavigation.ts`
   - Target acceptance fact: Fact 2: Review workspace fully operable via keyboard navigation

3. **Task 3: WCAG 2.1 AA Automated Compliance Scanner**
   - Description: Implement automated axe-core / pa11y accessibility scanner checking all views.
   - Owned paths: `tests/accessibility/wcagScanner.mjs`
   - Target acceptance fact: Fact 3: Automated scanner confirms zero WCAG 2.1 AA violations

4. **Task 4: Accessibility and Browser Usability Test Suite**
   - Description: Author automated tests validating focus traps, zoom scaling, and color contrast ratios.
   - Owned paths: `tests/stage46Accessibility.test.mjs`
   - Target acceptance fact: Fact 4: Accessibility and usability test suite passes

## Contracts to freeze

```typescript
export interface AccessibilityAuditReport {
  standard: 'WCAG_2.1_AA';
  testedViews: string[];
  totalViolations: 0;
  contrastRatioPassRate: 1.0;
  keyboardNavigable: true;
  screenReaderAnnouncementsVerified: true;
  testedAt: string;
}
```

## Fan-out plan

- **Archetype:** Archetype E (Accessibility and Usability Qualification)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `src/components/**` | ARIA attributes and focus styling |
  | Lane 2 | impl-lane | CODE | `src/utils/keyboardNavigation.ts` | Keyboard shortcut manager |
  | Lane 3 | test-author | CODE | `tests/stage46Accessibility.test.mjs,tests/accessibility/**` | Accessibility test suite |
- **Shared files:** src/index.css

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: UI components equipped with ARIA roles and live regions | `node -e "assert(fs.existsSync('src/utils/keyboardNavigation.ts'))"` | Keyboard navigation helper exported and active | pending | `automation/runs/stage-46/aria-audit.json` |
| Fact 2: Review workspace fully operable via keyboard navigation | `node --test tests/stage46Accessibility.test.mjs` | All field review actions executable via Enter/Space/Arrows | pending | `automation/runs/stage-46/keyboard-audit.json` |
| Fact 3: Automated scanner confirms zero WCAG 2.1 AA violations | `node tests/accessibility/wcagScanner.mjs` | Zero accessibility violations reported across all rendered views | pending | `automation/runs/stage-46/scanner-audit.json` |
| Fact 4: Accessibility and usability test suite passes | `node --test tests/stage46Accessibility.test.mjs` | All accessibility test assertions exit 0 | pending | `automation/runs/stage-46/test-summary.json` |

## Tests

### Negative test cases
- Form input missing associated label element fails accessibility test.
- Interactive button missing visible focus outline in CSS fails keyboard check.

### Boundary test cases
- Text contrast ratio meets or exceeds 4.5:1 for standard text across all UI themes.
- UI layout scales cleanly without text clipping at 200% zoom.

### Interruption and recovery test cases
- Streaming progress updates announced to screen readers via aria-live="polite".
- Modal dialog opening traps focus cleanly inside modal.

### Security and isolation test cases
- Keyboard shortcuts do not collide with browser native security shortcuts.
- Accessible inputs prevent autocomplete caching of sensitive identifiers where required.

## Dependencies

### Upstream prerequisites
- Stage 26 (Real document/result interface): Document list and detail views.
- Stage 43 (Evidence-backed pilot gate): Pilot readiness baseline.

### Downstream consumers
- Stage 52 (Traceable controlled releases): Accessible UI assets bundled in release.
- Stage 55 (Final 99/100 release decision): Accessibility sign-off for release score.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite using axe-core / JSDOM verifying accessibility rules
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Third-party PDF viewer canvas rendering inaccessible to standard screen readers.
- Known defect 1: Current UI buttons lack aria-label attributes and focus-visible rings.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit UI components for missing ARIA tags and color contrast. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft accessibility remediation plan and keyboard navigation shortcuts. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `keyboardNavigation.ts`, update components, and write accessibility tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute accessibility test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits keyboard accessibility and screen reader announcements. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune color contrast ratios and focus ring visibility. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 47. (DRAFT — NOT EVIDENCED)

