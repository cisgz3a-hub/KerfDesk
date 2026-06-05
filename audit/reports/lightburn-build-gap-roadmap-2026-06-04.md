# LightBurn Gap Roadmap - 2026-06-04

## Rule For This Roadmap

Implement in small, test-first stages. Do not batch safety, performance, and LightBurn-polish fixes in one diff. For each stage: write the failing test, patch the smallest surface, run focused tests, then run typecheck/lint/full suite before moving on.

## P0 - Job Safety And Honest Failure States

### P0-A. GRBL error stops stream

- Add a failing test where an active streamer receives `error:24` or `error:15`.
- Change live stream handling so `error` no longer calls the normal progress path.
- Preserve the rejected line, GRBL error code, current job ticket, and recovery instructions.
- UI copy: "Controller rejected a command. Streaming stopped. The machine may still execute buffered moves; use physical E-stop or power cutoff if unsafe."
- Tests: `laser-line-handler.test.ts`, `streamer.test.ts`, `SafetyNoticeBanner.test.tsx`.

### P0-B. Follow-up write failure creates active-job recovery

- Add a test for `safeWrite(stepped.toSend)` rejection after an ack.
- Route it to disconnect-during-job recovery instead of silently collapsing the streamer.
- Keep Stop/recovery visible until the operator acknowledges machine state.
- Tests: `laser-line-handler.test.ts`, `JobControls.test.tsx`, any existing disconnect recovery tests.

### P0-C. Frame/jog stoppable operation model

- Frame currently sends serial `$J=` moves in a loop, but the UI does not model Frame as a stoppable operation equivalent to a job.
- Add an operation state for Frame/Jog where Stop/Cancel is visible during motion.
- Tests: `laser-store.test.ts`, `JobControls.test.tsx`, `JogPad` focused tests.

## P1 - Freeze Prevention In Raster/Image Paths

### P1-A. Convert to Bitmap pre-budget

- Add a pure budget helper: selected vector bounds + target DPI -> estimated pixels and bytes.
- Reject or ask confirmation before `rasterizeVectorToLuma` for oversized output.
- Keep 254 DPI default, but expose the budget verdict in the UI.
- Tests: `convert-to-bitmap.test.ts`, `vector-to-bitmap.test.ts`.

### P1-B. Convert to Bitmap worker/async encode

- Move heavy rasterization/encoding off the main render path.
- Prefer `canvas.toBlob()` or `OffscreenCanvas.convertToBlob()` where browser support allows; keep a fallback for tests/older Chromium.
- Show progress/cancel for large conversions.
- Tests: worker client unit tests plus browser smoke on a large vector.

### P1-C. Raster Preview budget parity

- Gate `draw-raster-preview.ts` through the same raster budget used by output.
- Render a bounded thumbnail/simulation if full preview is too large.
- Tests: `draw-raster-preview.test.ts`, `draw-preview.parity.test.ts`.

### P1-D. Remove direct compile from Start readiness and Frame

- Replace raw `compileJob` calls in `start-job-readiness.ts` and `JobControls.tsx`.
- Start readiness should use prepared/budgeted output or cheap scene bounds.
- Frame should use scene object bounds, not emitted raster groups.
- Tests: `start-job-readiness.test.ts`, `JobControls.test.tsx`, `prepare-output.test.ts`.

## P1 - Output Truth And LightBurn-Critical Workflow

### P1-E. Raster ETA uses the emitted active-span logic

- Share `activeSpans` from `emit-raster.ts` or move it to a small pure helper.
- Estimate must include each emitted span and rapid transition.
- Tests: `estimate-duration.test.ts`, `emit-raster.test.ts`.

### P1-F. Layer order control

- Add explicit layer ordering to the project model.
- Expose reorder controls in Cuts/Layers.
- Compile order must follow that explicit order.
- Tests: `layer.test.ts`, `project.test.ts`, `compile-job.test.ts`, UI layer tests.

### P1-G. SVG fill geometry survives import

- Import fill-only closed geometry.
- Decide default layer mode based on current project policy: likely keep mode `line` unless workflow chooses `fill`, but geometry must not disappear.
- Tests: `parse-svg.test.ts`, `pipeline.snapshot.test.ts`, a logo fixture.

## P2 - LightBurn Parity Features

### P2-A. Start From and Job Origin settings

- Model LightBurn-style Start From and Job Origin explicitly.
- Thread through preview, frame, save/start, and physical bounds checks.
- Tests: origin transform matrix and end-to-end preview/output consistency.

### P2-B. Dirty file modal

- Replace discard-only native confirm with Save / Don't Save / Cancel.
- Use the existing save action so the modal is not a separate persistence path.
- Tests: toolbar/file-actions modal flows.

### P2-C. Modal shortcut gate

- Add a modal stack or global "shortcuts disabled" context.
- Prove Delete, Preview, New, Open, Save G-code cannot mutate scene while Trace owns focus unless explicitly allowed.
- Tests: `use-shortcuts`, `ImportImageDialog`.

### P2-D. Desktop menu command registry

- Define command IDs once.
- Bind toolbar buttons, keyboard shortcuts, and Electron menu items to those command IDs.
- Tests: command registry coverage and Electron menu dispatch.

## P3 - Process And Repo Hygiene

### P3-A. LaserForge-2.0 AGENTS.md

- Add a root `AGENTS.md` for this repo, not the old sibling.
- Include repo identity, expected remote, audit workspace, and "do not touch old LaserForge" warning.

### P3-B. Audit coverage gate

- Keep `audit/scripts/generate-source-coverage-ledger.mjs`.
- Add a CI/manual audit command that writes the source coverage ledger and fails if safety-critical files lack at least one direct test or explicit exemption.

### P3-C. Deploy/audit identity banner

- Any deploy or audit script prints path, remote URL, branch, and HEAD.
- Production deploy must run `scripts/assert-correct-repo.mjs` first.

## Suggested Implementation Order

1. P0-A and P0-B: safety stream failure states.
2. P1-A and P1-D: freeze before budget in Convert/Start/Frame.
3. P1-C and P1-E: preview/estimate parity.
4. P1-F and P1-G: LightBurn-critical layer/SVG behavior.
5. P2-A through P2-D: operator workflow parity.
6. P3-A through P3-C: repo/process guardrails.
