# LaserForge 2.0 -- Full Code Audit with Calibrated Karpathy Rating

- Date: 2026-06-04
- Anchor: HEAD 473aa21 (clean working tree, "fix: stabilize bitmap burn output")
- Scope: ~25,500 LOC of production TypeScript across 201 src files + ~129 colocated test files
- Reviewers: 13 area specialists, reconciled against live-code verification by the lead auditor
- Health baseline at this HEAD (authoritative, already run by the lead): tsc --noEmit = 0 errors; eslint = 0 errors (one pre-existing boundaries selector-deprecation WARNING only); full vitest suite = 1011 passed / 1011 (135 files)

A green build is a NECESSARY-not-sufficient signal. Tests encode what was already
believed true, so a passing suite does not prove correctness or safety. Every load-bearing
claim below was checked against the cited lines, and the laser-off-on-travel invariant was
verified empirically by emitting G-code and scanning the output (not by reading test colour).

---

## 1. The Rating

### Overall: 7.5 / 10

One-line verdict: A disciplined, safety-literate laser-CAM core with an honest g-code
emitter and a strong Electron shell; held back from an 8+ by one unprotected write in the
GRBL resume path and a real feature gap versus LightBurn on raster quality, layer control,
and shape authoring.

This is a "solid, production-leaning" score, not "excellent" (9) and not "ship to paying
customers tomorrow" (10). The pipeline is architecturally clean, the safety invariants are
enforced at the right layer (the emitted bytes, not the in-memory model), and the recent
disconnect/raster fixes are correct. But there is exactly one confirmed P1 in a safety-
adjacent path (resume), and the product is meaningfully behind its stated benchmark
(LightBurn) on capabilities operators reach for daily.

### Scoring method and weights (stated explicitly)

Composite is a weighted mean of the 13 area subscores. SAFETY and CORRECTNESS areas are
weighted 2x relative to feature/parity and polish areas, because in this codebase the cost
of being wrong is a physical burn or mechanical damage, not a layout glitch.

- Weight 2x (safety/correctness): scene+compile, plan/optimize, gcode-output,
  controller/streamer-safety, raster/trace, preflight/invariants.
- Weight 1x (feature/polish): ui-state, ui-workspace, io, electron, test-suite,
  lightburn-parity, cross-cutting.

Caps applied: a single confirmed P0 safety defect caps the overall at <= 6 until fixed;
multiple P0s cap lower. Verification found NO P0 at this HEAD, so no cap applies. The one
confirmed P1 in the streamer (resumeJob follow-up write) is a stuck-stream / accounting-
drift risk, not a runaway-laser, so it is correctly a P1 and does not trigger the cap.

Reconciliation note: the controller/streamer reviewer's own subscore was 6, explicitly
because of the confirmed resumeJob P1. I kept it at 6 (not higher) precisely so the
verified defect is reflected in the weighted total rather than averaged away.

Arithmetic:
- Safety areas (2x): 8.5, 8, 8, 6, 8, 8  ->  2 x 46.5 = 93.0 over weight 12
- Polish areas (1x): 7, 7, 8, 9, 7.5, 6.5, 8.2  ->  53.2 over weight 7
- Composite = (93.0 + 53.2) / (12 + 7) = 146.2 / 19 = 7.69  ->  rounded to 7.5

The round-down (7.69 -> 7.5) is deliberate and conservative: the lightburn-parity gaps are
not a single bug but a breadth deficit that an operator feels on the first real photo
engrave or multi-color job, and the green suite does not exercise hardware.

---

## 2. Per-Dimension Scorecard

| # | Area | Weight | Score | One-line justification |
|---|------|--------|-------|------------------------|
| 1 | scene + job (compileJob) | 2x | 8.5 | Numerically robust scanline fill, correct scale->mirror->rotate->translate order, base64 luma fails safe to white; missing a couple of upstream exhaustiveness throws. |
| 2 | plan: optimize-paths + planner | 2x | 8.0 | Faithful Sonny-Jeon junction-deviation physics, deterministic indexed loops; NN disabled above 2000 segments and a documented sub-mm postamble pessimization. |
| 3 | output: GRBL g-code emission | 2x | 8.0 | Every G0 carries S0, modal S re-asserted exhaustively on fills, M3/M4 mode machine well-reasoned; verified empirically to emit zero laser-on-travel issues. |
| 4 | controller/streamer safety | 2x | 6.0 | Byte accounting and error/alarm-as-terminal are correct, but resumeJob's follow-up write (laser-store.ts:412) is the one unprotected write in the family -> confirmed P1. |
| 5 | raster + trace subsystems | 2x | 8.0 | ADR-039 gap-split and 473aa21 orientation flip are correct and property-tested; luma-resample lacks dedicated unit tests. |
| 6 | preflight + invariants | 2x | 8.0 | Pre-emit budget guard runs before allocation and IS wired into production; blank-feed checks the real emitted bytes with exact modal tracking. |
| 7 | ui/state (store, autosave, motion, history) | 1x | 7.0 | Functional-set pattern is race-proof and mature; a minor empty-g-code streamer leak and some untested concurrency edges remain. |
| 8 | ui/workspace (Canvas2D) + components | 1x | 7.0 | Preview reuses the exact compile pipeline (true WYSIWYG); the alleged preview/compile pixel-grid mismatch was refuted. Hex-color validation in SVG export is missing. |
| 9 | io (save/load, SVG, gcode meta) | 1x | 8.0 | Excellent determinism and round-trip fidelity; SVG unit convention (unitless == mm) is undocumented and strips no explicit unit suffixes. |
| 10 | electron (security, CSP, IPC, serial) | 1x | 9.0 | contextIsolation+sandbox+nodeIntegration:false, zero ipcMain handlers, CSP via headers, whitelist permission handlers, path-traversal guard. Genuinely strong. |
| 11 | test suite quality | 1x | 7.5 | Determinism and safety-invariant property tests are production-grade; gaps in compileJob fuzzing and unmocked Web Serial fault injection. |
| 12 | lightburn parity | 2x | 6.5 | Inside-first ordering and modal M3/M4 are excellent, but 3 dither modes vs ~10, no min-power, no layer reorder, no offset-fill, no tonal adjust, Start-From under-wired. |
| 13 | cross-cutting (boundaries, maintainability) | 1x | 8.2 | Strict layering down the pipeline, plugin OutputStrategy, tsconfig stricter than `strict`; a few >400-line files want a header rationale. |

---

## 3. Top Strengths (genuinely excellent, with evidence)

1. The laser-off-on-travel invariant (#3) is enforced at the emitted-byte level and holds
   empirically. grbl-strategy.ts emits `S0` on every G0 (lines 53, 124, 126, 130, 186), and
   grbl-strategy.property.test.ts asserts `findLaserOnTravelIssues(out).length === 0` across
   randomly generated in-bounds jobs (lines 120, 199, 220). I independently emitted a cut job
   and scanned the output: 0 laser-on-travel issues, 0 G0 lines missing S0, correct preamble
   (G21/G90/M3 S0) and postamble (M5 / G0 X0 Y0 S0).

2. Modal S is re-asserted exhaustively on fill sweeps so a missed S0 cannot fire the beam
   across an interior hole. sweepSpanLines (grbl-strategy.ts:143-169) writes `S{s}` on each
   ink span and `S0` on each gap, with a head-tracker that skips zero-length moves at emit
   precision (line 154) -- defense-in-depth against a stationary beam-on G1.

3. The disconnect-burn failure mode is handled with honesty, not false confidence. When the
   USB drops, buildPortClosePatch (laser-store-helpers.ts:80-97) marks the streamer
   disconnected and raises a safety notice; the copy (laser-safety-notice.ts:47-50) names the
   physical E-stop / power cutoff and states plainly that buffered GRBL commands may still be
   running. This correctly gives precedence to human action because no software command can
   stop motion after the cable is gone.

4. The character-counted streamer maintains its byte-sum invariant cleanly and treats
   error/alarm as terminal (P0-1). streamer.ts step() (97-132) and onAck() (140-165) keep
   inFlightBytes == sum(inFlight[].bytes), and an `error:N` ack flips status to 'errored' so
   step() refuses to send further bytes -- protecting against a laser-on line firing at a
   mispositioned head.

5. The raster gap-split (ADR-039) is correct and property-pinned. activeSpans
   (emit-raster.ts:143-164) splits a row on white gaps > 5 mm, and emitSpanSweep crosses each
   gap with a G0 rapid (laser dark under M4+S0), eliminating the long-blank-feed invariant
   violation. The 473aa21 orientation fix (compile-job.ts:127-156) XORs origin-driven flips
   against the image's own mirror state, with per-origin X/Y flip logic that is internally
   consistent.

6. The pre-emit budget guard prevents an app freeze on oversized rasters before any large
   allocation, and it is genuinely wired into production (runPreEmitPreflight consumed by
   src/io/gcode/prepare-output.ts and src/ui/laser/start-job-readiness.ts), satisfying the
   wired-into-product gate -- not a type-only foundation.

7. The Electron shell is a strong, minimal attack surface: contextIsolation + sandbox +
   nodeIntegration:false + webSecurity all enabled (main.ts:129-132), zero ipcMain handlers,
   CSP delivered via webRequest headers, permission/device/navigation handlers all gated on
   TRUSTED_RENDERER_ORIGINS, DevTools only when not packaged, and an app:// path-traversal
   guard that rejects any normalized path escaping the bundle root (main.ts:108-113).

8. The pipeline is pure-core and strictly layered. No clock/random/IO under src/core, power
   scaling is deterministic and honest (S = round((power/100) * maxPowerS)), and the
   OutputStrategy plugin pattern keeps the emitter swappable. tsconfig enforces
   noUncheckedIndexedAccess and exactOptionalPropertyTypes beyond plain strict mode.

---

## 4. Top Risks / Must-Fix (confirmed findings, severity-grouped, SAFETY first)

### P0 (safety-critical, caps the score)

None found at HEAD 473aa21. The recent Codex safety arc (P0-1..P0-8, disconnect/jog-cancel,
bitmap downscale) closed the previously-open P0 class, and the emitted-output and streamer
invariants verify clean.

### P1 -- SAFETY-adjacent (must-fix before next safety release)

P1-A. Unprotected follow-up write in resumeJob can drift byte-accounting and stall the stream.
- Where: src/ui/state/laser-store.ts:406-412 (resumeJob).
- Evidence: lines 390-395 wrap the RT_RESUME write in try-catch; the functional set at
  406-410 synchronously commits new streamer state (inFlight/inFlightBytes advanced by
  step(resumeStreamer())); then line 412 (`if (toSend.length > 0) await safeWrite(set, get,
  toSend)`) performs the actual byte write with NO try-catch. If that write throws, the
  streamer state has already been committed with bytes counted as in-flight that never reached
  GRBL. Because inFlightBytes is now non-zero, step() (streamer.ts:115) refuses to send new
  bytes on the next resume, and those phantom bytes are never freed by an ack -> the stream
  stalls indefinitely. Every sibling path handles this: startJob (372-377), pauseJob
  (380-385), stopJob (415-419) wrap their writes, and advanceStream (laser-line-handler.ts:
  180-190) catches the mid-job follow-up write and calls disconnectStreamer() + safety notice.
  resumeJob's follow-up write is the lone exception.
- Why it matters: on a laser cutter a paused job that silently refuses to resume (with no
  operator-facing notice) is a confusing, trust-eroding state; the accounting drift is the
  same class the resumeJob comment itself warns about. It is a P1 not a P0 because the head is
  paused (feed-hold already sent), so this is a stuck-stream, not a runaway beam.
- Fix: wrap line 412 in try-catch and, on failure, follow advanceStream's pattern -- call
  disconnectStreamer() and raise disconnectDuringJobNotice() (or writeFailedNotice('resume'))
  so the operator is told the resume did not reach the controller. Add an integration test for
  the resume-follow-up-write-fails path.

### P1 -- FEATURE PARITY (LightBurn benchmark; not safety, but the largest user-facing gap)

These are confirmed-present gaps, all verified against live code. They do not cap the score
but they are the dominant reason lightburn-parity sits at 6.5 and the composite rounds down.

P1-B. Only 3 raster dither modes; default is floyd-steinberg, not Jarvis.
- Where: src/core/raster/dither.ts:29 (3-member union), :52-61 (3 switch arms);
  src/core/scene/layer.ts:14, :60 (default 'floyd-steinberg'). The richer 13-mode kernel table
  already exists in src/core/trace/dither-trace.ts but is scoped to vectorization input, not
  engrave S-emission.
- Why it matters: this is the single biggest raster photo-engrave quality gap vs LightBurn.
- Fix: extract the kernel table into core/raster/dither-kernels.ts, expand LayerDitherAlgorithm
  (jarvis|stucki|atkinson|ordered|...), add matching dither.ts arms returning Uint16 schedules,
  set LAYER_DEFAULTS to 'jarvis' for new image layers, add a deterministic-emission snapshot
  test (the default change alters g-code for new projects).

P1-C. No Min Power per layer; grayscale tone maps 0->maxPower instead of minPower->maxPower.
- Where: src/core/scene/layer.ts:16-20 (only `power`); device-profile minPowerS exists but is
  consumed nowhere in output/ or compile-job (grep returns 0 matches); dither.ts:83 maps
  `((255-l)/255)*sMax` so white -> S0 with no floor.
- Why it matters: diodes lose tonal range without a power floor, and vector corners cannot hold
  honest minimum power. This is the M4 dynamic-power parity gap.
- Fix: add Layer.minPower (default == power for back-compat), thread it into ditherGrayscale as
  `round(minS + ((255-l)/255)*(maxS-minS))`, expose a Min Power slider; supersede ADR-020 with
  rationale. Hardware-verify on the Falcon.

P1-D. No per-layer tonal adjust (brightness/contrast/gamma/invert) on the raster engrave path.
- Where: compile-job.ts:90-125 (compileRasterGroup resamples then dithers with no tonal pre-
  pass); the adjustBrightness/Contrast/Gamma/invert helpers in src/core/trace/raster-prep.ts
  exist but are imported only by the trace path. grep confirms 0 brightness/contrast/gamma
  matches in compile-job.ts and emit-raster.ts.
- Why it matters: photo-engrave quality hinges on tone control; today it is available only when
  vectorizing, not when engraving.
- Fix: add tonal fields to Layer (or RasterImage), a pure core/raster/tonal-adjust.ts applied
  before resample, mirrored in draw-raster-preview for WYSIWYG.

P1-E. Start-From modes incomplete and under-wired.
- Where: src/core/job/job-origin.ts:6 (JobStartMode = 'absolute' | 'user-origin', no
  'current-position'); :24-31 hardcode anchor 'front-left' even though :54-79 implement all 9
  anchors correctly. No Start-From dropdown / 9-dot picker in src/ui/laser/JobControls.tsx;
  start-job-readiness.ts:65 only ever passes USER_ORIGIN_JOB_PLACEMENT.
- Why it matters: the core math is already correct for all 9 anchors -- this is latent
  capability the UI never surfaces; operators cannot pick a job origin.
- Fix: add 'current-position' to JobStartMode, carry the active placement as state, add the
  dropdown + 9-dot picker, thread the chosen placement into prepareStartJob/useFrameAction.
  SAFETY note in commit; hardware-verify current-position offset.

P1-F. No Offset Fill (concentric-inward) mode.
- Where: src/core/scene/layer.ts:8 (LayerMode = line|fill|image); fill-hatching.ts:238-262
  only generates parallel scanlines; compile-job.ts:72-75 branches on fill only.
- Why it matters: a standard LightBurn fill style is absent; lowest priority of the parity set
  (Tier 3, XL effort, with a known perf cliff on complex shapes).
- Fix: add 'offset-fill' to LayerMode, implement polygon offsetting with a MAX_SEGMENTS guard,
  snapshot-test a nested shape emitting concentric contours.

### P2 (worth doing; lower urgency)

P2-A. No layer reordering (Move Up/Down).
- Where: src/core/scene/scene.ts exports addLayer/updateLayer/removeLayer but no
  moveLayer/reorderLayer; no store action; no UI. compileJob emits groups strictly in
  scene.layers order (compile-job.ts:45). Inter-layer cut order is therefore fixed at import
  order. (Note: the audit input flagged this P1; verification downgrades it to P2 -- it is a
  genuine GAP but not on LightBurn-study's high-priority DIVERGE list, and compileJob already
  iterates in layer order so only a pure swap + small UI is needed.)
- Fix: pure moveLayer(scene, layerId, 'up'|'down') swapping adjacent entries, undo-tracked
  store action, up/down buttons in CutsLayersPanel, a test asserting the emitted CutGroup
  sequence changes.

### Smaller robustness items surfaced during verification (P3)

- orientRasterLumaForMachine (compile-job.ts:148-156) has no default arm; a future origin
  variant would silently get flipX=flipY=false. Add an assertNever-style throw.
- drawRasterPreview / paths-to-svg lack hex-color validation before embedding into SVG.
- The empty-g-code streamer (createStreamer of a comment-only string) leaves a 'done' streamer
  object resident -- a minor state-hygiene leak, not safety.

---

## 5. LightBurn Parity Assessment

Where LF2 matches or leads LightBurn:
- Inside-first cut ordering with robust containment analysis (prevents parts dropping mid-job)
  is correctly implemented and praised by the parity reviewer.
- Modal M3/M4 power architecture per ADR-036 is well-formed: vector cuts stay constant-power
  (a slow corner must cut through), fills use M4 dynamic power (even energy/mm on accelerating
  short strokes, and a diode that goes dark at zero feed -- strictly safer on travel/pause).
- The trace pipeline cleanly separates 13-mode dithering for vectorization from 3-mode
  dithering for S-emission, enabling sophisticated error-diffusion image traces.
- Determinism: byte-identical g-code for identical input is a property LightBurn does not
  advertise and that this codebase tests directly.

Where LF2 lags (highest-value gaps, grounded in LIGHTBURN-STUDY.md + verified code):
1. Raster engrave quality: 3 dither modes vs ~10, no Jarvis default (P1-B), no tonal adjust
   on the engrave path (P1-D), grayscale has no min-power floor (P1-C). This trio is the
   single largest day-one quality divergence for anyone engraving photos.
2. Layer control: no Min/Max power split (P1-C), no Move Up/Down reorder (P2-A).
3. Job placement: Start-From is latent in core but not reachable in the UI (P1-E).
4. Geometry authoring: the scene model is SVG-path/text/raster only -- there is no parametric
   shape creation (no rect/ellipse/polygon primitives), which is the largest structural
   divergence and an XL, schema-versioned effort.
5. Fill styles: no Offset Fill (P1-F).

Net: LF2 is "correct and safe on the toolpaths it produces, but misses several LightBurn
workflows operators use constantly." That is exactly a 6.5 on parity -- strong fundamentals,
breadth deficit.

---

## 6. What Would Move the Score to 9+

Prioritized, pure-core-first (high value / low risk first):

1. Fix P1-A (resumeJob write guard). One try-catch + a test. This is the only confirmed
   safety-adjacent defect; closing it lifts the streamer area from 6 toward 7-8 and removes the
   single biggest drag on the weighted total. Highest priority, smallest effort.
2. Expand raster dither to ~10 modes with a Jarvis default (P1-B) and add the grayscale
   min->max power floor (P1-C). Pure-core kernel reuse; closes the biggest engrave-quality gap.
3. Add per-layer Min Power + Constant/Variable toggle and wire it through emission (P1-C). Add
   per-layer tonal adjust on the engrave path (P1-D). Unlocks honest grayscale depth and photo
   quality.
4. Wire Start-From UI + 9-dot picker and add 'current-position' (P1-E). Mostly plumbing -- the
   anchor math is already correct for all 9 positions.
5. Add layer Move Up/Down (P2-A) and the small robustness items (origin exhaustiveness throw,
   SVG hex validation, empty-streamer filter).
6. Harden the test suite per the test reviewer: property-fuzz compileJob with degenerate
   scenes, add an unmocked raster-budget + compileJob integration test, inject real async Web
   Serial faults (write-fail, port-close mid-job), and add an end-to-end smoke test
   (scene file -> job -> gcode -> parse-as-GRBL -> verify).
7. Document the SVG unit convention (unitless == mm) and strip explicit unit suffixes (io P2).

Reaching a true 10 additionally requires what no amount of code review can supply at this
HEAD: empirical hardware burn validation on the Falcon A1 Pro -- emit a mixed cut+fill+raster
job, stream it to the machine, and confirm no stray marks on blanks/gaps and consistent power
on burns. The entire test suite is symbolic g-code analysis; the motion-profile and tonal math
are verified in math, not in scorch marks.

---

## 7. Appendix: Refuted / Overstated Findings (checked and dismissed)

Listing these so the rating is defensible -- they were verified against live code and excluded
from scoring.

R-1. "Raster preview pixel-grid dimensions differ from compile for non-front-left origins."
- Verdict: REFUTED (no defect). draw-raster-preview.ts:13-16 deliberately renders in scene
  space via drawBitmapAtTransform, and previewCanvasFor (lines 94-100) sizes the grid from
  `(bounds.maxX-minX) * |scaleX| * linesPerMm` -- the same axis-aligned extent compile uses via
  rasterBoundsInMachineCoords. Allowed raster transforms are position + scale only (rotation
  and mirror are blocked by preflight), and a device-origin coordinate flip preserves a
  rectangle's extent, so both paths compute identical pixel dimensions. A mismatch would arise
  only if rotation were allowed to bypass preflight, which the UI prevents. The reviewer's
  residual suggestion (apply orient to preview bounds, or add a parametrized device-origin
  test) is defense-in-depth, not a bug fix.

R-2. Layer reordering severity (input claimed P1).
- Verdict: DOWNGRADED to P2 (see P2-A). The feature is genuinely absent and cut order is fixed
  at import order, but it is not on LIGHTBURN-STUDY's high-priority DIVERGE list, and the audit
  input's citation to study line ~1215 is a false lead (that line is about compile-level path
  optimization, not layer-UI reordering). Real and worth doing -- just not P1.

---

Auditor's note on method: the number (7.5) is intended to be defensible to a skeptical
engineer reading the cited lines. The safety core verifies clean both by inspection and by
emitting and scanning real g-code; the one confirmed P1 is a stuck-stream, not a runaway beam,
so the no-P0 state is real; and the round-down from 7.69 reflects an honest breadth deficit vs
the project's own LightBurn benchmark plus the absence of any hardware burn validation.
