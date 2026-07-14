# Guard remediation implementation plan

**Branch:** `codex/guard-safety-main`  
**Baseline:** `origin/main` at `e3c2b4b7a4e00cd1a576922f8d5046dda5217ffb`  
**Created:** 2026-07-15

## Goal

Make KerfDesk fail closed on real machine hazards without refusing valid laser or CNC work,
silently changing projects, hiding preparation failures, or using resource limits as a substitute
for scalable processing.

This is an implementation program, not one combined patch. Each slice must remain independently
reviewable and must prove its own behavior before the next dependent slice begins.

## Governing constraints

- Preserve machine-state, acknowledgement-ownership, Fire, spindle, Work-Z, tool-change,
  sanitization, and trust-boundary protections unless a replacement proof lands in the same slice.
- Write a failing regression test before each confirmed bug fix.
- Add or amend an ADR before changing a documented safety policy or pipeline architecture.
- Do not claim hardware safety from simulator or unit-test evidence. Real-machine checks remain
  explicit follow-up evidence.
- Keep UI error messages driven by the same result that blocks compile or Start.
- Run the focused bundle for each slice, then `release:check` only after the full integrated set is
  ready.

## Implementation order

### 1. Machine-safety and Start correctness

#### 1A. CNC relative-origin bounds

- Apply the laser preflight's relative motion-envelope rule to CNC output when no trusted
  work-to-machine offset exists.
- Keep absolute machine-bound checks when an offset is known.
- Prove centered and rear/right relative anchors can use negative work coordinates when their
  total span fits the bed.
- Prove an oversized relative span still fails closed.

#### 1B. No-go and Frame proof

- Remove `originVerifiedByFrame` as a blanket substitute for actual no-go path checking.
- Represent Frame proof honestly: it proves only the perimeter that was physically traced.
- When machine-space placement is unknown and an enabled internal no-go zone cannot be checked,
  keep Start blocked with an actionable explanation instead of accepting a perimeter trace as
  clearance for the interior.
- Add enclosed-zone regressions for laser and CNC and preserve direct perimeter-collision checks.

#### 1C. Pre-motion readiness ordering

- Move every Go-to-position readiness check before CNC safe-Z retraction or any other controller
  write.
- Prove non-Idle, active motion, active controller operation, Fire, and autofocus states produce
  zero writes.

#### 1D. CNC Frame clearance

- Refuse CNC Frame when current Work-Z/safe-clearance evidence is absent.
- Do not silently degrade to an XY-only perimeter.
- Preserve the existing safe-Z retract, perimeter, return, and Z-restore sequence when evidence is
  qualified.

### 2. Project integrity and persistence

#### 2A. Explicit normalization

- Separate additive schema migration from invalid machining-setting recovery.
- Load migrated defaults explicitly and report every repaired field.
- Reject unsafe or ambiguous machine/controller/CNC values instead of silently substituting laser
  or default machining semantics.

#### 2B. Validate before save

- Run the same structural and aggregate scene budgets before manual save and autosave.
- Prevent the editor from reporting a successful save for a project that cannot be reopened.
- Add mutation/import/array -> save -> reopen boundary tests, including LightBurn imports above the
  native object budget.

#### 2C. Atomic material migration

- Delete the legacy record only after the replacement write and readback succeed.
- Keep the legacy record intact on quota, parse, or storage errors.

### 3. Preparation diagnostics

- Replace preview's generic `EMPTY_JOB` fallback with a typed preparation-failure result.
- Render the exact blocking messages beside Preview and Start.
- Cover raster budget, vector complexity, registration, selection scope, variable evaluation,
  Print-and-Cut registration, and CNC preparation failures.
- Keep Save G-code and Start driven by the same preparation truth.

### 4. Raster and vector scalability

This phase requires an ADR amendment before implementation.

- Decode and retain an original-resolution burn source separately from the bounded interactive
  preview source.
- Stream or chunk raster rows through compile and emit so the full pixel grid and G-code string are
  not materialized together.
- Replace the fixed four-million-pixel refusal with measured memory/work budgets and cancellation.
- Replace the static vector/fill threshold with estimates derived from the selected strategy and
  actual compiled work; correct holes and crosshatch accounting.
- Add perceptual fixtures proving preview and burn-source fidelity independently.

### 5. Proxy and platform guards

- Use the existing position-epoch confirmation model for no-homing camera alignment and
  Print-and-Cut where physical-coordinate proof is sufficient.
- Make normal serial Disconnect retain permission; expose Forget Device as an explicit action.
- Apply raw-size limits before reading project, LightBurn, material, G-code, and STL inputs; keep
  parser-specific structural limits after the raw gate.
- Move checkout-name and canonical-origin restrictions out of general `release:check` and into
  deployment/publish commands. General builds must support forks, SSH origins, and arbitrary clone
  names.

### 6. Controller and CNC Start policy

These changes require ADR updates and capability-level simulator coverage.

- Permit acknowledged reduced feed and rapid overrides; keep unknown state and unsafe spindle
  conditions fail closed.
- Replace exact controller-name equality with tested transport/output/settings capability
  compatibility while continuing to reject cross-family unsafe combinations.
- Add owned `$#`/WCS readback and freshness evidence so qualified controller-established Work-Z can
  be recovered without removing the stock-top/tool identity gate.
- Keep CNC setup attestation bound to the emitted program and controller/setup epoch.

## Acceptance matrix

| Requirement | Authoritative proof |
|---|---|
| Relative-origin CNC jobs fit by span | Focused preflight tests plus real `emitGcode` regression |
| Internal no-go zones never inherit perimeter proof | Laser and CNC enclosed-zone tests |
| Rejected Go-to sends no bytes | Store-level fake-serial tests |
| CNC Frame never runs XY-only | Frame-line and action-level tests |
| Saved projects always reopen | Boundary round-trip tests using production serializer/deserializer |
| Migration cannot lose the legacy library | Throwing/quota storage tests |
| Every preparation failure is visible | Typed preview-state tests and rendered component tests |
| Burn resolution is independent from preview | Perceptual fixture plus emitted raster-row evidence |
| No-homing proxy gates use epoch proof | Camera and Print-and-Cut session tests |
| Disconnect and Forget are distinct | WebSerial adapter and command tests |
| Import limits precede allocation | Adapter tests that prove `text`/`arrayBuffer` was not called |
| Forks and SSH clones can build/test | Repo-guard command matrix; deploy still rejects non-canonical identity |
| Reduced overrides require acknowledgement | CNC Start readiness and dialog tests |
| Compatible controller variants can Start | Capability-matrix and simulator tests |
| Recovered Work-Z remains owned and tool-bound | Controller transcript plus Start/reconnect tests |

## Final verification

1. Focused tests for every slice.
2. Full `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm format:check`.
3. Web and Electron builds.
4. `pnpm release:check` after repo-identity separation is complete.
5. Browser smoke for visible preparation errors and the explicit Forget Device action.
6. Supervised hardware checklist for CNC Frame, relative origins, reduced overrides, WCS recovery,
   and no-go behavior. Software-only evidence must remain labeled as such until that pass occurs.

## Current status

All six implementation phases are integrated on `codex/guard-safety-main`. Focused regressions now
cover relative CNC bounds, no-go proof, zero-write readiness ordering, blocked unsafe CNC Frame,
validated persistence, atomic migration, exact preparation errors, independent burn/preview raster
resolution, row-chunk parity, measured raster/vector work, position-epoch camera gates, explicit
Forget Device, pre-allocation imports, deploy-only repo identity, acknowledged reduced overrides,
protocol-compatible controllers, and owned Work-Z recovery.

The guard commit is rebased onto current `origin/main`. The integrated tree passes all focused guard
bundles, the full `pnpm test` suite, typecheck, lint, Electron lint, formatting,
license/dependency/file-size/index-export policy checks, and both web and Electron production builds.
Those release stages were run individually because the aggregate command exceeded its execution
window while the long full test suite was still healthy.

A rendered Laser/CNC browser smoke confirmed the Start surfaces, current selected-output wording,
CNC recovery notice, and a clean browser console. The state-gated Start-blocker and Forget Device
surfaces are covered by their dedicated component tests; the smoke session had no physical serial
device or retained browser permission with which to enter those states.

Hardware-dependent acceptance remains explicitly open: software tests cannot prove cutter
clearance, stock-top truth, no-go placement, or controller-specific override behavior on a physical
machine.
