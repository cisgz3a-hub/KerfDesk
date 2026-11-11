# D2 — single choke points (code quality audit C2)

**Question.** Does every rule that must hold on every output route live in ONE place that every route passes through?
**Tree.** `origin/main` @ `dcca5b8c4` (git archive `j28-main`, read-only). All file:line anchors below are on that tree.
**Method.** Rules from PROJECT.md non-negotiables (7, 9, 21), ADR-040, ADR-127 Amd 2, ADR-228, ADR-492, ADR-565, ADR-697, ADR-705. Each rule was traced through every output route to either a shared choke point or a per-route copy. Every divergence below was then driven with the SAME small job through each route (Node scripts on the real modules, `zz-d2/register.mjs` loader). Output was read back with this audit's own G-code reader, its own Ruida byte reader (unswizzle, then every byte ≥ 0x80 starts a command), and the repo's `decodeMoshiProgram`.

## Headline

The G-code family is one choke point and holds: grbl 1.1, grblHAL, FluidNC, Marlin and Smoothieware emit byte-for-byte the same lit geometry, the same rotary feeds, the same tab power share and the same Fill scan offset (R7), because Marlin and Smoothieware wrap `grblStrategy`. Compile-time rules (origin corner, cut order, tabs, leads, focus-test refusal, the rotary scan-along-X rule, compile-integrity refusals) also sit in `prepareOutput` and reach every route.

The failures are all on the **network routes** (Moshi USB, Ruida UDP, and partly Save `.rd`). They call `prepareOutput` with their own option sets and then apply rules of their own. Four rules that live outside `prepareOutput` never reach them:
- **Selected artwork only** (P1). Moshi Start/Frame and Ruida UDP Start/Frame call `prepareOutput` without the output scope, so they burn every object while the canvas preview, Save G-code, Save `.rd` and G-code Start burn only the selection.
- **Rotary surface feed** (P1). The `.rd` writer scales a Y-port rotary job into machine space but writes one speed per layer. Strokes round an Ø80 glass on a 40 mm/turn chuck burn at 15.9 % of the set dose, and at 31.8 % on 80 mm/turn. There is no advisory. It is the Ruida twin of Z3-P1-2.
- **Fill scan offset** (P1, extends D1-P1-2 to Fill). The Moshi Fill planner ignores both the layer's offset and the device speed table.
- **Job warnings** (P2). `detectMachineJobWarnings` (compile diagnostics such as "missing from the job and will NOT be cut", cut order, scan-offset coverage) runs only for Save G-code, the tiled export and G-code Start.

Two smaller rules are also missing:
- **Moshi power levels** (P2). The Moshi encoder warns when raster grey levels burn as one, but burned tabs and score layers burn at dial power with no warning.
- **Variable advance after a completed job** (P2).

## Rule × route matrix

Cells: ✓ shared = the route passes through the named choke point; **copy** = the route has its own implementation; **MISSING** = the route skips the rule; n/a = the rule cannot apply (the route refuses the case, or the route has no such output). "G-code" covers grbl 1.1, grblHAL, FluidNC, Marlin and Smoothieware, which R7 showed to be identical.

| # | Rule | Choke point (dcca5b8c4) | G-code (5 dialects) Save + Start | CNC G-code | Ruida Save `.rd` | Ruida UDP | Moshi USB | Preview / ETA / inspector | Remote Start | Start from line / resume |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Output scope ("Selected artwork only", selection anchor) | `io/gcode/prepare-output.ts:146` (`validateOutputScope`) | ✓ shared | ✓ shared | ✓ shared (`ui/app/save-rd-action.ts:46`) | **MISSING** (`ui/state/ruida-network/ruida-network-job.ts:70-76`) D2-P1-1 | **MISSING** (`ui/state/moshi-usb/moshi-usb-job.ts:25`) D2-P1-1 | ✓ shared (`ui/workspace/draw-preview.ts:145-167`) | ✓ shared (G-code permit) | ✓ shared (`ui/laser/manual-restart-source.ts:111`) |
| 2 | Power range / S scaling | `core/output/grbl-strategy.ts` + `grbl-power-modes.ts`; Marlin and Smoothie wrap it (`marlin-strategy.ts:32`, `smoothieware-strategy.ts:66`) | ✓ shared (R7) | n/a (row 30) | copy: % per layer, min = max (`core/controllers/ruida/rd-job-writer.ts:129-164`); power mode ignored (D2-P3-3) | copy (same bytes) | n/a, no power control; vector levels silent: **MISSING** notice, D2-P2-2 | ✓ shared | ✓ | ✓ |
| 3 | Start power (fires at all) | `core/job/job-start-power.ts:21-24` (per-kind branches) | ✓ shared | ✓ | ✓ shared | ✓ shared | ✓ shared | ✓ | ✓ | ✓ |
| 4 | Laser off at end and at stop | G-code finish in `grbl-strategy.ts`; `.rd` `layerEnd`; Moshi estop | ✓ shared | ✓ shared | copy | copy; Abort reachability KNOWN D1-P2-5 | copy; Abort reachability KNOWN D1-P2-5 | n/a | ✓ | ✓ |
| 5 | Bed bounds and no-go zones (advisory, rule 7) | `core/preflight` `runPreflight` (`io/gcode/emit-gcode.ts:283`) | ✓ shared | copy (`runCncPreflight`, `emit-gcode.ts:273`) | ✓ shared (`io/rd/rd-preflight.ts:38`) | ✓ shared, shown only after send: KNOWN D1-P2-1 | ✓ shared (`io/moshi/moshi-preflight.ts:30`), shown only after send: KNOWN D1-P2-1 | ✓ | ✓ | ✓ |
| 6 | Compile-integrity refusals only | `core/preflight/blocking-codes.ts` via `prepare-output.ts:184-196` | ✓ shared | ✓ shared | ✓ shared | ✓ shared | ✓ shared | ✓ | ✓ | ✓ |
| 7 | Rotary wrap limit (one turn) | `rotaryWrapLimitMm` | ✓ (`emit-gcode.ts:305`) | n/a | copy (`rd-preflight.ts:35-37`) | copy | copy (`moshi-preflight.ts:27-29`) | ✓ | ✓ | ✓ |
| 8 | Rotary on A/Z: no program | `io/gcode/rotary-axis-emit.ts` | ✓ shared (`routeRotaryAxisBody`) | n/a | ✓ shared refusal (`io/rd/emit-rd.ts:63-69`) | ✓ shared | ✓ shared refusal (`io/moshi/emit-moshi.ts:40-42`) | ✓ | ✓ | ✓ |
| 9 | Rotary: rows scan along X (ADR-492 D9) | compile diagnostics `image-scan-angle-rotary` / `fill-ramp-scan-angle-rotary` (`core/job/job.ts`) | ✓ shared (Z3-P1-1 fix present) | n/a | n/a (Fill/Image refused, R6) | n/a | ✓ shared, plus copy: refuses angled raster (`moshi-job-encoder.ts:79-80`) | ✓ | ✓ | ✓ |
| 10 | Rotary surface feed (ADR-127 Amd 2) | `core/output/rotary-surface-feed.ts:32` (`rotaryFeedMatchFor`) | ✓ shared (`grbl-strategy.ts:439`) | n/a | **MISSING** (`emit-rd.ts:73-82`, one `speedLaser1` per layer `rd-job-writer.ts:158`) D2-P1-2 | **MISSING** D2-P1-2 | copy (`moshi-job-encoder.ts:72`, `moshi-rotary-feed.ts`); Z3-P1-2 fixed, R2 shows 80–106 % and announced | copy: ETA follows the G-code fallback, not `.rd` | ✓ | ✓ |
| 11 | Rotary row-step check | `ui/laser/job-review/rotary-row-step-warnings.ts:64` (Job Review only) | Start ✓; Save G-code MISSING (P3 note in D2-P2-1) | n/a | n/a (no rows on `.rd`) | n/a | **MISSING**: KNOWN Z4-P2-1 | n/a | ✓ | ✓ |
| 12 | Rotary taper warp | `machineSpaceJob` | ✓ shared (Fill loss KNOWN Z4-P1-1) | n/a | ✓ shared (`emit-rd.ts:73`) | ✓ shared | ✓ shared (`emit-moshi.ts:43`) | ✓ | ✓ | ✓ |
| 13 | Raster overscan run-up laser-off | `RasterGroup.overscanMm` set in compile; emitted by `emit-raster-sweep` | ✓ shared | n/a | n/a (refused) | n/a | copy, burns the run-up: KNOWN D1-P1-1 (`moshi-raster-plan.ts:229-236`) | ✓ | ✓ | ✓ |
| 14 | Dot width correction (Image) | `grbl-strategy.ts:333` | ✓ shared | n/a | n/a (refused, R6) | n/a | **MISSING**: KNOWN D1-P1-2 | ✓ | ✓ | ✓ |
| 15 | Bidirectional scan offset (Image) | `grbl-strategy.ts:335` | ✓ shared | n/a | n/a (refused, R6) | n/a | **MISSING**: KNOWN D1-P1-2 | ✓ | ✓ | ✓ |
| 16 | Bidirectional scan offset (Fill) | `core/job/fill-sweep-plan.ts:47-48, 80-93` via `core/output/grbl-fill-emission.ts:71-73` | ✓ shared (R7) | n/a | n/a (refused, R6) | n/a | **MISSING** (`moshi-vector-plan.ts:31-48`) D2-P1-3 | ✓ | ✓ | ✓ |
| 17 | Fill runway policy and segment filter | `fill-sweep-plan.ts:47-78` | ✓ shared | n/a | n/a | n/a | copy, disagrees: `withRunways` always uses full overscan and ignores `fillRunwayPolicy` (`moshi-vector-plan.ts:50-69`) D2-P3-2; 2-point filter disagreement KNOWN Z4-P1-1 | ✓ | ✓ | ✓ |
| 18 | Dither, gamma, tone, negative | compile raster (`core/job/compile-job-raster*.ts`) | ✓ shared | n/a | n/a | n/a | ✓ shared (grey note `moshi-job-encoder.ts:101-105`) | ✓ | ✓ | ✓ |
| 19 | Origin modes (Absolute, User Origin, Current Position) | `prepare-output.ts` `resolvedOutputOffset`; `ui/job-placement.ts` `resolveExportJobPlacement` | ✓ shared | ✓ shared | copy: reference-point mode (`core/controllers/ruida/rd-encoder.ts:103-114`) | copy: Current Position refused (`ruida-network-job.ts:64-65`) | copy: Absolute only (`moshi-usb-job.ts:24`) | ✓ | ✓ | ✓ |
| 20 | Origin corner / mirror | compile `toMachineCoords(point, device)` | ✓ shared | ✓ shared | ✓ shared | ✓ shared | ✓ shared | ✓ | ✓ | ✓ |
| 21 | Air assist | `core/output/air-assist-hold.ts`, `air-keep-alive.ts` | ✓ shared | ✓ (coolant) | copy per layer (`rd-job-writer.ts:157`) | copy | n/a, no output and no note (D2-P3-3) | ✓ | ✓ | ✓ |
| 22 | Layer order, cut last, path order | `prepare-output.ts` `optimizePaths` / `applyJobStartPoint` | ✓ shared | ✓ shared | ✓ shared | ✓ shared | ✓ shared | ✓ | ✓ | ✓ |
| 23 | Passes, overcut final pass | `core/job/cut-pass-segments.ts` (helpers); loops per route | ✓ shared | ✓ | copy loop (`rd-motion-plan.ts:220-226`) using the shared helper | copy | copy loops (`moshi-vector-plan.ts:17-24, 34-46`, `moshi-raster-plan.ts:215`); the copies agree | ✓ | ✓ | ✓ |
| 24 | Tabs: geometry | compile `line-tabs` | ✓ shared | ✓ (CNC tabs) | ✓ shared | ✓ shared | ✓ shared | ✓ | ✓ | ✓ |
| 25 | Tabs: burned-tab power share | `CutGroup.tabSpanPowerPercent` (`core/job/job.ts:124`) → group power | ✓ shared (R7: 0.16 of 0.80) | n/a | ✓ shared (group power) | ✓ shared | **MISSING** (`moshi-vector-plan.ts:16`, `fires = power > 0`) D2-P2-2 | ✓ | ✓ | ✓ |
| 26 | Laser leads | `prepare-output.ts` `applyLaserLeads` | ✓ shared | n/a | ✓ shared | ✓ shared | ✓ shared | ✓ | ✓ | ✓ |
| 27 | Focus Test Z needs a GRBL-family controller | `core/job/compile-job.ts:131-133` (`focusTestProfileIssue`) | ✓ shared | ✓ shared (`focus-test-needs-laser`) | ✓ shared refusal | ✓ shared refusal | ✓ shared refusal | ✓ | ✓ | ✓ |
| 28 | Laser finish position (ADR-493) | `prepare-output.ts` `placeLaserFinish` → G-code finish | ✓ shared | ✓ (CNC park) | **MISSING**, silent (D2-P3-3) | **MISSING** | **MISSING** | n/a | ✓ | ✓ |
| 29 | Job warnings: compile diagnostics, cut order, scan-offset coverage, stacked copies | `ui/laser/machine-job-warnings.ts:41` (`detectMachineJobWarnings`) | ✓ shared (`ui/app/save-gcode-emission.ts:172`, `ui/laser/output-preparation.ts:69,123`) | ✓ shared | **MISSING** (`emit-rd.ts:92`) D2-P2-1 | **MISSING** D2-P2-1 | **MISSING** (`emit-moshi.ts:47-51`) D2-P2-1 | n/a | ✓ | ✓ |
| 30 | Job Review detectors (row step, rotary axis rate, min feature, burning white, rotary raster) | `ui/laser/job-review/job-review-model.ts` | Start ✓; Save G-code MISSING (P3 note) | ✓ | MISSING (known shape) | **MISSING**: KNOWN D1-P2-1 / Z4-P2-1 | **MISSING**: KNOWN D1-P2-1 / Z4-P2-1 | n/a | ✓ (`machineReviewPresenter`) | ✓ |
| 31 | Frame permit (NN 21: envelope, placement and coordinate identity) | `ui/laser/frame-spatial-identity.ts:32` + framed-run permit | ✓ shared | ✓ shared | n/a (file) | copy, bounding box only (`ruida-network-store.ts:180`) D2-P3-1 | copy, bounding box only (`moshi-usb-store.ts:101`, `moshi-frame.ts:15-18`) D2-P3-1 | n/a | ✓ (`runFramedPermitStart`) | ✓ |
| 32 | Abort always reachable (NN 9) | `ui/laser/use-job-shortcuts.ts:92-117` | ✓ | ✓ | n/a | **MISSING**: KNOWN D1-P2-5 | **MISSING**: KNOWN D1-P2-5 | n/a | ✓ | ✓ |
| 33 | "A job is running" guards (close, Update, Setup save, project open) | `desktop-close-runtime.ts:31-44` etc. read `useLaserStore` only | ✓ | ✓ | n/a | **MISSING**: KNOWN D1-P2-3 | **MISSING**: KNOWN D1-P2-3 | n/a | ✓ | ✓ |
| 34 | Variable text advance "After completed job" | `ui/laser/start-job-transmission.ts:78` (`armVariableStreamAdvancement`) | ✓ shared | ✓ | n/a (export advance ✓, `save-rd-action.ts:120`) | **MISSING** D2-P2-3 | **MISSING** D2-P2-3 | n/a | ✓ | ✓ |
| 35 | CNC spindle range, tool changes | `core/output/cnc-grbl-strategy.ts`, CNC preflight | n/a | ✓ shared (READ) | n/a, CNC refused (`rd-encoder.ts:76-78`) | n/a, refused | n/a, refused (`moshi-job-encoder.ts:77-78`) | ✓ | ✓ | ✓ |
| 36 | Preview = output (ADR-040) | `prepareOutput` + the GRBL fallback emitter (`select-output-strategy.ts:31-33`) | ✓ | ✓ | diverges via rows 10, 28 | diverges via rows 1, 10, 28 | diverges via rows 1, 13-16, 25, 28 | — | ✓ | ✓ |

SVG, DXF and other design exports carry artwork, not machine rules. Every row above is n/a for them.

## Findings

### D2-P1-1 — "Selected artwork only" is ignored by Moshi USB and Ruida UDP Frame and Start

- **Where:**
  - `ui/state/moshi-usb/moshi-usb-job.ts:25` calls `prepareOutput(project, {})`;
  - `ui/state/ruida-network/ruida-network-job.ts:70-76` builds options with `jobOrigin` only;
  - the callers `ui/moshi-usb/MoshiUsbDetails.tsx:83-84` and `ui/ruida-network/RuidaNetworkDetails.tsx:106-107` read `project` and `jobPlacement` from the store, but never `currentOutputScope`.
  - The choke point is `io/gcode/prepare-output.ts:146`.
  - The checkbox is `ui/laser/JobPlacementControls.tsx:110-121`, in the same Laser window as the Moshi and Ruida panels.
- **Anchor:** the output scope (LightBurn "Cut Selected Graphics", ADR-327) and preview = output (ADR-040).
- **Evidence:** **REPRO** `zz-d2/r1-output-scope.mts` → `zz-d2/out/r1-output-scope.txt`. A is a 20 mm square at X 20–40 and is selected; B is at X 100–120. The checkbox is on, and the scope is built with the store's own `currentOutputScope`.
  - The G-code compile with the scope burns X 20.00–40.00 only.
  - `prepareMoshiUsbJob` burns **X 19.99–119.99**: both squares.
  - `prepareRuidaNetworkJob` burns machine X **780–880** (both). Save `.rd` with the scope burns 860–880 (A only).
- **Scenario:** a Moshi or Ruida (network) user ticks "Selected artwork only" to burn one tag from a sheet of designs. The canvas preview and ETA show one tag; the Frame traces a box round everything (a visible result, not a warning); Start burns every design on the sheet into the material. "Anchor from selected artwork" is ignored too.
- **Severity:** P1. It burns artwork the operator excluded, with no warning (METHOD §3).
- **Announced?** No. Neither route mentions the scope.
- **Novelty:** New. Not in D1, v14 or the ledgers.
- **Fix direction:** pass `currentOutputScope(app)` into both job builders. Better, give the network builders one shared "start output options" function (scope, placement, `laserMaxPowerS` where it applies) that G-code Start already uses, so a new route cannot build its own option set. Add a test per route with the scope on.

### D2-P1-2 — Ruida `.rd` and Ruida UDP jobs on a Y-port rotary skip the surface-feed match

- **Where:**
  - `io/rd/emit-rd.ts:73-82` applies `machineSpaceJob` (Y scaled by k) and then `encodeRdJob`;
  - `core/controllers/ruida/rd-job-writer.ts:158` writes one `speedLaser1(group.speed)` per layer;
  - nothing calls `rotaryFeedMatchFor` (`core/output/rotary-surface-feed.ts:32`), which `grbl-strategy.ts:439` and `moshi-job-encoder.ts:72` both use.
  - `rotaryAxesForController` offers Y for Ruida (`core/devices/rotary-axis.ts:66-69`).
- **Anchor:** ADR-127 Amd 2 (X8-P1-1). This is the Ruida twin of Z3-P1-2 (Moshi, fixed by #1744).
- **Evidence:** **REPRO** `zz-d2/r2-ruida-rotary-feed.mts` → `zz-d2/out/r2-ruida-rotary-feed.txt`. A 20 mm Line square at 600 mm/min. The surface speed comes from this file's own chuck and roller model; time = commanded XY length ÷ the decoded speed record.

  | Rotary | GRBL dose on strokes round the part | Moshi | Ruida `.rd` / UDP |
  |---|---|---|---|
  | Chuck 40 mm/turn, Ø80 | 100.5 % | 79.6 % (announced) | **15.9 %**, no advisory |
  | Chuck 80 mm/turn, Ø80 | 100.5 % | 106.1 % (announced) | **31.8 %**, no advisory |
  | Geared roller, k ≈ 0.16 | 100.5 % | 79.6 % (announced) | **15.9 %**, no advisory |

  Strokes along X are 600 mm/min on every route. The `.rd` file has exactly one speed record per layer.
- **Scenario:** a Ruida CO2 with a chuck rotary on the Y port. A name engraved round a glass burns its vertical strokes at about 1/6 of the energy of its horizontal strokes, giving faint or missing letters. A geared roller with k > 1 over-burns instead (the same class as X8-P1-1). The ETA follows the G-code fallback (per-move F), so it does not match the `.rd` run either.
- **Severity:** P1. Wrong energy on the part, silent (precedent Z3-P1-2, X8-P1-1).
- **Announced?** No.
- **Novelty:** New. Z3-P1-2 covered the Moshi route only.
- **Fix direction:** match the surface speed per move in the shared choke point.
  - Either split each layer into one `.rd` part per matched speed, as `moshiSurfaceSpeedRuns` does: one helper used by both encoders, ideally a core `rotaryFeedRuns(steps, match)` that GRBL, Moshi and Ruida all call.
  - Or refuse a Y-rotary `.rd` until it does.
  - Add an `.rd` decoded-speed test on a k ≠ 1 rotary.

### D2-P1-3 — The Moshi Fill planner ignores the bidirectional scan offset (layer value and device speed table)

- **Where:** `core/controllers/moshi/moshi-vector-plan.ts:31-48` (`planFillGroupSteps`) burns `segment.polyline` as is. The G-code route shifts reverse sweeps through `core/job/fill-sweep-plan.ts:47-48, 80-93` (`segmentsWithScanOffset`), called from `core/output/grbl-fill-emission.ts:71-73` with `group.bidirectionalScanOffsetMm ?? offsetForSpeed(device.scanningOffsets, feed)`.
- **Anchor:** the scan-offset rule (ADR-020 family; `core/job/scan-offset.ts`). D1-P1-2 found the same gap for Image layers only.
- **Evidence:** **REPRO** `zz-d2/r3-fill-scan-offset.mts` → `zz-d2/out/r3-fill-scan-offset.txt`. A 20 × 5 mm Fill at 3000 mm/min, 1 mm hatch, bidirectional.

  | Offset source | GRBL reverse sweep | Moshi reverse sweep |
  |---|---|---|
  | Layer offset 0.4 mm | 69.60 → 49.60 | **70.00 → 50.01** |
  | Device table 0.4 mm at 3000 mm/min | 69.60 → 49.60 | **70.00 → 50.01** |
  | No offset (control) | 70.00 → 50.00 | 70.00 → 50.01 |

  No advisory is raised.
- **Scenario:** a Moshi user who calibrated scan offset on Fill sees ragged left and right edges on every bidirectional Fill, while the same job on G-code is clean.
- **Severity:** P1, for consistency with D1-P1-2 (sub-millimetre, but silently wrong position; METHOD §3 has no reach clause). The coordinator may merge it into D1-P1-2.
- **Announced?** No.
- **Novelty:** The Fill twin of D1-P1-2. The D1-P1-2 fix in flight targets `moshi-raster-plan.ts` and would leave Fill wrong.
- **Fix direction:** have `planFillGroupSteps` take its sweeps from `planFillSweeps(group, scanOffsetMm)`, the same core planner the G-code Fill uses. That carries the scan offset, the runway policy (D2-P3-2) and the segment filter in one step. Route it with D1-P1-2 to the Moshiboard session.

### D2-P2-1 — Compile diagnostics and the shared job warnings never reach Save `.rd`, Ruida UDP or Moshi

- **Where:**
  - The warnings choke point `ui/laser/machine-job-warnings.ts:41` (`detectMachineJobWarnings` → `job-intent-warnings.ts:68` → `compile-diagnostic-warnings.ts`) is called from `ui/app/save-gcode-emission.ts:172`, `ui/app/tiled-output-preparation.ts:68` and `ui/laser/output-preparation.ts:69,123` only.
  - `io/rd/emit-rd.ts:92` and `io/moshi/emit-moshi.ts:47-51` return only the pre-emit advisories, encoder notes and `runPreflight`.
  - `job.diagnostics` is never read on those routes.
- **Anchor:** rule 7 / ADR-228: findings inform on every route.
- **Evidence:** **REPRO** `zz-d2/r5-job-warnings.mts` → `zz-d2/out/r5-job-warnings.txt`. A 30 mm part with a 0.6 mm slot, Line, kerf offset 0.4 mm. The compile reports `kerf-offset-closed-up`.
  - G-code Save/Start warns: "…closed up 1 hole or slot … so it is missing from the job and will not be cut".
  - Ruida `.rd`/UDP: **0 advisories**. Moshi: **0 advisories**.
  - The same applies to every `compileDiagnosticWarnings` case: kerf failed, "contours … will NOT be cut", offset fill failed or partial, Fill ownership failed, Fill collapsed, image dropped. It also applies to cut-order and scan-offset-coverage warnings.
  - Case A (stacked copies) is a control: no route warns.
- **Scenario:** a Ruida user saves an `.rd` (or a Moshi user presses Start) on a job where kerf closed up a slot or a Follow Shape fill failed. The part comes out without the slot or fill, and the app never said so; G-code users of the same project are told.
- **Severity:** P2. It follows D1-P2-1, where late warnings were rated P2. Here the warnings are never shown at all, so the coordinator may raise it.
- **Announced?** No.
- **Novelty:** New. D1-P2-1 is about timing: the route's own advisories appear only after the job is sent. This finding is about the shared warning set never being computed. A related P3 note: the Job Review-only detectors (row 30: row step, rotary axis rate, min feature, burning white) also never run on Save G-code.
- **Fix direction:** move `detectMachineJobWarnings`' laser part (compile diagnostics, job intent) into a core function that takes `PreparedOutput` and is called inside `emitPreparedRdFile`, `emitPreparedMoshiJob` and `emitPreparedGcode`. Every route then returns the same advisory list, and D1-P2-1's "show before Start" fix has one list to show.

### D2-P2-2 — Moshi: burned tabs and score layers burn at dial power, with no job-specific warning

- **Where:** `core/controllers/moshi/moshi-vector-plan.ts:16` (`fires = group.power > 0`). The power-less note exists only for raster grey levels (`moshi-job-encoder.ts:101-105`). The tab-span group carries its reduced share in `CutGroup.tabSpanPowerPercent` (`core/job/job.ts:124`).
- **Anchor:** ADR-494 burned tabs; ADR-705 ("no software power").
- **Evidence:** **REPRO** `zz-d2/r4-moshi-power-levels.mts` → `zz-d2/out/r4-moshi-power-levels.txt`.
  - (a) A 40 mm square at 80 % with 4 burned tabs at 20 %. GRBL burns S800 for 148 mm and S160 for 12 mm. Moshi burns all 160 mm at dial power, with **0 advisories**.
  - (b) A 10 % score layer plus an 80 % cut layer. Moshi burns both at dial power, with **0 advisories**.
- **Scenario:** a Moshi user sets burned tabs to hold parts in the sheet. Every tab is cut through, and the parts drop through the honeycomb mid-job. A score layer cuts through.
- **Severity:** P2. The panel always shows the general `MOSHI_POWER_NOTE` ("Layer power above 0 only switches the beam on"), but nothing ties it to tabs or to a second layer.
- **Announced?** Generically.
- **Novelty:** New.
- **Fix direction:** one core "power the route cannot express" check over the prepared job, keyed on a capability (no power control). It names burned tabs, layers with different powers and grey rasters. The encoder's raster-only note then becomes one case of it.

### D2-P2-3 — Variable text "After completed job" never advances after a Moshi or Ruida network job

- **Where:** the only arm site is `ui/laser/start-job-transmission.ts:78` (`armVariableStreamAdvancement`, `variable-stream-advancement.ts:10-49`), which observes `useLaserStore`. `moshi-usb-store.ts` and `ruida-network-store.ts` never call `advanceVariablesAfter`. The setting's label is "After completed job" (`ui/text/VariableTextControls.tsx:108`).
- **Anchor:** ADR variable data (serial and record advance).
- **Evidence:** **READ.** `grep advanceVariablesAfter|armVariableStreamAdvancement` over `src/ui` finds only the G-code transmission and the export helpers. Save `.rd` advances on export (`save-rd-action.ts:120`).
- **Scenario:** serial-numbered tags on a Ruida over the network or a Moshi. Each completed job leaves the serial unchanged, so the next tag burns the same number.
- **Severity:** P2 (wrong content on the next part; the canvas shows the stale number).
- **Announced?** No.
- **Novelty:** New.
- **Fix direction:** advance from a route-neutral "job completed" event that every machine store emits. This is the same "machine work" query D1-P2-3 needs.

### D2-P3-1 — The Moshi and Ruida Frame permits compare bounding boxes only

- **Where:** `moshi-usb-store.ts:101` (`sameMoshiFootprint`, `core/controllers/moshi/moshi-frame.ts:15-18`) and `ruida-network-store.ts:180` (`sameRdFootprint`). The G-code permit binds the coordinate identity (`ui/laser/frame-spatial-identity.ts:32-50`).
- **Anchor:** NN 21: "a changed prepared motion envelope, placement or coordinate identity requires another Frame".
- **Evidence:** **READ.**
- **Scenario:** moving an object inside the framed box keeps Start enabled on Moshi and Ruida, but asks for a re-Frame on G-code. Nothing burns outside the traced box.
- **Severity:** P3.
- **Announced?** n/a.
- **Novelty:** New.
- **Fix direction:** key the network permits on `currentFrameSpatialSignature` as well as the footprint.

### D2-P3-2 — Rule copies that could share one implementation (two already disagree)

- **Where:**
  - The synthetic-preflight line builder and `withLayerLabel` are duplicated in `io/rd/rd-preflight.ts:25-51` and `io/moshi/moshi-preflight.ts:18-43` (they agree).
  - The rotary wrap limit is computed 3 times (`emit-gcode.ts:305`, `rd-preflight.ts:35`, `moshi-preflight.ts:27`; they agree).
  - The pass loop is written 5 times (they agree).
  - The Fill runway rule is copied as `moshi-vector-plan.ts:50-69` `withRunways`. It always uses the full overscan and ignores `fillRunwayPolicy` (it **disagrees** with `fill-sweep-plan.ts:47-78`; laser off, so no burn effect found).
  - The Fill 2-point filter **disagrees** (KNOWN Z4-P1-1).
- **Severity:** P3.
- **Fix direction:** see the structural recommendations.

### D2-P3-3 — Silent per-route no-ops

- **Where:**
  - `job.laserFinish` (ADR-493, `prepare-output.ts` `placeLaserFinish`) is dropped by `.rd`, UDP and Moshi.
  - Layer air assist has no Moshi output and no note.
  - The `.rd` writer writes min power = max power for every layer and ignores `powerMode` (`rd-job-writer.ts:129-132, 161-164`).
- **Evidence:** **READ.**
- **Severity:** P3. No burn harm was found; the head finishes elsewhere, and the air stays as wired.
- **Fix direction:** a per-driver capability list ("finish position", "air", "power mode") that the shared warning step reads, to say once what the route will not do.

## Structural recommendations

1. **One "start output options" builder.** Scope, placement, `laserMaxPowerS`, and the absolute program offset where known belong in one function in `ui/laser` (or core) that every Start, Frame and Save calls. The network routes currently build `{}` or `{jobOrigin}` by hand (D2-P1-1).
2. **Move job warnings into core, behind `PreparedOutput`.** Today the warnings live in two UI functions: `detectMachineJobWarnings` (Save and Start) and `job-review-model` (Start only). A core `jobAdvisories(prepared, capabilities)` should run inside every `emitPrepared*` and return the same list (D2-P2-1). Job Review then reads that list, and its rotary row-step, axis-rate, min-feature and burning-white detectors move with it (Z4-P2-1, D1-P2-1 and Save G-code all close at once).
3. **Shared motion planners for every encoder.** Moshi Fill and raster should take their moves from the core planners the G-code emitter uses: `planFillSweeps` (scan offset and runway policy) and the raster sweep planner (overscan laser-off, dot width, scan offset). An encoder should only turn moves into bytes (D2-P1-3, D2-P3-2, D1-P1-1, D1-P1-2).
4. **One rotary feed-run helper.** Move `moshiSurfaceSpeedRuns` into core as `rotaryFeedRuns(steps, match, quantize)`. GRBL keeps per-move F, while Moshi and Ruida emit one program or part per run (D2-P1-2).
5. **Driver capabilities, not per-encoder notes.** "No power control", "no air", "no finish", "power mode" and "no raster" should be declared once per driver. The shared advisory step words the consequences (D2-P2-2, D2-P3-3).
6. **One machine-work event bus.** Completion, running and abort should be emitted by every machine store. Variable advance, the close and Update guards and the Abort shortcut subscribe to it (D2-P2-3, D1-P2-3, D1-P2-5).
7. **One shared preflight adapter.** `runMotionPreflight(project, steps, frame)` should replace the `.rd` and Moshi line builders (D2-P3-2).

## KNOWN (not re-reported)

- **D1-P1-1:** the Moshi raster burns its run-up (row 13).
- **D1-P1-2:** the Moshi raster ignores dot width and scan offset (rows 14-15). D2-P1-3 is its Fill twin.
- **D1-P2-1:** Moshi and Ruida warnings appear only after send (rows 5, 30).
- **D1-P2-3:** close, Update and Setup-save guards ignore Moshi and Ruida (row 33).
- **D1-P2-5:** no always-reachable Abort for network jobs (rows 4, 32).
- **Z3-P1-1:** a ramped Fill missed the rotary scan rule. The fix diagnostic `fill-ramp-scan-angle-rotary` is present on main (row 9).
- **Z3-P1-2:** the Moshi rotary feed. Fixed: R2 shows the matched runs, with doses announced (row 10).
- **Z3-P2-1:** 0° Fill rows were not checked for row steps (fixed by #1745 for G-code).
- **Z4-P1-1:** the taper warp against the Fill planner's 2-point filter (rows 12, 17).
- **Z4-P2-1:** the Moshi Y-chuck row rounding, with no row-step check (row 11).

## Refuted

- **D1's hand-over note "the Ruida `.rd` writer also ignores Dot width correction and the scan offset".** On `dcca5b8c4` the `.rd` encoder refuses every Fill and Image group (`core/controllers/ruida/rd-encoder.ts:79-81`), so no `.rd` row can be misplaced. **REPRO** `zz-d2/r6-ruida-raster-refusal.mts`: both an Image (dot width 0.1, offset 0.3) and a Fill (offset 0.3) are refused with "uses Fill/Image raster output, which the experimental .rd encoder does not support yet". If raster `.rd` is ever added, recommendation 3 applies.

## Verified clean

- **The five G-code dialects share one emitter** (R7, `zz-d2/out/r7-gcode-dialects.txt`): grbl 1.1, grblHAL, FluidNC, Marlin inline and Smoothieware give the identical lit-geometry hash `c77f178c` (17 strokes, 192.7 mm), the same matched rotary F (95 mm/min on Y strokes), the same power shares (0.80, 0.16 tab, 0.40 Fill; Marlin 0.161 from 8-bit rounding) and the same Fill reverse sweep 119.60 → 99.60.
- The compile-time rules are shared by every route: origin corner, cut order and optimization, tab geometry, leads and overcut, the Focus Test controller refusal, the rotary A/Z refusal and the compile-integrity refusals.
- Bed bounds and no-go zones use one `runPreflight` on all three laser route families.
- Start power is decided per controller in one function (`job-start-power.ts`).
- Remote Start runs only through the G-code permit (`ui/remote-control/machine-execution.ts:172`, `runFramedPermitStart`), so it cannot reach a network route.
- Save `.rd` honours the output scope (R1).

## Not verified

- CNC spindle range and tool-change rules in depth (READ only; D3 and earlier CNC audits own them).
- Start from line and resume beyond confirming that they read the current scope.
- D2-P2-3 by running a store-level job (READ only).
- Real Ruida rotary behaviour: whether a Ruida controller's own rotary settings already rescale Y. The app's model (machine-space Y in the file) is the premise of D2-P1-2.
- Moshi and Ruida byte meanings against MeerK40t.
- Browser runs (none needed).

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-d2\`. Run each with `node --no-experimental-webstorage --import ./register.mjs <file>`.

| File | What it covers | Output |
|---|---|---|
| `lib.mts` | Builders, own G-code reader, own Ruida byte reader, Moshi decode wrapper | — |
| `r1-output-scope.mts` | D2-P1-1 | `out/r1-output-scope.txt` |
| `r2-ruida-rotary-feed.mts` | D2-P1-2 | `out/r2-ruida-rotary-feed.txt` |
| `r3-fill-scan-offset.mts` | D2-P1-3 | `out/r3-fill-scan-offset.txt` |
| `r4-moshi-power-levels.mts` | D2-P2-2 | `out/r4-moshi-power-levels.txt` |
| `r5-job-warnings.mts` | D2-P2-1 | `out/r5-job-warnings.txt` |
| `r6-ruida-raster-refusal.mts` | Refuted note | `out/r6-ruida-raster-refusal.txt` |
| `r7-gcode-dialects.mts` | Verified clean | `out/r7-gcode-dialects.txt` |

There are no security findings, so there is no `SECURITY-DETAILS.md`.

```json
{
  "area": "D2",
  "tree": "dcca5b8c4",
  "findings": [
    {"id": "D2-P1-1", "severity": "P1", "title": "Selected artwork only ignored by Moshi USB and Ruida UDP Frame/Start", "where": ["src/ui/state/moshi-usb/moshi-usb-job.ts:25", "src/ui/state/ruida-network/ruida-network-job.ts:70-76"], "evidence": "REPRO r1-output-scope.mts", "novelty": "new"},
    {"id": "D2-P1-2", "severity": "P1", "title": "Ruida .rd/UDP Y-rotary skips surface-feed match: 15.9-31.8 % dose round the part, silent", "where": ["src/io/rd/emit-rd.ts:73-82", "src/core/controllers/ruida/rd-job-writer.ts:158"], "evidence": "REPRO r2-ruida-rotary-feed.mts", "novelty": "new (Ruida twin of Z3-P1-2)"},
    {"id": "D2-P1-3", "severity": "P1", "title": "Moshi Fill ignores bidirectional scan offset (layer and device table)", "where": ["src/core/controllers/moshi/moshi-vector-plan.ts:31-48"], "evidence": "REPRO r3-fill-scan-offset.mts", "novelty": "Fill twin of D1-P1-2"},
    {"id": "D2-P2-1", "severity": "P2", "title": "Compile diagnostics and job warnings never reach Save .rd, Ruida UDP or Moshi", "where": ["src/ui/laser/machine-job-warnings.ts:41", "src/io/rd/emit-rd.ts:92", "src/io/moshi/emit-moshi.ts:47-51"], "evidence": "REPRO r5-job-warnings.mts", "novelty": "new"},
    {"id": "D2-P2-2", "severity": "P2", "title": "Moshi burned tabs and score layers burn at dial power without a job-specific warning", "where": ["src/core/controllers/moshi/moshi-vector-plan.ts:16", "src/core/controllers/moshi/moshi-job-encoder.ts:101-105"], "evidence": "REPRO r4-moshi-power-levels.mts", "novelty": "new"},
    {"id": "D2-P2-3", "severity": "P2", "title": "Variable advance 'After completed job' never fires for Moshi or Ruida network jobs", "where": ["src/ui/laser/start-job-transmission.ts:78"], "evidence": "READ", "novelty": "new"},
    {"id": "D2-P3-1", "severity": "P3", "title": "Moshi/Ruida Frame permits compare bounding boxes only", "where": ["src/ui/state/moshi-usb/moshi-usb-store.ts:101", "src/ui/state/ruida-network/ruida-network-store.ts:180"], "evidence": "READ", "novelty": "new"},
    {"id": "D2-P3-2", "severity": "P3", "title": "Rule copies (preflight adapter, wrap limit, pass loops, Fill runway) with Fill runway disagreeing", "where": ["src/io/rd/rd-preflight.ts:25-51", "src/io/moshi/moshi-preflight.ts:18-43", "src/core/controllers/moshi/moshi-vector-plan.ts:50-69"], "evidence": "READ", "novelty": "new"},
    {"id": "D2-P3-3", "severity": "P3", "title": "Silent per-route no-ops: laser finish, Moshi air, .rd power mode", "where": ["src/core/controllers/ruida/rd-job-writer.ts:129-164"], "evidence": "READ", "novelty": "new"}
  ],
  "known": ["D1-P1-1", "D1-P1-2", "D1-P2-1", "D1-P2-3", "D1-P2-5", "Z3-P1-1", "Z3-P1-2", "Z3-P2-1", "Z4-P1-1", "Z4-P2-1"],
  "refuted": ["D1 hand-over: .rd ignores dot width and scan offset (the .rd encoder refuses Fill/Image)"],
  "counts": {"raised": 9, "P1": 3, "P2": 3, "P3": 3, "known": 10}
}
```

Auditor counts: raised 9, P1 3, P2 3, P3 3, known 10

## Refuter (2026-11-11)

**Tree and harness.** Repro tree `j28-main` (`origin/main` @ `dcca5b8c4`, read-only). Every anchor below is on that tree. The refuter's own scripts are in `scratchpad\zz-d2r\`, run with `node --no-experimental-webstorage --import ./register.mjs <file>` (loader copied from `zz-d2`).

The method differs from the auditor's:
- The network routes are driven through the **real app store** (`useStore`): select, the "Selected artwork only" setter, `setJobPlacement`. Then the exact two lines each panel runs: `const { project, jobPlacement } = useStore.getState(); prepareXJob(project, jobPlacement)` (`MoshiUsbDetails.tsx:83-84`, `RuidaNetworkDetails.tsx:107-108`).
- The canvas preview is built with the store's own scope.
- The G-code reader is a fresh one. It also treats `M106`/`M107` as on/off.
- The Ruida command parser is the refuter's own. It reads `C9 02` speed, `A8`/`88` cut/move, `C6 02` max power and `CA 01` air; only the repo's `unswizzleBytes` is used, as a byte transform.
- D2-P1-3 is decided **decoder-free**, by hashing the Moshi program bytes.
- D2-P2-3 runs the real `useMoshiUsbStore` against the repo's scripted `MoshiSimulator`.

No hardware, no network, no Vitest, no browser.

`origin/main` is now `ddce869b3` (#1739). **PR #1751 (D1 fix) is OPEN, not merged** (`gh pr view 1751`: state OPEN, mergedAt null).

### Verdicts

| ID | Verdict | Severity after refute |
|---|---|---|
| D2-P1-1 | **CONFIRMED** | P1 |
| D2-P1-2 | **CONFIRMED.** Novelty corrected: v14 Z3 saw it and waved it through as "announced". Not refuted as KNOWN | P1 |
| D2-P1-3 | **CONFIRMED.** #1751 does not cover Fill | P1 |
| D2-P2-1 | **CONFIRMED, raised** | **P1** |
| D2-P2-2 | **CONFIRMED** | P2 |
| D2-P2-3 | **CONFIRMED**, now REPRO at store level | P2 |
| D2-P3-1 | CONFIRMED (READ) | P3 |
| D2-P3-2 | CONFIRMED (READ) | P3 |
| D2-P3-3 | **CONFIRMED in part.** The `.rd` power-mode item is announced, not silent | P3 |

#### D2-P1-1: CONFIRMED P1

**Reachability (READ).**
- The checkbox has no controller gate:
  - `JobPlacementControls` is mounted in the machine rail's Placement dropdown (`JobControls.tsx:164-168`, from `LaserWindow.tsx:150-161`).
  - The checkbox (`JobPlacementControls.tsx:110-121`) is disabled only by `busy = props.streaming` (`:52`), which reads `useLaserStore` only.
  - No code path checks `controllerKind`.
- The Moshi and Ruida panels mount in the machine toolbar (`ControllerConnectionControls.tsx:153-154`) on the same screen. So with a Moshi or Ruida profile active, the checkbox is visible, tickable, and shows as applying.
- Nothing warns, and nothing disables it for those routes. A grep for `outputScope|cutSelected|OutputScope|selected artwork` over `ui/moshi-usb`, `ui/ruida-network`, `ui/state/moshi-usb`, `ui/state/ruida-network` and `io/moshi` finds nothing.
- `io/rd/emit-rd.ts:19,45-49` already accepts `outputScope`. `ruida-network-job.ts:31-37` just never passes it.
- #1751 keeps `prepareOutput(project, {})` in `moshi-usb-job.ts`, so it does not fix this either.

**Evidence (REPRO `q1-scope-store.mts` → `out/q1-scope-store.txt`).** Three 30 × 15 mm tags at X 10, 150 and 150 mm. TAG1 is selected through the store, with `cutSelectedGraphics: true` and Start from Absolute.

| Route | What it burns | Advisories |
|---|---|---|
| Canvas preview (`buildPreviewToolpathUnbounded` with the store's scope, as `use-preview-toolpath.ts:54` builds it) | x 0.00..40.00: TAG1 only | — |
| Moshi panel Start | **12 cut steps over X 10.01..180.01 mm** (all three tags). The Frame footprint X 10.01..180.01, Y 10.01..135.00 traces all three | 0 |
| Ruida panel Start | **12 cut records**, machine X 10..180, Y 265..390 (all three) | 0 |

The canvas preview really shows only the selection, and the routes burn everything. The Frame box differs from the preview, but that is a visible result, not a warning (METHOD §3 G6 clarification).

#### D2-P1-2: CONFIRMED P1; novelty corrected

**Evidence (REPRO `q2-ruida-rotary.mts` → `out/q2-ruida-rotary.txt`).** A "+" at 1200 mm/min: one 20 mm stroke along X and one 20 mm stroke round the part. The refuter's own model is `k = mmPerRotation / (π·D)`.

| Setup | Save `.rd` / UDP | Speed records | Advisories | GRBL control |
|---|---|---|---|---|
| 40 mm/turn chuck, Ø80 (k 0.16) | the round stroke moves the surface at 7539.8 mm/min, **15.92 %** dose | one, 1200 | 0 | 100.52 % |
| 360 mm/turn chuck, Ø25 pen (k 4.58) | 261.8 mm/min, **458.37 % dose (over-burn)** | one | 0 | 100.01 % |

The k > 1 over-burn case was asserted by the auditor but not reproduced; it is reproduced here.

**Does the controller rescale? (READ)**
- `emit-rd.ts:70-77` applies KerfDesk's own `machineSpaceJob` Y scale before encoding: "apply the same rotary machine-space scaling so a saved .rd matches the streamed G-code".
- So the file already carries machine-space Y, and the controller is not expected to rescale.
- ADR-127 Amd 2 "Out of scope" says the opposite: Ruida `.rd` "uses the controller's own rotary settings".
- If an operator does turn the controller's rotary on, Y would be scaled twice. That is new finding D2-P3-5, UNVERIFIED against a real Ruida.
- Rotary Setup offers Y for Ruida (`rotary-axis.ts:66-69` returns `['Y']`; `RotarySetupHost.tsx:16,62`) with no Ruida-specific note.

**KNOWN vs kept.** The auditor's "Announced? No" and "Novelty: New" are wrong:
- ADR-127 Amd 2 names `.rd` out of scope.
- v14 Z3 listed it as "Announced as out of scope" (`docs/audits/2026-11-10-rolling-v14/Z3-rotary-feed-verify.md:285, :483`).
- The v14 ledger keeps it "announced" (`LEDGER.md:49` on `dcca5b8c4`).

By METHOD it is still not refutable as KNOWN:
- **§3:** a P1 may be lowered only if the output is not wrong, or if "a clear warning reaches the operator before the output is produced". An ADR line reaches no operator. The only operator text is the generic EXPERIMENTAL `.rd` toast (`save-rd-action.ts:36-37`).
- **§6:** KNOWN means a prior report or PR that tracks the defect. Z3 noted it but gave it no ID and no fix.
- **The audit series' own usage:** "announced" means told to the user (v9 AREAS L11 "harmless or announced"; R8-P2-1 "unannounced move" = no load notice).
- **The ADR's premise is contradicted by the code** (see above).

**Decision:** keep it as a P1 under this ID, with novelty "seen in v14 Z3 and not raised".

#### D2-P1-3: CONFIRMED P1; #1751 does not cover Fill

**Evidence (REPRO, decoder-free: `q3-moshi-fill-offset.mts` → `out/q3-moshi-fill-offset.txt`).** A 30 × 6 mm Fill, 0.5 mm interval, bidirectional, 2400 mm/min, through the Moshi panel entry.

| Offset source | Moshi program sha1 | GRBL G-code sha1 | GRBL reverse sweeps | Moshi-profile canvas preview, reverse sweeps |
|---|---|---|---|---|
| none | `cd1a595315` | `e11fe224e8` | 40.00..70.00 | 35.00..75.00 |
| layer 0.6 mm | **`cd1a595315`** | `a60a953e27` | 39.40..69.40 | 34.40..74.40 |
| device table 0.6 mm | **`cd1a595315`** | `a60a953e27` | 39.40..69.40 | 34.40..74.40 |

- The Moshi bytes are identical whatever the offset, so the offset is ignored.
- The canvas preview of the same Moshi project does shift by 0.6 mm, so preview ≠ output (ADR-040).
- No advisory is raised.

**#1751 coverage.** #1751 (OPEN) touches `moshi-raster-plan.ts`, `moshi-job-encoder.ts`, `moshi-usb-job.ts` and others, but **not** `moshi-vector-plan.ts`. Its scan-offset change is `moshiRasterScanOffsetMm`, for Image rows only. So even once merged, Fill stays wrong.

The coordinator may merge this with D1-P1-2 as one root cause (Moshi planners bypass the shared sweep planners), but the fix must include `planFillGroupSteps` (`moshi-vector-plan.ts:31-48`).

#### D2-P2-1: CONFIRMED and raised to P1

**Evidence (REPRO `q4-kerf-side.mts` → `out/q4-kerf-side.txt`).** This is a stronger case than the auditor's missing slot: a part that comes out the **wrong size**.
- Layer "Sheet" has a 100 × 60 outline with no kerf. Layer "Parts" (kerf 0.2) has a 40 × 20 shape inside it.
- The compile emits `kerf-side-assumed` (ADR-486 Amd 3).
- The G-code Save/Start path (`detectMachineJobWarnings`) warns: "Kerf offset on layer "Parts": 1 shape sits inside a closed shape on layer "Sheet" … If "Sheet" cuts parts out, … comes out 0.8 mm off its drawn width".
- Save `.rd` (the `emitRdFile` list that `handleSaveRd` toasts), the Ruida UDP panel and the Moshi USB panel each return **0 advisories**.
- All four routes burn the beam path at X 39.80..80.20, offset outward. If "Sheet" really cuts a part out, PART is a hole in it, and it comes out 40.8 mm instead of 40: +0.8 mm, silent.

**Why P1.**
- METHOD §3: "silently produces wrong physical output (… scale)", with no reach clause.
- ADR-486 Amd 3 chose to warn instead of guessing right, so the warning is the design's only safeguard (`compile-diagnostic-warnings.ts:148-159`).
- On the network routes and `.rd` it is never computed. Ruida CO2 cutters are the machines where kerf-compensated parts are the main job.
- D1-P2-1's P2 precedent was about warnings arriving *late*. Here they never arrive.
- The auditor's missing-slot case (`kerf-offset-closed-up`) and the "will NOT be cut" cases (`kerf-offset-failed`, `fill-ownership-failed`, `raster-source-luma-mismatch`) are the same silent-wrong-part class.

#### D2-P2-2: CONFIRMED P2

**Evidence (REPRO `q6-moshi-tabs.mts` → `out/q6-moshi-tabs.txt`).** A 40 mm square, 4 × 3 mm tabs, through the Moshi panel entry.
- Tabs at 0 %: one program, 147.93 mm lit.
- Tabs at 20 %: two programs. The tab program has **12.09 mm lit**, for a total of **160.02 of 160 mm lit**: every tab burns through at dial power. 0 advisories.

It stays P2, not P1, because two generic notes reach the operator before Start:
- the panel's always-shown `MOSHI_POWER_NOTE` ("Layer power above 0 only switches the beam on", `moshi-usb-messages.ts:6-7`);
- the layer editor's Moshi note (`CutPowerModeField.tsx:17-24`).

Neither names tabs.

#### D2-P2-3: CONFIRMED P2, now REPRO at store level

**Evidence (REPRO `q5-variable-advance.mts` → `out/q5-variable-advance.txt`).** The project's serial is 7, with advancement `after-successful-stream`.
- Control: the call the G-code completion makes moves the serial 7 → 8.
- The real `useMoshiUsbStore`, connected to the repo's `MoshiSimulator`, runs Frame + Start to "Job finished: the board reports ready." (2 simulator runs).
- The app store's serial stays **7**.

The Ruida network store has the same shape (READ, `ruida-network-store.ts`: no `advanceVariablesAfter`).

#### D2-P3-1 and D2-P3-2: CONFIRMED P3 (READ)

- `moshi-frame.ts:15-18` compares the four bounds only.
- `withRunways` (`moshi-vector-plan.ts:50-69`) ignores `fillRunwayPolicy`.

#### D2-P3-3: CONFIRMED in part, P3

The laser finish and the Moshi air items are silent no-ops (READ). The **`.rd` power-mode item is announced**, not silent:
- For a Ruida profile the layer editor hides the Power mode selector.
- It says "Experimental Ruida export uses this layer power for both Min and Max power." (`CutPowerModeField.tsx:25-31`).

### Matrix spot-checks (REPRO `q8-matrix-spot.mts` → `out/q8-matrix-spot.txt`)

| Cell | Claim | Result |
|---|---|---|
| Row 25, tab power share on `.rd` | ✓ shared | **Holds.** Two parts: `max1=80.00%` (cut) and `max1=16.00%` (tab span), so 20 % of 80 |
| Row 5, bed bounds on Ruida UDP and Moshi | ✓ shared | **Holds** (shown after send, KNOWN D1-P2-1). Ruida: "X out of bed: 620 (bed position)". Moshi: "X out of bed: 350.012" |
| Row 7, rotary wrap limit on Ruida UDP | copy | **Holds:** "The artwork wraps 200.0 mm round the part (1.27 turns), more than one turn of the Ø50 mm object (157.1 mm)…" |
| Row 21, air assist on `.rd` | copy per layer | **Holds:** the air-on layer writes `CA 01 13`, the air-off layer `CA 01 12` |
| Row 1, canvas preview | ✓ shared | **Holds** (Q1): the preview honours the scope |

**Trying to break "the G-code family is one choke point"** (REPRO `q7-dialects.mts` → `out/q7-dialects.txt`).
- The auditor's R7 header names Marlin fan, but its table never runs it, and its reader ignores `M106`. Q7 runs **six** dialects, including Marlin fan.
- The job: a Line 80 % layer in Dynamic mode with air and 20 % burned tabs, plus a Fill with a 0.4 mm layer offset, on a profile with `airAssistCommand: 'M8'`.
- **Holds** on every point:
  - all six give lit-geometry hash `1f5b4ed0` (17 strokes);
  - power shares are 0.80 / 0.16 / 0.40 (Marlin fan `M106 S204` = 0.80);
  - the Fill reverse sweep is 119.60 → 99.60;
  - air words are `M8 M9` everywhere.
- Smoothieware's 0–1 S scale: S words are rescaled after the shared emitter and hold (`smoothieware-strategy.ts:33-52`).
- **Where it does not hold, by design: the power mode.**
  - grbl, grblHAL and FluidNC write `M4`.
  - Marlin inline turns every `M3`/`M4` into `M3 I` (continuous; `marlin-inline-transform.ts:11-25`). Marlin fan uses `M106`/`M107`.
  - Smoothieware writes `M221 S100 P0` (proportional).
  - This is announced in the layer editor: Marlin hides the selector and says compensation is set by the firmware build (`CutPowerModeField.tsx:9-16`).
  - One twin still disagrees: Job Review's effective-operation fact (D2-P3-4).
- **grblHAL `$32`:** this is not an emit rule. It is a connect/Start check (ADR-637 Amd 7), and a Save cannot know the controller, so it falls outside the emit choke point.
- **Marlin `M8`:** whether a Marlin build accepts `M8` depends on `COOLANT_FLOOD`. Not verified (firmware ground truth).

### New findings

#### D2-P3-4 — Job Review says "dynamic power" for a Marlin layer that runs continuous `M3 I`

- **Where:**
  - `src/ui/laser/job-review/job-review-effective-operations.ts:285-286` prints `· ${group.powerMode} power` from the compiled group;
  - `src/core/output/marlin-inline-transform.ts:11-25` rewrites `M4` as `M3 I`.
- **Anchor:** twin consistency (Job Review facts vs the emitted program, ADR-040); ADR-095 Marlin dialect.
- **Evidence:** **REPRO** `q9-marlin-dynamic-fact.mts` → `out/q9-marlin-dynamic-fact.txt`. A layer stored as Dynamic (set on a GRBL profile), with the profile then switched to Marlin inline:
  - the compiled group still carries `powerMode=dynamic`;
  - the program writes only `M5 I` / `M3 I`.
  - The layer editor hides the selector on Marlin, so the stored value cannot be seen or changed there.
- **Scenario:** a user moves a project from a GRBL diode to a Marlin machine. Job Review lists "dynamic power" for the cut, but corners burn at constant power. Wrong words, not wrong output on the Marlin contract.
- **Severity:** P3.
- **Announced?** In part: the layer editor tells the truth (`CutPowerModeField.tsx:9-16`); Job Review contradicts it.
- **Novelty:** New.
- **Fix direction:** have Job Review word the power mode from the dialect's resolved mode (as `job-intent-warnings.ts:283-293` already does), not from `group.powerMode`.

#### D2-P3-5 — ADR-127 Amd 2's reason for leaving Ruida out contradicts the `.rd` code, and Rotary Setup says nothing for Ruida

- **Where:**
  - ADR-127 Amd 2 "Out of scope": Ruida `.rd` "uses the controller's own rotary settings";
  - `src/io/rd/emit-rd.ts:70-77` applies KerfDesk's own Y scale;
  - `src/core/devices/rotary-axis.ts:66-69` offers Y for Ruida;
  - `src/ui/laser/RotarySetupHost.tsx:16,62` has no Ruida branch or note.
- **Anchor:** contract drift (ADR text vs code).
- **Evidence:** **READ.**
- **Scenario:** an operator who reads the ADR, or knows Ruida practice, also enables the controller's rotary. The file's Y is already scaled by k, so the design would be scaled twice round the part.
  - This is unverified: no Ruida rotary manual was fetched (no live services), and no hardware was used.
  - If it is true, it is a P1 position/scale error.
  - With the controller's rotary off, D2-P1-2 applies instead.
- **Severity:** P3 (doc/code drift, ground truth unverified).
- **Announced?** No.
- **Novelty:** The double-scale question is "Not verified, as in D3" (controller-v3 `D3-ctl-rotary.md:448`, v14 Z3:483). The contradiction between the ADR's wording and `emit-rd.ts` is new.
- **Fix direction:**
  - Fix the ADR wording.
  - In Rotary Setup for a Ruida profile, say which side scales and that the controller's own rotary must be off (or refuse a KerfDesk Y-rotary on Ruida).
  - Fold this into D2-P1-2's fix.

### Not verified

- Real Ruida rotary semantics: whether the controller rescales Y, and whether its speed is a vector speed along the commanded path. D2-P1-2's dose model assumes the controller's rotary is off and speed is a path speed, as ADR-127 Amd 2 assumes for G-code. Not fetched (no live services).
- Marlin `M8`/`M9` acceptance without `COOLANT_FLOOD`, and grblHAL `$32` at Start (outside the emit choke point).
- The Ruida network store's completion path, for D2-P2-3. That is READ only; Moshi is REPRO.
- Rows 9, 12, 19, 20, 26, 28 and 33-36 were not re-driven; only the cells above were spot-checked.
- No Vitest and no browser run (none needed).

### Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-d2r\`. Outputs are in `out\`.

| File | Covers |
|---|---|
| `h.mts` | Builders, own G-code reader (`M106`/`M107` aware), own Ruida command parser |
| `q1-scope-store.mts` | D2-P1-1 through the real store, preview and Frame footprint |
| `q2-ruida-rotary.mts` | D2-P1-2, k < 1 and k > 1, Save and UDP |
| `q3-moshi-fill-offset.mts` | D2-P1-3, decoder-free byte hashes plus preview |
| `q4-kerf-side.mts` | D2-P2-1 raised: wrong-size hole, 0 advisories on `.rd`, UDP and Moshi |
| `q5-variable-advance.mts` | D2-P2-3, store and simulator |
| `q6-moshi-tabs.mts` | D2-P2-2 |
| `q7-dialects.mts` | Six G-code dialects including Marlin fan |
| `q8-matrix-spot.mts` | Matrix spot-checks S1-S4 |
| `q9-marlin-dynamic-fact.mts` | D2-P3-4 |
| `register.mjs`, `ts-resolve.mjs` | Loader, copied from `zz-d2` |

```json
{
  "area": "D2",
  "role": "refuter",
  "tree": "dcca5b8c4",
  "verdicts": [
    {"id": "D2-P1-1", "verdict": "CONFIRMED", "severity": "P1", "evidence": "REPRO q1-scope-store.mts (real store; preview TAG1 only, Moshi 12 cut steps X 10-180, Ruida 12 cut records, 0 advisories)"},
    {"id": "D2-P1-2", "verdict": "CONFIRMED", "severity": "P1", "evidence": "REPRO q2-ruida-rotary.mts (15.92 % k 0.16; 458.37 % k 4.58; 0 advisories)", "known": "seen in v14 Z3:285/:483 as 'announced', never raised; kept per METHOD §3/§6"},
    {"id": "D2-P1-3", "verdict": "CONFIRMED", "severity": "P1", "evidence": "REPRO q3-moshi-fill-offset.mts (Moshi bytes identical across offsets; G-code and preview shift 0.6)", "note": "#1751 OPEN, does not touch moshi-vector-plan.ts"},
    {"id": "D2-P2-1", "verdict": "CONFIRMED", "severity": "P1", "severity_change": "P2->P1", "evidence": "REPRO q4-kerf-side.mts (kerf-side-assumed: hole +0.8 mm, G-code warns, .rd/UDP/Moshi 0 advisories)"},
    {"id": "D2-P2-2", "verdict": "CONFIRMED", "severity": "P2", "evidence": "REPRO q6-moshi-tabs.mts (tabs 20 %: 160.02/160 mm lit, 0 advisories; generic notes shown)"},
    {"id": "D2-P2-3", "verdict": "CONFIRMED", "severity": "P2", "evidence": "REPRO q5-variable-advance.mts (Moshi store + simulator: serial stays 7; control 7->8)"},
    {"id": "D2-P3-1", "verdict": "CONFIRMED", "severity": "P3", "evidence": "READ moshi-frame.ts:15-18"},
    {"id": "D2-P3-2", "verdict": "CONFIRMED", "severity": "P3", "evidence": "READ moshi-vector-plan.ts:50-69"},
    {"id": "D2-P3-3", "verdict": "CONFIRMED in part", "severity": "P3", "evidence": "READ; .rd power-mode item announced at CutPowerModeField.tsx:25-31"}
  ],
  "new": [
    {"id": "D2-P3-4", "severity": "P3", "area": "single-choke-points", "file": "src/ui/laser/job-review/job-review-effective-operations.ts", "line": 285, "anchor": "Twin: Job Review fact vs Marlin program (ADR-040, ADR-095)", "evidence": "REPRO q9-marlin-dynamic-fact.mts", "verdict": "new", "known": false, "summary": "Job Review prints 'dynamic power' for a Marlin layer whose program runs continuous M3 I"},
    {"id": "D2-P3-5", "severity": "P3", "area": "single-choke-points", "file": "src/io/rd/emit-rd.ts", "line": 70, "anchor": "Contract drift: ADR-127 Amd 2 'Out of scope' wording vs emit-rd machineSpaceJob", "evidence": "READ", "verdict": "new", "known": "double-scale question 'Not verified' in controller-v3 D3 and v14 Z3", "summary": "ADR says Ruida .rd uses the controller's own rotary settings, but the .rd already carries KerfDesk's Y scale; Rotary Setup has no Ruida note"}
  ],
  "matrix_spotchecks": {"row25_rd_tab_share": "holds", "row5_bed_bounds_udp_moshi": "holds", "row7_wrap_limit_udp": "holds", "row21_rd_air": "holds", "gcode_family_six_dialects": "holds for geometry, power share, scan offset, air; power mode diverges by design (Marlin M3 I, Smoothie M221)"},
  "counts": {"raised": 11, "refuted": 0, "P1": 4, "P2": 2, "P3": 5, "known": 10}
}
```

Refuter counts: raised 11, refuted 0, P1 4, P2 2, P3 5, known 10
