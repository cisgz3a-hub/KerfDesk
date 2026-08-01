# Audit, research, and plan index

Files in this directory are dated evidence. They describe the commit, branch,
research state, or proposal named in the document; they are not current product
truth unless a living specification or accepted ADR adopts them.

When citing an audit, include its date and evidence commit. Reproduce old findings
against current `main` before treating them as open. Preserve corrected or
superseded reports for provenance rather than rewriting their original evidence.

## Current planning and recent research

- [`2026-07-22-image-studio-v2-plan.md`](2026-07-22-image-studio-v2-plan.md) —
  current maintainer-selected V2 plan; implementation has not started in this
  document
- [`2026-07-21-image-editor-research-and-roadmap.md`](2026-07-21-image-editor-research-and-roadmap.md)
  — original Phase L research; ADR-242 was subsequently accepted and the PP-A to
  PP-F parity stack merged
- [`2026-07-21-image-editor-web-research.md`](2026-07-21-image-editor-web-research.md)
  — external web evidence supporting the Phase L proposal
- [`2026-07-21-image-studio-photoshop-parity-plan.md`](2026-07-21-image-studio-photoshop-parity-plan.md)
  — completed PP-A to PP-F parity plan
- [`2026-07-21-photoshop-ux-anatomy-research.md`](2026-07-21-photoshop-ux-anatomy-research.md)
  — Photoshop/Photopea workflow evidence
- [`2026-07-21-minipaint-source-study.md`](2026-07-21-minipaint-source-study.md)
  — MIT source study and license cautions

## Governing-policy evidence

- [`2026-07-18-guard-inventory-frame-first.md`](2026-07-18-guard-inventory-frame-first.md)
  — repository-wide disposition captured for ADR-228; use the later ADR chain and
  living documents for current policy wording

## Historical audit and remediation snapshots

### 2026-07-16

- [`2026-07-16-claim-verification.md`](2026-07-16-claim-verification.md)

### 2026-07-15

- [`2026-07-15-machine-setup-redesign-audit-plan.md`](2026-07-15-machine-setup-redesign-audit-plan.md)
- [`2026-07-15-machine-setup-redesign-post-audit.md`](2026-07-15-machine-setup-redesign-post-audit.md)

### 2026-07-14

- [`2026-07-14-laser-cam-sector-acceptance.md`](2026-07-14-laser-cam-sector-acceptance.md)
- [`2026-07-14-onboarding-device-setup-sector-acceptance.md`](2026-07-14-onboarding-device-setup-sector-acceptance.md)
- [`2026-07-14-output-correctness-safety-sector-acceptance.md`](2026-07-14-output-correctness-safety-sector-acceptance.md)

### 2026-07-13

- [`2026-07-13-2d-design-sector-acceptance.md`](2026-07-13-2d-design-sector-acceptance.md)
- [`2026-07-13-camera-feature-research-and-roadmap.md`](2026-07-13-camera-feature-research-and-roadmap.md)
- [`2026-07-13-cnc-adaptive-clearing-acceptance.md`](2026-07-13-cnc-adaptive-clearing-acceptance.md)
- [`2026-07-13-cnc-drag-tabs-acceptance.md`](2026-07-13-cnc-drag-tabs-acceptance.md)
- [`2026-07-13-cnc-helical-entry-acceptance.md`](2026-07-13-cnc-helical-entry-acceptance.md)
- [`2026-07-13-cnc-inlay-automation-acceptance.md`](2026-07-13-cnc-inlay-automation-acceptance.md)
- [`2026-07-13-cnc-rest-machining-acceptance.md`](2026-07-13-cnc-rest-machining-acceptance.md)
- [`2026-07-13-cnc-sector-rescore.md`](2026-07-13-cnc-sector-rescore.md)
- [`2026-07-13-engineering-security-testing-sector-acceptance.md`](2026-07-13-engineering-security-testing-sector-acceptance.md)
- [`2026-07-13-jog-frame-origin-probing-sector-acceptance.md`](2026-07-13-jog-frame-origin-probing-sector-acceptance.md)
- [`2026-07-13-layout-nesting-sector-acceptance.md`](2026-07-13-layout-nesting-sector-acceptance.md)
- [`2026-07-13-machine-profiles-connectivity-sector-acceptance.md`](2026-07-13-machine-profiles-connectivity-sector-acceptance.md)
- [`2026-07-13-performance-large-jobs-sector-acceptance.md`](2026-07-13-performance-large-jobs-sector-acceptance.md)
- [`2026-07-13-preview-simulation-sector-acceptance.md`](2026-07-13-preview-simulation-sector-acceptance.md)
- [`2026-07-13-rotary-camera-registration-sector-acceptance.md`](2026-07-13-rotary-camera-registration-sector-acceptance.md)
- [`2026-07-13-streaming-recovery-tool-change-sector-acceptance.md`](2026-07-13-streaming-recovery-tool-change-sector-acceptance.md)
- [`2026-07-13-text-production-sector-acceptance.md`](2026-07-13-text-production-sector-acceptance.md)
- [`2026-07-13-ux-accessibility-documentation-sector-acceptance.md`](2026-07-13-ux-accessibility-documentation-sector-acceptance.md)

### 2026-07-12

- [`2026-07-12-laser-9-acceptance-scorecard.md`](2026-07-12-laser-9-acceptance-scorecard.md)

### 2026-07-11

- [`2026-07-11-consolidated-audit-v2-fix-verification.md`](2026-07-11-consolidated-audit-v2-fix-verification.md)
- [`2026-07-11-fix-handoff-codex-reaudit.md`](2026-07-11-fix-handoff-codex-reaudit.md)
- [`2026-07-11-fix-handoff-for-codex.md`](2026-07-11-fix-handoff-for-codex.md)
- [`2026-07-11-full-sweep-audit-v3.md`](2026-07-11-full-sweep-audit-v3.md)
- [`2026-07-11-reaudit-fixes-handoff.md`](2026-07-11-reaudit-fixes-handoff.md)

### 2026-07-10

- [`2026-07-10-consolidated-audit-v2.md`](2026-07-10-consolidated-audit-v2.md)
- [`2026-07-10-full-sweep-audit.md`](2026-07-10-full-sweep-audit.md)
- [`2026-07-10-implementation-plan.md`](2026-07-10-implementation-plan.md)

## Qualification boundary

Software-complete, CI-passed, simulator-verified, browser-verified,
perceptually-verified, and hardware-qualified are different claims. The dated
acceptance reports retain the evidence available at their recorded commits; they
do not certify current hardware behavior.
