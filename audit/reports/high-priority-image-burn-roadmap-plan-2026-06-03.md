# High Priority Image-To-Burn Implementation Plan

> For agentic workers: required sub-skill for implementation is `superpowers:executing-plans` or `superpowers:subagent-driven-development`. This document is audit/planning only. Do not edit production code until the maintainer explicitly switches from planning to implementation.

**Goal:** Turn the current image import, trace, fill, raster, preview, export, and serial-start workflow into a safer, evidence-backed path where preview and output agree, stale exports are obvious, large images are rejected before freezing, and operator safety failures are surfaced immediately.

**Architecture:** Keep the core pure and small. Add narrow preflight/invariant modules for G-code and raster-budget checks, then reuse one prepared-output path across preview/save/start. Add UI safety notices at the React/Zustand boundary without hiding serial failures in logs. Treat burn-quality changes such as M4 fill as a hardware experiment with G-code evidence before code.

**Tech Stack:** TypeScript strict, React 18, Zustand, pure `src/core`, GRBL v1.1 G-code, Vitest, existing LaserForge module boundaries.

---

## Repo Anchor

- Working repo: `C:\Users\Asus\LaserForge-2.0`
- Remote: `https://github.com/cisgz3a-hub/LaserForge-2.0.git`
- Branch inspected: `wip/checkpoint-2026-06-03`
- HEAD inspected: `bf133f5 fix(fill): ADR-035 rapid across large fill gaps (stray-line fix)`
- Current production diff: none at plan time.
- Current untracked audit/planning files:
  - `audit/prompts/karpathy-image-to-burn-audit-prompt-2026-06-03.md`
  - `audit/reports/karpathy-image-to-burn-audit-2026-06-03.md`
  - `audit/reports/high-priority-image-burn-roadmap-plan-2026-06-03.md`
  - `audit/findings/karpathy-image-to-burn-findings-2026-06-03.json`
- Tracked research note used: `docs/research/burn-perfection-small-text.md`

AGENTS-listed files that are not present in this checkout:

- `.cursor/rules/laserforge.md`
- `docs/AUDIT.md`
- `docs/AGENT_HANDOFF.md`
- `docs/ROADMAP.md`
- `docs/ROADMAP-shipped-audit.md`

Available repo-local sources used instead:

- `CLAUDE.md`
- `PROJECT.md`
- `WORKFLOW.md`
- `DECISIONS.md`
- root `AUDIT.md`
- `LIGHTBURN-STUDY.md`
- current audit reports under `audit/`

## Research Baseline

Use these verified behavior anchors when implementing:

- LightBurn Fill mode: fill scans closed shapes with line interval / lines-per-inch controlling physical row spacing; overscan is laser-off runway used to keep the head at speed before burning.
- LightBurn Preview: operator preview should represent the path and timing assumptions of the job sent to the laser, including optimization and origin behavior.
- LightBurn Trace Image: tracing can lose fine details and small text; its controls are threshold/cutoff, ignore-small detail, smoothing, optimize, fade/show-points style verification.
- LightBurn Image mode: image engraving is raster, uses line interval/DPI density concepts, dithering/grayscale, overscan, and bidirectional scan behavior.
- GRBL laser mode: `G0` rapids force laser disabled in laser mode; `M4` dynamic power scales output during acceleration; `M3` constant power does not compensate for acceleration; `Ctrl-X` soft reset is immediate but software cannot send it after USB is already gone.
- Web Serial disconnect: the browser fires a disconnect event after the port becomes unavailable; it is not proof that the controller stopped executing already-buffered commands.
- PNG density metadata: PNG `pHYs` stores pixels-per-unit; when the unit is meters it can be converted to DPI.
- JPEG density metadata: JFIF APP0 stores X/Y density and unit; unit 1 means DPI and unit 2 means dots/cm.

Primary sources to cite in PRs and docs:

- LightBurn Preview: `https://docs.lightburnsoftware.com/latest/Reference/Preview/`
- LightBurn Fill Mode: `https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/FillMode/`
- LightBurn Trace Image: `https://docs.lightburnsoftware.com/1.7/Reference/TraceImage/`
- LightBurn Image Mode: `https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/`
- LightBurn Job Control: `https://docs.lightburnsoftware.com/latest/GetStarted/JobControl/`
- GRBL laser mode: `https://github.com/gnea/grbl/blob/master/doc/markdown/laser_mode.md`
- GRBL interface / streaming: `https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md`
- GRBL commands: `https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md`
- MDN Web Serial disconnect: `https://developer.mozilla.org/en-US/docs/Web/API/SerialPort/disconnect_event`
- PNG specification: `https://libpng.org/pub/png/spec/iso/index-object.html`

## Current Audit Verdict

What is already good:

- ADR-035 fixed the large fill-gap class in fresh output from current source. Independent artifact re-emit found zero `G1 S0` gaps over 5 mm and max fresh gap near 4.872 mm.
- Raster engraving groups emit `M5`, then `M4 S0`, use active-span clipping, skip all-white rows, alternate rows, and finish with `M5`.
- Start-job preparation already checks machine Idle/Alarm/autofocus/streamer state, project preflight, controller settings, `$30`, and `$32`.
- Missing/corrupt raster luma fails white/S0 rather than full-burn.

What remains unsafe or misleading:

- Old exported G-code can still be burned and still contains the original long `G1 S0` blank-feed gaps.
- Preflight does not inspect long `G1 S0` blank-feed moves, so stale or regressed output can pass.
- Safety write failures are stored/logged but UI actions discard the promise and do not render a persistent physical-stop warning.
- Mid-job cable yank is represented internally as `streamer.status === 'disconnected'`, but the operator warning is too weak.
- Raster compile still allocates full luma/S-value buffers and full G-code strings before budget/preflight can stop it.
- True raster Image mode can still emit long feed-rate `G1 S0` sweeps across interior white gaps inside a row. Fill has ADR-035 gap splitting; raster rows do not yet have the same split.
- Trace preview has a latest-token comment, but `runTrace` still sets ready/error after await without checking the token.
- Trace commit can misregister if the source raster is deleted or changed while the dialog is open; global edit shortcuts remain active behind the modal.
- Worker trace requests have no timeout/cancellation path, so a hung worker can leave preview or commit busy indefinitely.
- Import image uses default 96 DPI even when the source has density metadata.
- `readFileAsDataUrl` resolves an empty string if FileReader returns a non-string result; it should fail at the read boundary.
- Import luma is capped to 1024 px on the long edge and output resampling is nearest-neighbor. That is acceptable for trace preview bounds, but it is weak for high-quality small raster text unless budgeted native/target luma extraction is added later.
- Preview uses raw `compileJob`; Save/Start uses compile, optional job-origin, optimize, emit, preflight.
- Save G-code does not use the Start warning path.
- Import Image can collide with an existing non-image `#808080` layer.
- Small traced text is geometry-limited and fill-density-limited. Clean small lettering needs real vector/text or raster image mode, plus a separate M4-fill hardware experiment if density remains uneven.

---

## Implementation Order

Implement in this exact order. Each phase is reviewable and testable on its own.

## Implementation Status Addendum - 2026-06-03 23:25

Claude implemented the first three roadmap items, committed the raster
gap-splitting item, committed the prepared-output item, and started/continued
the P2-A trace/import hardening items:

| Roadmap item | Current status | Audit verdict |
|---|---|---|
| P0-A - Export provenance and long blank-feed preflight | Coded in commits `b04b698` and `eadc19b` | Mostly correct. Tests pass, but the current `EMITTER_REVISION` is stale after ADR-039 (`adr-036-m4-fill-v1` while raster gap splitting is now shipped). Bump the revision before release so saved G-code cleanly distinguishes pre/post ADR-039 output. |
| P0-B - Operator safety alerts | Coded in commits `e930ac3` and `38f3433` | Partial. Mid-job cable-yank and Pause/Resume/Stop write failures surface a persistent banner. Gaps remain: active-job Disconnect soft-reset failure is swallowed instead of rethrown, and Home/Frame/Jog/Origin/Autofocus write failures still have fire-and-forget UI paths without a persistent safety notice. |
| P1-A - Raster budget before allocation | Coded in commits `c2329d7` and `c87eaaf` | Partial. Normal Save/Start and live estimate now call pre-emit budget checks before raster compile. Bypass remains: custom-origin Start calls `compileJob` in `findOriginBoundsIssue` before the budget guard; Frame also calls `compileJob` directly. Large raster jobs can still freeze through those paths. |
| P1-B - Raster row blank-gap splitting | Committed in `c38c11a fix(raster): ADR-039 rapid across wide raster-row gaps` | Code direction is correct and tests pass. Hardware verification still pending: burn a two-island raster/image row and confirm the white gap travels dark with no faint line. |
| P1-C - Shared prepared-output pipeline | Committed in `ddb8e31 refactor(output): P1-C shared prepared-output (preview = burn)` | Promising and tests pass, but incomplete. Preview/default-origin Save/Start/estimate now share prepared output; custom-origin Start and Frame still bypass it by calling `compileJob` directly. |
| P2-A - Image import read boundary | Committed in `40761ca fix(import): P2-A readFileAsDataUrl fails at the read boundary` | Correct direction. Non-string `FileReader.result` now rejects instead of silently storing an empty image; regression test added. |
| P2-A - PNG/JPEG density metadata | Committed in `50e23f3 feat(import): P2-A honor PNG/JPEG density (DPI) on image import` | Correct direction. Parser tests cover PNG `pHYs`, JFIF DPI, JFIF dots/cm, and no-metadata fallback; Toolbar passes parsed density into `rasterImportGeometry`. Tests/lint/build pass. |
| P2-A - Stale trace-preview guard | Committed in `94f5e9c fix(trace): P2-A guard stale trace-preview results` | Correct direction. `runTrace` re-checks currency after async success/failure and tests cover stale ready/error suppression. |
| P2-A - Trace worker timeout | Committed in `c29c232 fix(trace): P2-A bound the trace worker with a 30s timeout` | Useful but incomplete. A single hung request is covered by a fake-timer test and verification passes, but timing out one request terminates the shared worker while sibling pending requests wait for their own timers instead of being rejected immediately. Add an overlapping-request test and settle the policy. |
| P2-A - Image-layer collision | Committed in `35fb422 fix(import): P2-A resolve raster image-layer color collisions` | Correct direction. Imported rasters no longer land on an existing non-image `#808080` layer; focused scene-mutation tests pass. |

Verification run after this audit:

```powershell
pnpm test --run src/io/gcode/prepare-output.test.ts src/io/gcode/emit-gcode.test.ts src/ui/laser/live-job-estimate.test.ts src/ui/workspace/draw-preview.parity.test.ts src/core/raster/emit-raster.test.ts src/core/raster/emit-raster.property.test.ts src/core/preflight/pre-emit.test.ts src/core/invariants/blank-feed.test.ts src/ui/state/laser-store.test.ts src/ui/laser/SafetyNoticeBanner.test.tsx src/ui/laser/LaserWindow.test.tsx
```

Result: 11 files / 70 tests passed.

Whole-repo verification on the current worktree:

- `pnpm run typecheck` passed.
- `pnpm test` passed: 132 files / 971 tests.
- `npm.cmd run lint` passed with the known boundaries-plugin legacy-selector warning.
- `npm.cmd run build` passed with known Vite dynamic-import chunking warnings.

Do not treat P0-B, P1-A, P1-C, or P2-A worker timeout as fully complete until
the bypasses and overlapping-request timeout gap above are fixed and covered by
regression tests.

1. **P0 - Export provenance and long blank-feed preflight.**
2. **P0 - Operator safety alerts for write failure and mid-job disconnect.**
3. **P1 - Raster budget before allocation.**
4. **P1 - Raster row blank-gap splitting.**
5. **P1 - Shared prepared-output pipeline for preview/save/start/frame/estimate.**
6. **P2 - Trace/import correctness: stale async, worker timeout, source revalidation, DPI metadata, image-layer collision, luma quality.**
7. **P2 - Small text burn-quality workflow and M4-fill hardware experiment.**

Do not bundle phases. After each phase:

1. Run the focused tests for that phase.
2. Run `pnpm run typecheck`.
3. Run `pnpm test --run` if the phase changes core output, preflight, or serial behavior.
4. Run `npm.cmd run lint`.
5. Regenerate and inspect G-code only when output changes.

---

## Phase P0-A: Export Provenance And Long Blank-Feed Preflight

**Why first:** This catches the exact "laser should have been off while moving to second part" class and prevents stale exports from looking current.

### Files

- Create: `src/core/invariants/blank-feed.ts`
- Create: `src/core/invariants/blank-feed.test.ts`
- Modify: `src/core/invariants/index.ts`
- Modify: `src/core/preflight/preflight.ts`
- Modify: `src/core/preflight/preflight.test.ts`
- Modify: `src/io/gcode/emit-gcode.ts`
- Modify: `src/io/gcode/emit-gcode.test.ts`
- Create: `src/io/gcode/gcode-metadata.ts`
- Create: `src/io/gcode/gcode-metadata.test.ts`
- Create: `src/ui/app/build-info.ts`
- Modify: `src/ui/app/file-actions.ts`
- Modify: `src/ui/laser/start-job-readiness.ts`
- Modify: `src/ui/app/file-actions.test.ts`
- Modify: `src/ui/laser/start-job-readiness.test.ts`

### Design

Add a separate invariant instead of broadening `findLaserOnTravelIssues`. `G0` laser-on travel and long `G1 S0` blank-feed are different failure modes:

- `G0` without S0/M5 is a hard safety invariant.
- `G1` effective S0 over a long blank distance is a material-marking and stale-output invariant.

The new invariant tracks modal X/Y/S state. It flags a `G1` move whose effective S is 0 and whose XY distance exceeds `LONG_BLANK_FEED_THRESHOLD_MM`.

Use `5 mm` as the blocking threshold initially because current ADR-035 splits gaps greater than 5 mm, and fresh output from the supplied `.lf2` should pass. Do not lower this threshold in code until the A/B burn threshold experiment is done.

### Test First

- [ ] Add `blank-feed.test.ts` with these tests:

```ts
import { describe, expect, it } from 'vitest';
import { findLongBlankFeedMoves } from './blank-feed';

describe('findLongBlankFeedMoves', () => {
  it('flags a long explicit G1 S0 move between known positions', () => {
    const gcode = [
      'G1 X0.000 Y0.000 F1500 S300',
      'G1 X20.000 Y0.000 S0',
    ].join('\n');

    const issues = findLongBlankFeedMoves(gcode, { thresholdMm: 5 });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.lineNumber).toBe(2);
    expect(issues[0]?.distanceMm).toBeCloseTo(20, 3);
  });

  it('uses sticky S0 when the G1 line omits S', () => {
    const gcode = [
      'G1 X0.000 Y0.000 S0',
      'G1 X0.000 Y8.000',
    ].join('\n');

    expect(findLongBlankFeedMoves(gcode, { thresholdMm: 5 })).toHaveLength(1);
  });

  it('does not flag short blank feed gaps at or below the threshold', () => {
    const gcode = [
      'G1 X0.000 Y0.000 S0',
      'G1 X5.000 Y0.000 S0',
    ].join('\n');

    expect(findLongBlankFeedMoves(gcode, { thresholdMm: 5 })).toEqual([]);
  });

  it('does not flag powered G1 moves', () => {
    const gcode = [
      'G1 X0.000 Y0.000 S300',
      'G1 X20.000 Y0.000 S300',
    ].join('\n');

    expect(findLongBlankFeedMoves(gcode, { thresholdMm: 5 })).toEqual([]);
  });

  it('does not flag G0 rapid moves because laser-on-travel owns that invariant', () => {
    const gcode = [
      'G1 X0.000 Y0.000 S0',
      'G0 X20.000 Y0.000 S0',
    ].join('\n');

    expect(findLongBlankFeedMoves(gcode, { thresholdMm: 5 })).toEqual([]);
  });
});
```

- [ ] Run:

```powershell
pnpm test --run src/core/invariants/blank-feed.test.ts
```

Expected: fail because the module does not exist.

### Implement

- [ ] Implement `findLongBlankFeedMoves(gcode, options)`.
- [ ] Export it from `src/core/invariants/index.ts`.
- [ ] Add `PreflightCode` value `long-blank-feed`.
- [ ] In `runPreflight`, append issues after `appendLaserOnTravelIssues`.
- [ ] Message shape:

```text
Line N: blank G1 feed move D.DDD mm exceeds 5.000 mm. Regenerate output or lower the fill blank-feed threshold after hardware verification.
```

- [ ] Add `runPreflight` test that passes stale-like G-code and expects `long-blank-feed`.
- [ ] Add `runPreflight` test that fresh ADR-035-style short gap does not fail.

### Export Metadata

Add optional metadata so core stays pure:

```ts
export type GcodeMetadata = {
  readonly appName: 'LaserForge 2.0';
  readonly appVersion: string;
  readonly gitSha: string;
  readonly buildTimeUtc: string;
  readonly emitterRevision: 'adr-035-fill-gap-split-v1';
};
```

Implementation contract:

- `emitGcode(project, { metadata })` prepends comment lines only when metadata is passed.
- Tests that need deterministic G-code can omit metadata.
- UI Save and Start pass metadata from `src/ui/app/build-info.ts`.
- Do not read `window`, `process`, or build globals from `src/core` or `src/io`.

Example comment header:

```gcode
; LaserForge 2.0
; version: 0.0.0
; commit: bf133f5
; built: 2026-06-03T00:00:00.000Z
; emitter: adr-035-fill-gap-split-v1
; safety: G0 carries S0; fill blank gaps >5mm rapid; raster uses M4 S0
```

### Verification

- [ ] `pnpm test --run src/core/invariants/blank-feed.test.ts src/core/preflight/preflight.test.ts src/io/gcode/gcode-metadata.test.ts src/io/gcode/emit-gcode.test.ts`
- [ ] `pnpm run typecheck`
- [ ] `npm.cmd run lint`
- [ ] Re-export the arch-house `.lf2` and confirm:
  - Header contains current commit and emitter revision.
  - `long-blank-feed` preflight is clean on fresh output.
  - The old desktop G-code fails if passed through the new invariant.

---

## Phase P0-B: Operator Safety Alerts For Write Failure And Mid-Job Disconnect

**Why second:** The machine may still move from buffered commands. The UI must tell the operator the truth immediately.

### Files

- Create: `src/ui/state/laser-safety-notice.ts`
- Modify: `src/ui/state/laser-store.ts`
- Create: `src/ui/laser/SafetyNoticeBanner.tsx`
- Create: `src/ui/laser/SafetyNoticeBanner.test.tsx`
- Modify: `src/ui/laser/LaserWindow.tsx`
- Modify: `src/ui/laser/JobControls.tsx`
- Modify: `src/ui/laser/JobControls.test.tsx`
- Modify: `src/ui/laser/LaserWindow.test.tsx`
- Modify: `src/ui/state/laser-store.test.ts`

### Design

Create a small discriminated union:

```ts
export type LaserSafetyNotice =
  | {
      readonly kind: 'write-failed';
      readonly action: 'pause' | 'resume' | 'stop' | 'disconnect' | 'frame' | 'origin' | 'jog' | 'home';
      readonly message: string;
    }
  | {
      readonly kind: 'disconnect-during-job';
      readonly message: string;
    };
```

Add to `LaserState`:

```ts
readonly safetyNotice: LaserSafetyNotice | null;
readonly clearSafetyNotice: () => void;
```

Keep the copy blunt:

```text
USB connection was lost during an active job. The machine may still be moving from buffered commands. Use physical E-stop or power cutoff now if unsafe. Reconnect and home before continuing.
```

For failed Stop:

```text
Stop command was not written to the controller. Use physical E-stop or power cutoff now if unsafe. The machine may still be running.
```

### Test First

- [ ] In `laser-store.test.ts`, add a test for cable-yank:
  - Start a job.
  - `connection.emitClose()`.
  - Expect `streamer?.status === 'disconnected'`.
  - Expect `safetyNotice?.kind === 'disconnect-during-job'`.

- [ ] In `JobControls.test.tsx`, add tests:
  - Stop write rejects.
  - Banner text appears.
  - Streamer remains `streaming`.
  - The notice can be acknowledged and removed.

- [ ] In `LaserWindow.test.tsx`, add a disconnect-button rejection test:
  - Mock `disconnect` to reject.
  - Click Disconnect.
  - Expect persistent safety banner text.

### Implement

- [ ] Initialize `safetyNotice: null`.
- [ ] In `safeWrite`, keep `lastWriteError`, but do not infer the action there. Action wrappers set the user-facing notice.
- [ ] In `pauseJob`, `resumeJob`, `stopJob`, and `disconnect`, catch write failures only long enough to set a notice, then rethrow so tests and callers still know the action failed.
- [ ] In `conn.onClose`, if active streamer transitions to `disconnected`, set `disconnect-during-job`.
- [ ] In `JobControls`, replace `void stopJob()` and `void pauseJob()` with local handlers that catch and let the store notice render.
- [ ] In `LaserWindow`, replace `void disconnect()` with a handler that catches and preserves the notice.
- [ ] Render `SafetyNoticeBanner` near the top of `LaserWindow`, above motion controls.

### Verification

- [ ] `pnpm test --run src/ui/state/laser-store.test.ts src/ui/laser/JobControls.test.tsx src/ui/laser/LaserWindow.test.tsx`
- [ ] `pnpm run typecheck`
- [ ] Manual non-burning test:
  - Mock or disconnect serial write.
  - Click Stop/Pause/Disconnect during an active job simulation.
  - Confirm the banner is visible and uses physical E-stop/power wording.

---

## Phase P1-A: Raster Budget Before Allocation

**Why third:** This is the root of the "app freezes after image scan / image job" class. The guard must run before `compileRasterGroup` allocates target luma, dither buffers, and full G-code strings.

### Files

- Create: `src/core/raster/raster-budget.ts`
- Create: `src/core/raster/raster-budget.test.ts`
- Create: `src/core/job/raster-bounds.ts`
- Create: `src/core/job/raster-bounds.test.ts`
- Modify: `src/core/job/compile-job.ts`
- Create: `src/core/preflight/pre-emit.ts`
- Create: `src/core/preflight/pre-emit.test.ts`
- Modify: `src/core/preflight/index.ts`
- Modify: `src/io/gcode/emit-gcode.ts`
- Modify: `src/io/gcode/emit-gcode.test.ts`
- Modify: `src/ui/laser/live-job-estimate.ts`
- Modify: `src/ui/laser/live-job-estimate.test.ts`
- Modify: `src/ui/layers/LayerRow.tsx`

### Design

Add pure budget calculation:

```ts
export type RasterBudget = {
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly pixelCount: number;
  readonly estimatedWorkingBytes: number;
};

export const MAX_RASTER_PIXELS = 4_000_000;
export const MAX_RASTER_WORKING_BYTES = 64 * 1024 * 1024;
export const WARN_RASTER_LINES_PER_MM = 20;
export const MAX_RASTER_LINES_PER_MM = 25;
```

Working-byte estimate must include:

- source luma bytes
- resampled luma bytes
- `Uint16Array` S-values
- `Float32Array` buffer for Floyd-Steinberg

This is a conservative preflight estimate. It does not need exact emitted G-code byte count in the first increment.

### Test First

- [ ] `raster-budget.test.ts`:
  - 100 x 100 mm at 10 lines/mm passes.
  - 400 x 400 mm at 50 lines/mm fails.
  - 25 lines/mm is allowed only if pixel budget passes.
  - non-finite or zero dimensions return a failing result.

- [ ] `pre-emit.test.ts`:
  - Build a project with one `raster-image` and image layer.
  - Large bounds/lines-per-mm returns `raster-too-large` before compile.

- [ ] `emit-gcode.test.ts`:
  - Large raster returns failing preflight and empty G-code or no emitted motion.
  - Spy-style allocation is not needed; the test should use dimensions that would be dangerous if allocated.

### Implement

- [ ] Extract `rasterBoundsInMachineCoords` from `compile-job.ts` into `src/core/job/raster-bounds.ts`.
- [ ] Add `runPreEmitPreflight(project)` that only checks conditions knowable without full compile.
- [ ] Add `PreflightCode` values:
  - `raster-too-large`
  - `raster-resolution-high`
- [ ] In `emitGcode`, call `runPreEmitPreflight(project)` before `compileJob`.
- [ ] If pre-emit fails, return:

```ts
{ gcode: '', preflight: preEmit }
```

- [ ] In `LayerRow`, clamp image `linesPerMm` to `5..25` to match `WORKFLOW.md`.
- [ ] Show a title/inline hint for `>20` lines/mm only after a proper warning path exists. Until then, keep the hard clamp and let preflight explain large jobs.
- [ ] In `estimateLiveJob`, call budget check before `compileJob`; return `too-large` for over-budget raster jobs.

### Verification

- [ ] `pnpm test --run src/core/raster/raster-budget.test.ts src/core/job/raster-bounds.test.ts src/core/preflight/pre-emit.test.ts src/io/gcode/emit-gcode.test.ts src/ui/laser/live-job-estimate.test.ts`
- [ ] `pnpm run typecheck`
- [ ] `npm.cmd run lint`
- [ ] Manual local check:
  - Import a large image.
  - Set image resolution high.
  - Save/Start should fail quickly with a preflight message, not freeze.

---

## Phase P1-B: Raster Row Blank-Gap Splitting

**Why here:** P0-A will detect long `G1 S0` feed moves, but true Image-mode raster output still creates them inside an active row. Fill already uses ADR-035 gap splitting; raster needs the same idea so separated islands in one raster row do not rely on slow feed-rate S0 travel across a large white interior.

### Files

- Modify: `src/core/raster/emit-raster.ts`
- Modify: `src/core/raster/emit-raster.test.ts`
- Modify: `src/core/raster/emit-raster.property.test.ts`
- Modify: `src/core/invariants/blank-feed.test.ts`
- Modify: `src/core/preflight/preflight.test.ts`

### Design

Current raster active span is one continuous interval:

```ts
first non-zero pixel ... last non-zero pixel
```

Inside that interval, white runs become `G1 ... S0`. That is correct G-code, but large white holes can mark material because the head moves at engraving feed while relying on instantaneous laser-off behavior.

Add a row segmenter:

```ts
type RasterInkSpan = {
  readonly firstX: number;
  readonly lastX: number;
};

const RASTER_GAP_RAPID_THRESHOLD_MM = 5;
```

Behavior:

- Consecutive ink spans separated by `gapMm <= 5` stay in one sweep and use feed-rate S0.
- Gaps over 5 mm split into separate sweeps.
- The move between split sweeps is `G0 ... S0`, not `G1 S0`.
- Preserve bidirectional active-row ordering. If a row splits into three sweeps, each sweep should still respect the emitted row direction.
- Keep all-white rows skipped.
- Keep overscan on each split sweep, but bounds preflight must still catch overscan out-of-bed.

### Test First

- [ ] Add `emit-raster.test.ts` case:

```ts
it('rapids across large interior blank gaps instead of feeding S0 across them', () => {
  const s = new Uint16Array([
    100, 100, 0, 0, 0, 0, 0, 0, 100, 100,
  ]);
  const gcode = emitRasterGroup({
    sValues: s,
    width: 10,
    height: 1,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 2 },
    feedMmPerMin: 1500,
    overscanMm: 0,
  });

  expect(gcode).toContain('G0 X16.000 Y1.000 S0');
  expect(gcode).not.toContain('G1 X16.000 S0');
});
```

- [ ] Add a small-gap case that still keeps one feed sweep.
- [ ] Extend property tests to assert no `G1 S0` move over the rapid threshold after raster emission.

### Implement

- [ ] Replace `activeSpan` with `activeSpans` returning one or more spans split by white-gap distance.
- [ ] Update row loop to emit multiple sweep fragments for one source row.
- [ ] Use one feed word on the first G1 of the raster group; later fragments inherit feed.
- [ ] Keep `M4 S0` at raster group start and `M5` at end.

### Verification

- [ ] `pnpm test --run src/core/raster/emit-raster.test.ts src/core/raster/emit-raster.property.test.ts src/core/invariants/blank-feed.test.ts src/core/preflight/preflight.test.ts`
- [ ] Export a synthetic raster with two separated black islands on one row and inspect that the island-to-island move is `G0 ... S0`.

---

## Phase P1-C: Shared Prepared-Output Pipeline

**Why after raster gap splitting:** Preview, Save, Start, Frame, and Estimate must reason about the same compiled/placed/optimized job. Otherwise the user can approve one path and burn another.

### Files

- Create: `src/io/gcode/prepare-output.ts`
- Create: `src/io/gcode/prepare-output.test.ts`
- Modify: `src/io/gcode/emit-gcode.ts`
- Modify: `src/ui/workspace/draw-preview.ts`
- Modify: `src/ui/laser/live-job-estimate.ts`
- Modify: `src/ui/laser/start-job-readiness.ts`
- Modify: `src/ui/app/file-actions.ts`
- Modify: related tests:
  - `src/io/gcode/emit-gcode.test.ts`
  - `src/ui/laser/live-job-estimate.test.ts`
  - `src/ui/laser/start-job-readiness.test.ts`
  - `src/ui/app/file-actions.test.ts`

### Design

Create:

```ts
export type PreparedOutput =
  | {
      readonly ok: true;
      readonly job: Job;
      readonly preflight: PreflightResult;
    }
  | {
      readonly ok: false;
      readonly preflight: PreflightResult;
    };

export type PrepareOutputOptions = {
  readonly jobOrigin?: JobOriginPlacement;
  readonly preflightMotionOffset?: PreflightOptions['motionOffset'];
};
```

Flow:

1. `runPreEmitPreflight(project)`.
2. `compileJob(project.scene, project.device)`.
3. Optional `applyJobOrigin`.
4. `optimizePaths`.
5. Return the prepared `Job`.

Then:

- `emitGcode` emits from `PreparedOutput.job`.
- `buildPreviewToolpath` builds from `PreparedOutput.job`.
- `estimateLiveJob` estimates from `PreparedOutput.job`.
- `prepareStartJob` and `handleSaveGcode` share warnings and preflight results.

### Test First

- [ ] Add `prepare-output.test.ts`:
  - A multi-path project should return an optimized job.
  - User-origin options should shift the job before optimization.
  - Raster over-budget returns `ok: false` without G-code emission.

- [ ] Add preview/output parity test:
  - Build preview toolpath from a project with two disordered vector segments.
  - Emit G-code with the same project.
  - Assert first burn segment order matches the optimized job order.

### Implement

- [ ] Replace direct `compileJob` calls in output-facing UI with `prepareOutput`.
- [ ] Keep `Frame` conservative: it can use prepared output for bounds, but it must preserve its existing physical-bounds/WCO checks.
- [ ] Save G-code must call the same job-intent warning path as Start. Since Save writes a file rather than moving the machine, warnings should be confirm-before-write, not block. Use the existing `window.confirm` style until a better modal exists.

### Verification

- [ ] `pnpm test --run src/io/gcode/prepare-output.test.ts src/io/gcode/emit-gcode.test.ts src/ui/laser/live-job-estimate.test.ts src/ui/laser/start-job-readiness.test.ts src/ui/app/file-actions.test.ts`
- [ ] `pnpm test --run src/ui/workspace`
- [ ] `pnpm run typecheck`
- [ ] `npm.cmd run lint`

---

## Phase P2-A: Trace And Import Correctness

**Why fifth:** These do not directly stop a dangerous burn, but they prevent wrong-size imports, stale previews, and image-mode jobs that look valid but fail later.

### Files

- Modify: `src/ui/trace/use-trace-preview.ts`
- Create: `src/ui/trace/use-trace-preview.test.tsx`
- Modify: `src/ui/trace/use-trace-worker-client.ts`
- Modify: `src/ui/trace/use-trace-worker-client.test.ts`
- Modify: `src/ui/trace/ImportImageDialog.tsx`
- Create: `src/ui/trace/ImportImageDialog.test.tsx`
- Create: `src/ui/common/image-density.ts`
- Create: `src/ui/common/image-density.test.ts`
- Modify: `src/ui/common/image-import.ts`
- Modify: `src/ui/common/image-import.test.ts`
- Modify: `src/ui/common/Toolbar.tsx`
- Modify: `src/ui/trace/image-loader.ts`
- Modify: `src/ui/state/scene-mutations.ts`
- Modify: `src/ui/state/scene-mutations.test.ts`

### Stale Trace Preview Design

Change `runTrace` signature:

```ts
function runTrace(args: {
  readonly img: RawImageData;
  readonly options: TraceOptions;
  readonly isCurrent: () => boolean;
  readonly setState: (next: TracePreviewState) => void;
}): void
```

After `await traceImageWithFallback`, check `isCurrent()` before setting `ready`. Check again in catch before setting `error`.

### Worker Timeout Design

Add a bounded worker request timeout in `traceInWorker`:

```ts
const TRACE_WORKER_TIMEOUT_MS = 30_000;
```

If timeout fires:

- Reject the pending request with `Trace worker timed out`.
- Delete it from the pending map.
- Terminate the worker and allow the next trace request to construct a fresh worker.
- Let preview show an error and commit leave the scene unchanged.

This does not solve CPU cost by itself; it prevents indefinite busy state.

### Trace Source Revalidation Design

Before commit applies a trace:

- Re-read the selected/source object by `seed.id`.
- Require it to still be a `raster-image`.
- Require `dataUrl`, `pixelWidth`, `pixelHeight`, and transform to match the dialog seed.
- If not, show an error and do not add a trace.

Also ensure modal-level key handling prevents global Delete/Backspace from removing the selected source while the dialog is focused. Prefer reusing the repo's existing dialog a11y hook if it already stops Escape/Tab only; if global shortcut suppression needs a new flag, implement that as a focused UI-store state, not a one-off DOM hack.

### DPI Metadata Design

Add `readImageDensity(file: File): Promise<number | null>`:

- PNG:
  - Verify PNG signature.
  - Walk chunks.
  - Read `pHYs`.
  - If unit is meters and X/Y pixels-per-meter are positive, convert to DPI.
- JPEG:
  - Walk markers.
  - Read APP0 JFIF.
  - Unit 1: density is DPI.
  - Unit 2: density is dots/cm, convert by multiplying by 2.54.
- If no supported metadata or invalid values, return `null`.

Do not implement EXIF density in this phase unless a fixture requires it. PNG `pHYs` and JFIF cover the common export path and keep the parser small.

### Image-Layer Collision Design

Current `ensureRasterImageLayer(scene, color)` does nothing if `#808080` already exists in line/fill mode. Fix by creating a unique image layer color/id or by switching only if the layer is unused by non-raster objects. The safer first increment is unique layer creation:

- If color exists with `mode === 'image'`, reuse it.
- If color exists with non-image mode, create `#808080-image-1` style layer id/color only if the scene color model supports it.
- If the scene requires layer color to equal object color, assign the imported raster to a generated gray variant not currently used.

### Test First

- [ ] `use-trace-preview.test.tsx`:
  - Mock two trace calls.
  - First call resolves after second.
  - Assert only second result is displayed.
  - Repeat with first call rejecting after second succeeds; stale error must not overwrite ready state.

- [ ] `use-trace-worker-client.test.ts`:
  - Fake worker never responds.
  - Advance fake timers.
  - Expect request rejects with timeout.
  - Expect worker is terminated.
  - Next request constructs a new worker.

- [ ] `ImportImageDialog.test.tsx`:
  - Source raster is deleted/changed before submit.
  - Commit refuses and shows an error.
  - Scene remains unchanged.
  - Delete/Backspace behind the modal does not remove the source during dialog interaction.

- [ ] `image-density.test.ts`:
  - Inline minimal PNG with `pHYs` 11811 pixels/meter should read about 300 DPI.
  - Inline minimal JFIF with unit 1 and density 300 should read 300.
  - No metadata returns null and import geometry falls back to 96 DPI.

- [ ] `scene-mutations.test.ts`:
  - Existing `#808080` line layer plus imported raster creates a startable image-mode layer, not a line-mode mismatch.

- [ ] `image-loader.test.ts`:
  - `readFileAsDataUrl` rejects when FileReader result is not a string.
  - Malformed data URL still rejects in `dataUrlToFile`.

### Implement

- [ ] Token-check trace after await.
- [ ] Add worker timeout and worker retirement.
- [ ] Revalidate trace source on commit.
- [ ] Suppress destructive global shortcuts while the modal is active.
- [ ] Parse image density and pass `dpi` into `rasterImportGeometry`.
- [ ] Preserve current 96 DPI fallback.
- [ ] Make `readFileAsDataUrl` reject non-string FileReader results.
- [ ] Fix image-layer collision.
- [ ] Keep luma quality note separate: import currently stores full data URL but samples luma at the trace cap. After raster budget from P1-A is shipped, add a separate target-resolution luma extraction phase if small raster text still looks jagged.

### Verification

- [ ] `pnpm test --run src/ui/trace/use-trace-preview.test.tsx src/ui/trace/use-trace-worker-client.test.ts src/ui/trace/ImportImageDialog.test.tsx src/ui/common/image-density.test.ts src/ui/common/image-import.test.ts src/ui/trace/image-loader.test.ts src/ui/state/scene-mutations.test.ts`
- [ ] `pnpm run typecheck`
- [ ] `npm.cmd run lint`
- [ ] Side-effect-free browser check on a throwaway File object if needed; do not drive the maintainer's live scene without permission.

---

## Phase P2-B: Small Text Burn-Quality Workflow And M4 Fill Experiment

**Why last in this plan:** This is important, but changing fill laser mode changes material behavior. It must be proven with G-code and controlled burn evidence before production code changes.

### Files For Planning Only First

- Keep evidence in `audit/evidence/` or `audit/reports/`.
- Do not edit `src/core/output/grbl-strategy.ts` for M4 fill until the baseline test is recorded.

### Baseline Evidence To Collect Before Code

- [ ] Export the actual small-text/fill job from current HEAD.
- [ ] Confirm fill groups open under `M3 S0`.
- [ ] Confirm bottom-text short runs under 10 mm skip overscan because `OVERSCAN_MIN_BURN_RATIO = 2` and overscan is 5 mm.
- [ ] Count micro-spans:
  - total positive burn spans
  - spans under 1 mm
  - spans under 0.5 mm
  - shortest span
- [ ] Burn only the small text at 1500 mm/min and at 300 mm/min with the same power. If low speed improves density, M3 acceleration density is likely a major contributor.

### Implementation Candidates After Evidence

Candidate 1: M4 fill mode experiment.

- Modify `src/core/output/grbl-strategy.ts`.
- Fill group emits `M5`, then `M4 S0`, then fill sweeps.
- After a fill group, a later cut group must re-issue `M3 S0`, already done after raster groups and should be generalized.
- Add tests in `src/core/output/grbl-strategy.test.ts`.
- Do not change line/cut mode in the same diff.

Candidate 2: Small-feature warning.

- Create `src/core/preflight/small-feature.ts`.
- Warn when filled traced features have:
  - bounding box height under `2 * hatchSpacingMm`, or
  - high count of positive burn spans under `0.5 mm`.
- Since current preflight is blocking-only, put this first in the shared Save/Start warning path from P1-C.

Candidate 3: Unidirectional fill option.

- Requires layer schema change or a default-only experiment.
- Do not add this until M4 fill has hardware evidence.

### Verification

- [ ] G-code diff must show only intended `M3`/`M4` mode changes for fill.
- [ ] Property tests still enforce laser-off travel.
- [ ] Hardware A/B:
  - Old M3 fill vs M4 fill on same scrap.
  - Same power/speed/hatch spacing.
  - Record whether density/blobby edges improve.
  - If geometry remains wavy, trace quality is the remaining root cause; use native vector/text or image raster mode for small lettering.

---

## Review Checklist Before Any Implementation

- [ ] Confirm no production files changed during planning.
- [ ] Confirm the worktree is still the correct repo: `C:\Users\Asus\LaserForge-2.0`.
- [ ] Confirm branch target before committing.
- [ ] Confirm the user wants implementation, not more audit.
- [ ] Implement only one phase at a time.
- [ ] Run focused tests before full tests.
- [ ] For output changes, inspect generated G-code before any burn.
- [ ] For safety changes, use physical E-stop/power wording; do not imply software can stop motion after USB is gone.

## Open Questions For The Maintainer

These do not block P0-A through P1-A:

1. Should `long-blank-feed` be a hard blocker or a confirmable warning? This plan uses a hard blocker for gaps over 5 mm because the user's artifact visibly marked material.
2. Should G-code metadata be added to Start-streamed G-code as well as saved files? This plan says yes because it helps logs and controller transcripts match exports.
3. Should image import honor DPI strictly even when it creates very large physical bounds? This plan says yes, with the raster budget catching impossible output later.
4. Should M4 fill be a production default after the first successful A/B burn, or a per-device/layer option? This plan keeps it as a hardware experiment until evidence is recorded.

## Done Criteria For The Roadmap

The roadmap is done when:

- Fresh arch-house export includes build/emitter metadata.
- Old unsafe G-code is rejected by the new long blank-feed invariant.
- Stop/Pause/Disconnect write failure displays a persistent physical-stop warning.
- Cable yank during an active job displays a buffered-motion recovery warning.
- Large image jobs fail quickly before raster allocation or full G-code string creation.
- Preview, Save, Start, Frame, and Estimate share the same prepared-output job.
- Trace preview cannot be overwritten by stale async results.
- PNG/JPEG density metadata affects image import size.
- Image imports cannot silently land on a non-image layer.
- Small traced text has a documented operator warning and a measured M4-fill experiment result.
