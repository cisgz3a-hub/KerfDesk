# Karpathy LightBurn Whole-Repo Rating Audit

Date: 2026-06-04

Repo audited: `C:\Users\Asus\LaserForge-2.0`

Branch: `wip/checkpoint-2026-06-03`

HEAD: `473aa21 fix: stabilize bitmap burn output`

Verdict: **7.5 / 10**

Short version: LaserForge 2.0 is now a credible, test-backed laser workflow
prototype. The image/raster safety work is much stronger than earlier today,
and the core output path is in decent shape. It is not yet a clean production
release candidate because the committed tree fails the existing format gate,
one resume-stream write path is still unprotected, several LightBurn-critical
workflow controls are missing, and the hardware proof ledger is incomplete.

## Audit Method

I used the prompt saved at
`audit/prompts/karpathy-lightburn-rating-audit-prompt-2026-06-04.md`.

The audit compared current code and commands against:

- Local project truth: `CLAUDE.md`, `PROJECT.md`, `WORKFLOW.md`,
  `DECISIONS.md`, `AUDIT.md`, current roadmap docs, and prior audit reports.
- Official LightBurn docs for Trace Image, Convert to Bitmap, Layer Modes,
  Image Mode, Coordinates / Job Origin, Overscanning, and Job Control.
- GRBL streaming and realtime-command references.
- MDN Canvas `toDataURL` guidance.
- Electron security guidance.

## Command Evidence

| Check | Result |
| --- | --- |
| `git status --short --branch --untracked-files=all` | clean branch view before report files |
| `git log -1 --oneline` | `473aa21 fix: stabilize bitmap burn output` |
| `npm.cmd run guard:repo` | pass, canonical LaserForge-2.0 checkout |
| `npm.cmd run typecheck` | pass |
| `npm.cmd run lint` | pass with existing boundaries selector warning |
| `npm.cmd test` | pass, 135 files / 1011 tests |
| `npm.cmd run build` | pass, Vite chunk warnings only |
| `npm.cmd run lint:electron` | pass |
| `npm.cmd run format:check` | **fail**, 9 files need Prettier |

The failed format gate matters because CI and deploy workflows call
`pnpm format:check` at `.github/workflows/ci.yml:55` and
`.github/workflows/deploy.yml:78`; `package.json:20` defines it as
`prettier --check .`.

## Category Scores

| Area | Score | Reason |
| --- | ---: | --- |
| Repo identity and workflow discipline | 8.0 | `guard:repo` is good and the current checkout is clearly LaserForge-2.0. The old-repo confusion is now guarded, but branch/deploy naming remains operationally sensitive. |
| Tests/build/type/lint | 8.0 | Typecheck, lint, build, Electron lint, and full tests pass. Format gate failure prevents a clean CI/deploy score. |
| Safety, GRBL, and output correctness | 7.5 | Shared preflight/output path, GRBL streamer handling, disconnect warning work, and laser-off travel invariants are strong. The resume follow-up write gap and hardware proof debt keep this below 8. |
| Raster/image/trace fidelity | 6.5 | Recent bitmap orientation and freeze guards are good. Trace UI and Convert to Bitmap are still not LightBurn-equivalent. |
| LightBurn workflow parity | 6.0 | Core workflows exist, but Trace controls, Convert to Bitmap dialog, Start From / Job Origin, SVG import behavior, and layer settings are materially behind LightBurn. |
| Security and deploy posture | 8.5 | SVG sanitization, Electron hardening, CSP/headers, and deploy routing tests are good. No current security red flag found in this pass. |
| Maintainability | 8.0 | File-size guard, many focused tests, and audit docs are good. Some roadmap/audit duplication and staged feature comments still need consolidation. |

## Accepted Findings

### P0 - Release gate is currently broken by formatting

- Path: `package.json:20`, `.github/workflows/ci.yml:55`,
  `.github/workflows/deploy.yml:78`.
- Trigger: run `npm.cmd run format:check`, or push into the GitHub/Cloudflare
  workflow that runs `pnpm format:check`.
- Failure mode: Prettier reports 9 files with style drift:
  `audit/findings/lightburn-parity-codex-verification-2026-06-03.json`,
  `src/core/job/fill-sweeps.ts`, `src/core/job/toolpath.test.ts`,
  `src/core/job/toolpath.ts`,
  `src/core/output/grbl-strategy.fill-power-mode.test.ts`,
  `src/core/output/grbl-strategy.property.test.ts`,
  `src/core/output/grbl-strategy.test.ts`,
  `src/io/gcode/prepare-output.test.ts`,
  `src/ui/workspace/draw-preview.parity.test.ts`.
- Consequence: functionally green code can still fail CI/deploy.
- Severity: P0 release gate.
- Confidence: high, reproduced locally.
- Fix: run Prettier on exactly those files, review the diff, rerun
  `npm.cmd run format:check`, then rerun the focused output tests plus the
  normal verification bundle.

### P1 - Resume can commit phantom in-flight bytes if the follow-up write fails

- Path: `src/ui/state/laser-store.ts:389-412`.
- Trigger: job is paused, operator clicks Resume, the realtime resume byte
  write succeeds, then the follow-up `safeWrite(toSend)` for newly available
  queued G-code fails.
- Failure mode: `resumeJob` correctly wraps the `RT_RESUME` write, but after
  that it commits `step(resumeStreamer(...))` through a functional `set`, stores
  `toSend`, and writes `toSend` without a try/catch. If that second write
  fails, streamer state can count bytes as in-flight even though they did not
  reach GRBL.
- Consequence: the stream can stall with phantom in-flight bytes and no
  operator-facing resume failure notice. This is P1, not P0, because it starts
  from a paused job, but it is still safety-adjacent: after `RT_RESUME`, GRBL
  may continue executing buffered commands while the host state has drifted.
- Severity: P1 safety-adjacent correctness.
- Confidence: high, verified against live code.
- Research: GRBL streaming docs require the host to maintain honest
  character-counted buffer accounting; GRBL buffering also means the operator
  needs honest status when the host cannot continue streaming.
- Fix: wrap the follow-up `safeWrite(toSend)` in try/catch. On failure, mirror
  the active-stream follow-up-write failure path: mark the stream
  disconnected/failed, raise a clear resume/disconnect safety notice, and add a
  regression test for "resume follow-up write fails after streamer state was
  advanced".

### P1 - Trace UI is not yet LightBurn-aligned

- Path: `src/ui/trace/ImportImageDialog.tsx:150-151`,
  `src/ui/trace/dialog-parts.tsx:13-18`,
  `src/ui/trace/AdjustmentControls.tsx:30`,
  `src/core/trace/potrace-params.ts:30`,
  `src/core/trace/trace-image.ts:357`.
- Trigger: operator imports an image and opens Trace.
- Failure mode: the UI still exposes preset/image-adjustment controls in the
  Trace dialog. Core code has some LightBurn-style cutoff/threshold foundation,
  but the operator workflow is not the LightBurn Trace Image workflow.
- Consequence: users cannot tune trace results using the same controls and
  mental model as LightBurn: cutoff, threshold, ignore small regions,
  smoothness, optimize, trace transparency, and related preview controls.
- Severity: P1 workflow/fidelity.
- Confidence: high.
- Research: LightBurn Trace Image docs describe the dedicated trace controls;
  LightBurn Adjust Image is a separate image-adjustment workflow.
- Fix: implement ADR-030 in staged UI work: replace preset-first trace control
  with LightBurn-style trace settings, keep image adjustment separate, and add
  source/provenance tests.

### P1 - Convert to Bitmap is still Fill-All only and lacks the LightBurn dialog

- Path: `src/ui/common/Toolbar.tsx:186-223`,
  `src/ui/raster/vector-to-bitmap.ts:1-16`,
  `src/core/raster/rasterize-vector.ts:1-16`.
- Trigger: operator selects a vector/text/traced object and clicks Convert to
  Bitmap.
- Failure mode: the command immediately converts using the current Fill-All
  path and default density logic. There is no render type picker and no user
  DPI control.
- Consequence: open line art or "use cut settings" conversions cannot match
  LightBurn's Convert to Bitmap workflow. Operators also cannot choose the
  output density intentionally.
- Severity: P1 workflow/fidelity.
- Confidence: high.
- Research: LightBurn Convert to Bitmap exposes Render Type options
  `Outlines`, `Fill All`, and `Use Cut Settings`, plus explicit DPI.
- Fix: add a Convert to Bitmap dialog with render type and DPI, then implement
  Outlines and Use Cut Settings as separate tested paths.

### P1 - SVG fill-only artwork is still intentionally dropped

- Path: `src/io/svg/parse-svg.ts:8-10`,
  `src/io/svg/parse-svg.ts:180`,
  `src/io/svg/parse-svg-presentation-state.test.ts:8`.
- Trigger: import a normal logo SVG where shapes use `fill` but no `stroke`.
- Failure mode: parser uses stroke color as the drawable layer key and skips
  fill-only geometry. The test suite pins this behavior.
- Consequence: common logo art can import as blank or incomplete compared with
  LightBurn-style SVG import expectations.
- Severity: P1 import correctness.
- Confidence: high.
- Research: LightBurn layer/mode docs treat imported vectors as geometry whose
  output mode is later controlled by layer operation; filled artwork should not
  silently disappear at import.
- Fix: import fill geometry as closed paths with a fill-derived color/layer
  while preserving mode-driven output behavior.

### P1 - SVG physical sizing and local reuse are incomplete

- Path: `src/io/svg/parse-svg.ts:93-103`,
  `src/io/svg/shape-to-polylines.ts:8`,
  `src/io/svg/shape-to-polylines.ts:97`,
  `src/io/svg/sanitize.test.ts:47-57`.
- Trigger: SVG uses physical units like `mm`, `in`, `pt`, rounded rectangles,
  or local `<use href="#id">` / `<symbol>` reuse.
- Failure mode: view width/height are parsed with `Number.parseFloat`,
  rounded rectangles are treated as sharp corners, and local reuse expansion is
  not implemented.
- Consequence: imported size, repeated logo elements, and corner geometry can
  differ from the designer's file and from LightBurn.
- Severity: P1/P2 import fidelity.
- Confidence: high.
- Fix: add SVG length-unit parsing, local sanitized `<use>` expansion, and
  rounded-rect geometry support with fixtures.

### P1 - Layer/image settings are narrower than LightBurn's production workflow

- Path: `src/core/scene/layer.ts:8`,
  `src/core/scene/layer.ts:14`,
  `src/core/scene/layer.ts:45-46`,
  `src/ui/layers/LayerRow.tsx`.
- Trigger: operator tries to reproduce a LightBurn burn recipe or tune photo /
  small-text output.
- Failure mode: LaserForge has `line | fill | image`, only three image
  algorithms, and a single power value. It lacks Offset Fill, Min/Max Power,
  most LightBurn image modes, image scan angle, pass-through, negative image,
  dot-width style controls, and richer cut/layer ordering controls.
- Consequence: successful burns are possible, but exact recipe transfer from
  LightBurn remains limited.
- Severity: P1/P2 product parity.
- Confidence: high.
- Research: LightBurn Layer Modes and Image Mode docs list additional layer
  operations and image settings used in real burn tuning.
- Fix: prioritize Min/Max Power and richer image mode support before broad
  convenience controls; keep Offset Fill and advanced optimization as later
  scoped features.

### P1 - Hardware verification debt is still real

- Path: `PROJECT.md` Phase F notes, `WORKFLOW.md` hardware verification
  checklist, `DECISIONS.md` pending hardware notes.
- Trigger: calling the safety/raster/origin work "proven" from tests alone.
- Failure mode: software tests prove structure and emitted code, not actual
  Falcon behavior, mechanical alignment, burn quality, or disconnect behavior
  under supervision.
- Consequence: the app may behave correctly in code while still needing
  documented physical proof for production claims.
- Severity: P1 safety/process.
- Confidence: high.
- Research: LightBurn Job Control guidance and GRBL buffering docs both support
  honest operator warnings and hardware-stop requirements.
- Fix: run the documented low-power hardware smoke tests, save exported G-code,
  screenshots, photos, and serial logs under `audit/evidence/`.

### P2 - `.lf2` deserialization still relies on broad casting

- Path: `src/io/project/deserialize-project.ts:115`.
- Trigger: opening malformed or older project files with invalid nested field
  types.
- Failure mode: normalization repairs some known additive fields, then casts
  `normalized as unknown as Project` instead of validating every nested field.
- Consequence: bad local files can put invalid objects/numbers into state and
  fail later in the workflow.
- Severity: P2 robustness.
- Confidence: medium-high.
- Fix: add a project schema validator/migrator with field-level clamps and
  human-readable import errors.

### P2 - Convert-to-bitmap encoding still uses `canvas.toDataURL`

- Path: `src/ui/raster/luma-bitmap.ts:82`.
- Trigger: converting a large but budget-accepted vector bitmap.
- Failure mode: the newer budget guard reduces risk, but production encoding
  still creates a full base64 data URL in memory.
- Consequence: residual memory pressure remains for large conversions.
- Severity: P2 performance.
- Confidence: medium.
- Research: MDN warns that `toDataURL()` encodes the whole image into an
  in-memory string and recommends `toBlob()` / object URLs for large images.
- Fix: move production encode toward `toBlob()` or worker/offscreen-canvas
  encoding while preserving project save behavior.

## Rejected Or Stale Findings

- "Wrong repo": rejected for this checkout. `guard:repo` passed and the remote
  points at LaserForge-2.0.
- "Trace worker unavailable for large images": rejected as a current blanket
  finding. Current tests cover worker timeout/retry and chunk-failure retry.
  Keep browser/live testing, but this is not reproduced by the current suite.
- "Start/Frame/Preview compile huge raster before budget": rejected as stale.
  Current tests include `start-frame-raster-budget.test.tsx`,
  `draw-raster-preview.test.ts`, and `vector-to-bitmap.test.ts`.
- "GRBL error continues streaming": rejected as stale in current code; the
  current full suite includes streamer/controller error tests.
- "No streamer safety issues remain": rejected. Error/alarm handling is much
  stronger now, but the `resumeJob` follow-up write path above is still a real
  P1.
- "Electron security is open": rejected in this pass. Electron lint and
  security policy tests pass; CSP and trusted-renderer policy tests exist.

## What Is Good And Worth Preserving

- `prepareOutput()` is the right shared truth for Save/Start/Preview/live
  estimate.
- Raster budget guards now exist before the expensive paths that were freezing
  the UI.
- Bitmap burn orientation has targeted test coverage and the full suite passes.
- GRBL streamer tests and safety notices are much stronger than earlier.
- SVG sanitization and Electron hardening are mature relative to the app's
  current stage.
- The repo has enough focused tests that changes can be made surgically.

## Recommended Next Fix Order

1. Run Prettier on the 9 failing files and rerun the full verification bundle.
2. Finish the LightBurn-style Convert to Bitmap dialog: Render Type + DPI.
3. Realign Trace UI to LightBurn Trace Image controls.
4. Fix SVG import parity for fill-only art, physical units, rounded rectangles,
   and local `<use>`.
5. Add the highest-value layer/image settings: Min/Max Power and more image
   modes before lower-value UI polish.
6. Run and archive the hardware smoke-test evidence for raster, fill, origin,
   disconnect warning, Frame, and Stop behavior.

## Final Rating Rationale

I would not score this below 7 because the current codebase passes typecheck,
lint, build, Electron lint, and 1011 tests, and the safety/output core is much
better than the earlier unstable state. I would not score it above 8 because a
release gate fails today, `resumeJob` has one real safety-adjacent write gap,
key LightBurn workflow parity is incomplete, and hardware verification is still
not complete.

Current score: **7.5 / 10**.

Move to 8.0: fix the format gate and complete one of Trace UI or Convert to
Bitmap parity.

Move to 8.5: fix both Trace and Convert to Bitmap parity, and archive hardware
proof for the current raster/origin/safety paths.

Move toward 9: add reliable SVG parity, richer layer/image controls, and a
repeatable release/hardware verification checklist that survives future Claude
and Codex branch work.
