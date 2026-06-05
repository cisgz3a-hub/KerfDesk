# Combined Karpathy + LightBurn Audit

Date: 2026-06-04

Repo: `C:\Users\Asus\LaserForge-2.0`

Branch: `wip/checkpoint-2026-06-03`

Combined from:

- `audit/reports/full-code-audit-karpathy-rating-2026-06-04.md`
  - committed as `d43e9e4`
  - credited to Claude Opus 4.8 / 13-reviewer pass
- `audit/reports/karpathy-lightburn-rating-audit-2026-06-04.md`
  - Codex reconciliation pass
- live-code verification commands run during reconciliation

## Final Combined Rating

**7.5 / 10**

This score is stable across both audits.

LaserForge 2.0 is now a disciplined, test-backed laser CAM prototype with a
stronger safety/output core than the repo had earlier today. It should not be
called a clean production release candidate yet because:

- the current tree fails the existing formatting gate used by CI/deploy;
- `resumeJob` has one real safety-adjacent streamer write gap;
- raster/photo quality controls lag LightBurn;
- Trace and Convert to Bitmap are still not LightBurn-aligned;
- SVG import parity is incomplete;
- hardware verification evidence is still incomplete.

## Reconciliation Decisions

### Accepted From Claude's Audit

- No confirmed P0 laser-safety defect at the audited HEAD.
- `resumeJob` follow-up write failure is a real P1 safety-adjacent issue.
- Laser-off travel and modal S behavior are strengths, not current findings.
- Electron security posture is strong for the current app shape.
- Raster/image parity gaps are real: only 3 raster dither modes, no Min Power
  layer setting in emission, no tonal adjust on the raster engrave path.
- Start From / Job Origin capability is partly in core but under-wired in UI.
- Layer reordering is missing, but lower urgency than safety/raster quality.

### Accepted From Codex Audit

- `format:check` currently fails and is a release gate because CI/deploy run it.
- Trace UI still exposes preset/image-adjustment workflow instead of the
  LightBurn Trace Image control model.
- Convert to Bitmap is still Fill-All only and lacks Render Type / DPI.
- SVG fill-only geometry, physical units, rounded rectangles, and local
  `<use>` remain real import parity gaps.
- `.lf2` deserialization still relies on a broad cast after partial
  normalization.
- `canvas.toDataURL()` remains a residual large-bitmap memory risk even after
  the new budget guard.

### Severity Adjustments

- `format:check` failure is **P0 release gate**, not P0 laser safety.
- Claude's "no P0" statement is accepted as **no P0 safety cap**, not "no
  release-blocking issues at all."
- Layer reordering is **P2**, not P1, because it is important LightBurn parity
  but not safety-critical and the code already emits in layer order.
- Offset Fill is **P2/P3**, not an immediate P1, because it is a large feature
  and lower value than raster quality, Trace, Convert to Bitmap, and Start From.

## Verified Command Baseline

| Check | Result |
| --- | --- |
| `npm.cmd run guard:repo` | pass |
| `npm.cmd run typecheck` | pass |
| `npm.cmd run lint` | pass, existing boundaries selector warning only |
| `npm.cmd test` | pass, 135 files / 1011 tests |
| `npm.cmd run build` | pass, Vite chunk warnings only |
| `npm.cmd run lint:electron` | pass |
| `npm.cmd run format:check` | fail, 9 files need Prettier |

## Category Scores

| Area | Score | Combined rationale |
| --- | ---: | --- |
| Scene + compile pipeline | 8.5 | Strong transform order, fill/raster grouping, base64-luma fail-safe behavior; still wants more fuzz and exhaustiveness coverage. |
| Output / GRBL emission | 8.0 | Laser-off travel invariants and modal S discipline are strong and tested. |
| Controller / streaming safety | 6.5 | Error/alarm terminal handling is good, but `resumeJob` follow-up write is a real P1. |
| Raster / trace internals | 7.5 | Orientation, gap splitting, budget guards, and trace worker tests are good. Engrave controls and luma-resample coverage lag. |
| Preflight / invariants | 8.0 | Pre-emit budget and emitted-G-code invariant checks are correctly placed. |
| UI / workflow parity | 6.0 | Trace, Convert to Bitmap, Start From, layer controls, and SVG import are materially behind LightBurn. |
| Security / Electron / deploy posture | 8.5 | Electron and SVG security posture are strong; deploy gate catches wrong-repo mistakes, but format currently fails. |
| Test/process quality | 7.5 | Full suite is strong and broad; hardware verification and format cleanliness are missing. |

## Combined Findings

### P0 Release Gate - Formatting fails in CI/deploy path

- Paths: `package.json:20`, `.github/workflows/ci.yml:55`,
  `.github/workflows/deploy.yml:78`.
- Trigger: `npm.cmd run format:check` or GitHub/Cloudflare workflow.
- Failure mode: Prettier reports 9 files with style drift:
  - `audit/findings/lightburn-parity-codex-verification-2026-06-03.json`
  - `src/core/job/fill-sweeps.ts`
  - `src/core/job/toolpath.test.ts`
  - `src/core/job/toolpath.ts`
  - `src/core/output/grbl-strategy.fill-power-mode.test.ts`
  - `src/core/output/grbl-strategy.property.test.ts`
  - `src/core/output/grbl-strategy.test.ts`
  - `src/io/gcode/prepare-output.test.ts`
  - `src/ui/workspace/draw-preview.parity.test.ts`
- Consequence: green tests/build can still fail CI/deploy.
- Confidence: high, reproduced locally.
- Fix: run Prettier on exactly those files, review the diff, rerun
  `format:check`, then rerun output-focused tests and the normal verification
  bundle.

### P1 Safety-Adjacent - `resumeJob` can commit phantom in-flight bytes

- Path: `src/ui/state/laser-store.ts:389-412`.
- Trigger: paused job, Resume clicked, `RT_RESUME` succeeds, follow-up
  `safeWrite(toSend)` fails.
- Failure mode: `resumeJob` wraps the realtime resume byte, then advances
  streamer state and writes queued G-code without a try/catch. If that second
  write fails, bytes can be counted in-flight even though they never reached
  GRBL.
- Consequence: stream can stall silently with incorrect host-side accounting.
  This is not a runaway-laser P0 because it begins from a paused job, but after
  `RT_RESUME`, GRBL can still execute already-buffered commands, so the
  operator needs a visible failure state.
- Confidence: high, live-code verified.
- Research basis: GRBL character-counted streaming relies on honest host byte
  accounting; GRBL buffering means host failure states must be explicit.
- Fix: wrap the follow-up write. On failure, mirror the active-stream
  follow-up write failure path: disconnect/fail the stream, raise a resume or
  disconnect safety notice, and add a regression test.

### P1 Workflow/Fidelity - Trace UI is not LightBurn-aligned

- Paths: `src/ui/trace/ImportImageDialog.tsx`,
  `src/ui/trace/dialog-parts.tsx`, `src/ui/trace/AdjustmentControls.tsx`,
  `src/core/trace/potrace-params.ts`, `src/core/trace/trace-image.ts`.
- Trigger: import image, open Trace.
- Failure mode: UI is preset/adjustment-first. Core has some
  cutoff/threshold foundation, but the operator cannot work through the
  LightBurn Trace Image control set.
- Consequence: trace tuning remains harder than LightBurn and less
  reproducible.
- Research basis: LightBurn Trace Image exposes cutoff, threshold, boundary,
  ignore-small-regions, optimize, smoothness, transparency, fade/show controls.
  LightBurn Adjust Image is separate.
- Fix: implement ADR-030 in stages. Put trace-specific controls in Trace;
  keep brightness/contrast/gamma/invert in an image-adjustment workflow.

### P1 Workflow/Fidelity - Convert to Bitmap lacks Render Type and DPI

- Paths: `src/ui/common/Toolbar.tsx`, `src/ui/raster/vector-to-bitmap.ts`,
  `src/core/raster/rasterize-vector.ts`.
- Trigger: select vector/text/traced object and click Convert to Bitmap.
- Failure mode: immediate Fill-All conversion with default density. No dialog,
  no Outlines, no Use Cut Settings, no explicit DPI.
- Consequence: open line art and cut-setting based conversion cannot match
  LightBurn.
- Research basis: LightBurn Convert to Bitmap exposes Render Type
  `Outlines`, `Fill All`, `Use Cut Settings`, and explicit DPI.
- Fix: add a dialog with Render Type and DPI, then implement Outlines and Use
  Cut Settings with tests.

### P1 Raster Quality - Only three raster engrave modes

- Paths: `src/core/raster/dither.ts:29`, `src/core/scene/layer.ts:14`,
  `src/ui/layers/LayerRow.tsx:306-308`.
- Trigger: image-mode engraving, especially photo engraving.
- Failure mode: engrave path supports only `threshold`, `floyd-steinberg`, and
  `grayscale`; richer dither kernels exist only for trace preprocessing.
- Consequence: photo engrave quality and LightBurn recipe transfer are limited.
- Research basis: LightBurn Image Mode exposes many image algorithms and
  settings; Jarvis/Stucki/Atkinson-style kernels are common laser photo
  workflow controls.
- Fix: extract/share trace dither kernels into raster engraving, expand
  `LayerDitherAlgorithm`, and add deterministic output snapshots before
  changing defaults.

### P1 Raster Quality - No layer Min Power in emitted grayscale

- Paths: `src/core/scene/layer.ts`, `src/core/raster/dither.ts`,
  `src/core/devices/device-profile.ts`.
- Trigger: grayscale/image engraving on a diode where low S values do not
  produce usable marks or corners need a floor.
- Failure mode: layer model has one `power`; device has `minPowerS`, but the
  raster emission path maps grayscale from `0..sMax` without a layer-level
  min-to-max power range.
- Consequence: tonal range and recipe parity lag LightBurn.
- Fix: add layer `minPower` / `maxPower` or equivalent constant/variable
  power model, thread it into dither/grayscale emission, and hardware-verify.

### P1 Raster Quality - No tonal adjust on raster engrave path

- Paths: `src/core/job/compile-job.ts`, `src/core/trace/raster-prep.ts`,
  `src/ui/trace/AdjustmentControls.tsx`.
- Trigger: engraving a photo/raster image.
- Failure mode: brightness/contrast/gamma/invert helpers are trace-path tools,
  not raster-engrave layer settings.
- Consequence: the operator cannot tune photo burn tone at engraving time like
  LightBurn Adjust Image / image settings.
- Fix: add pure raster tonal adjustment before dither/resample, mirror it in
  preview, and expose layer or image-level controls.

### P1 Workflow - Start From / Job Origin is under-wired

- Paths: `src/core/job/job-origin.ts`, `src/ui/laser/JobControls.tsx`,
  `src/ui/laser/start-job-readiness.ts`.
- Trigger: operator wants LightBurn-style Absolute Coordinates, Current
  Position, User Origin, and 9-dot Job Origin behavior.
- Failure mode: core anchor math exists, but `JobStartMode` is only
  `absolute | user-origin`; UI uses a fixed front-left user-origin placement.
- Consequence: common LightBurn placement workflows are not reachable.
- Fix: add explicit Start From / Job Origin state, expose dropdown + 9-dot
  picker, thread through Preview, Frame, Start, Save, and bounds checks.

### P1 Import Fidelity - SVG fill-only artwork is dropped

- Paths: `src/io/svg/parse-svg.ts`, `src/io/svg/parse-svg-presentation-state.test.ts`.
- Trigger: import logo SVG with `fill` but no `stroke`.
- Failure mode: parser keys drawable geometry from stroke and intentionally
  skips fill-only shapes.
- Consequence: common logo artwork can import blank or incomplete.
- Fix: import filled closed geometry with fill-derived color/layer while
  preserving mode-driven output behavior.

### P1/P2 Import Fidelity - SVG units, rounded rectangles, and local reuse

- Paths: `src/io/svg/parse-svg.ts`, `src/io/svg/shape-to-polylines.ts`,
  `src/io/svg/sanitize.test.ts`.
- Trigger: SVG uses `mm`, `in`, `pt`, rounded rect `rx/ry`, or local
  `<use href="#id">`.
- Failure mode: physical size uses `Number.parseFloat`, rounded rectangles are
  sharp, and local reuse is not expanded.
- Consequence: imported size and geometry can differ from the design file and
  from LightBurn.
- Fix: implement SVG length-unit parsing, rounded-rect flattening, and safe
  local `<use>` expansion.

### P1 Process - Hardware verification debt remains

- Paths: `PROJECT.md`, `WORKFLOW.md`, `DECISIONS.md`, `audit/evidence/`.
- Trigger: calling safety/raster/origin behavior fully proven from tests.
- Failure mode: tests verify code and emitted G-code, not real Falcon motion,
  burn quality, or disconnect behavior.
- Consequence: production claims are stronger than the available physical
  evidence.
- Research basis: LightBurn Job Control guidance and GRBL buffering docs both
  require honest physical-stop and buffered-motion assumptions.
- Fix: run low-power hardware smoke tests and save G-code, serial logs,
  screenshots, and burn photos in `audit/evidence/`.

### P2 Workflow - Layer reordering missing

- Paths: `src/core/scene/scene.ts`, `src/core/job/compile-job.ts`,
  `src/ui/layers/CutsLayersPanel.tsx`.
- Trigger: mixed image/fill/cut job where operator needs a specific layer
  order.
- Failure mode: output follows `scene.layers` order, but UI has no Move
  Up/Down or drag ordering.
- Consequence: LightBurn-style layer sequencing is incomplete.
- Fix: add pure `moveLayer` / `reorderLayer`, undo-tracked store action, UI
  controls, and tests proving emitted group sequence changes.

### P2 Robustness - `.lf2` deserialization uses broad casting

- Path: `src/io/project/deserialize-project.ts:115`.
- Trigger: malformed or older project file with bad nested field types.
- Failure mode: partial normalization followed by `as unknown as Project`.
- Consequence: bad local files can enter state and fail later.
- Fix: add field-level schema validation, migrations, clamps, and clear import
  errors.

### P2 Performance - Convert-to-bitmap still uses `canvas.toDataURL()`

- Path: `src/ui/raster/luma-bitmap.ts:82`.
- Trigger: large but budget-accepted Convert to Bitmap output.
- Failure mode: production encode creates a base64 data URL string in memory.
- Consequence: residual memory pressure remains.
- Research basis: MDN warns `toDataURL()` stores the whole image as an
  in-memory string and recommends `toBlob()` / object URLs for large images.
- Fix: move encode toward `toBlob()` or worker/offscreen-canvas encoding while
  preserving project-save semantics.

### P2/P3 Product Parity - Offset Fill and shape authoring are absent

- Paths: `src/core/scene/layer.ts`, `src/core/job/fill-hatching.ts`,
  scene/object model.
- Trigger: operator wants LightBurn-style Offset Fill or built-in rectangle /
  ellipse / primitive authoring.
- Failure mode: model supports imported paths, text, and raster; fill is
  hatch-only.
- Consequence: useful LightBurn workflows remain outside current scope.
- Fix: keep lower priority than resume safety, raster quality, Trace, Convert
  to Bitmap, Start From, and SVG import. Offset Fill needs a guarded polygon
  offset implementation and performance caps.

## Strengths To Preserve

- G-code laser-off travel invariants are tested at emitted-byte level.
- Modal S handling for fill/raster is deliberate and well covered.
- GRBL error/alarm states are terminal in current streamer tests.
- Disconnect warning copy is honest about buffered GRBL motion and physical
  E-stop/power cutoff.
- Pre-emit raster budget checks are wired into production paths.
- Electron shell has strong default hardening: sandbox, context isolation,
  disabled Node integration, trusted-origin checks, and CSP tests.
- Pure-core boundaries are mostly clean and easy to test.

## Combined Fix Order

1. Fix Prettier format gate.
2. Fix `resumeJob` follow-up write with a regression test.
3. Add raster engrave quality controls:
   - more dither modes,
   - Min/Max Power or min-power floor,
   - tonal adjustment on the engrave path.
4. Finish Convert to Bitmap LightBurn parity:
   - Render Type,
   - DPI,
   - Outlines,
   - Use Cut Settings.
5. Realign Trace UI to LightBurn Trace Image controls.
6. Wire Start From / Job Origin UI and state through Preview, Frame, Start,
   and Save.
7. Fix SVG import parity for fill-only art, units, rounded rects, and local
   reuse.
8. Add layer reordering.
9. Run and archive hardware verification evidence.
10. Tackle lower-priority Offset Fill and shape authoring after the above.

## Score Movement

- **7.5 now:** strong foundations, one P1 streamer gap, failed format gate,
  and clear LightBurn parity debt.
- **8.0:** format gate fixed, `resumeJob` fixed, and one major LightBurn lane
  completed.
- **8.5:** Trace and Convert to Bitmap parity complete, raster quality controls
  improved, and hardware evidence captured for current safety/raster paths.
- **9.0+:** SVG import robust, Start From / Job Origin complete, layer ordering
  complete, hardware verification repeatable, and no known P1s.
