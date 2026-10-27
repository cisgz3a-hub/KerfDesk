# Rolling audit v3 — Image, raster and trace

- **When:** 2026-10-27   **Tree:** origin/main @ `9a2bf6b13` (audit worktree HEAD `0d3e6a516`;
  `git diff 9a2bf6b13 HEAD -- src` is empty). One later merge touches this scope: #1455
  (`d96943476`, ADR-673, kept trace photos engrave again). It is after the tree and is not audited
  here.
- **Scope:** `src/ui/image-editor`, `src/core/image-*`, `src/ui/raster`, `src/core/trace`,
  `src/ui/trace`, and the raster image path in `src/core/raster` (G1 covered raster G-code
  emission). Followed into twins outside the paths: `src/core/job/compile-job-raster*.ts`,
  `src/core/job/raster-rotated-sample.ts`, `src/ui/workspace/draw-raster-preview.ts`,
  `src/ui/workspace/registration-jig/jig-trace-*.ts`, `jig-image-trace.ts`.
  - Merges read (`git log --first-parent --since=2026-10-21T00:00 9a2bf6b13 -- <paths>`):
    - #1329 blue-noise dither (ADR-649);
    - #1365 trace windows (ADR-409 Amd 2, ADR-438 Amd 3, ADR-633 Amd 1);
    - #1371 Image Studio P2 fixes (ADR-311 Amd 2);
    - #1401 trace freeze (cooperative laser conditioning);
    - #1425 Image Studio repairs (resize aspect cap, gesture retirement, info readout);
    - #1442 tone calibration, image side (ADR-670), merged without CI;
    - #1443 lossless tones and sharpening (ADR-671);
    - #1346 Photo engraving host store guard.
  - Read only for context: #1330 (test-only), and #1351, #1353, #1398, #1400 and #1440 (emission,
    G1).
  - Governing ADRs: ADR-311 Amd 2, ADR-409 Amd 2, ADR-438 Amd 3, ADR-633 and Amd 1, ADR-649,
    ADR-670, ADR-671; background ADR-026, ADR-245, ADR-359, ADR-454, ADR-581.
- **Lenses run:** L8 (main), L3, L4, L7.
  - L1 was folded into L8: each merge was checked against the ADR it cites.
  - L2, L5 and L6 were skipped. The area's outside assumptions (Potrace, LightBurn, dither tables)
    were checked in rolling v2 reports 07 and 20. The only untrusted inputs are `.lf2` fields
    (20-P3-2) and image files, whose decode was not touched this week.
  - Repros were temporary `zz-g10-*.test.ts` Vitest files on images no larger than 400 × 400 px,
    run one file at a time. All are deleted.
- **Counts:** 2 raised → 0 refuted → P1 0 / P2 0 / P3 2 (+ 10 KNOWN).
- **Refuter (2026-10-27, fresh context):** 2 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED; no severity change.
  - G10-P3-1 is narrowed. The no-op needs a source about 3× or more coarser than the burn grid
    (radius 1). The auditor's own 600 px / 100 mm / 254 DPI example keeps about two thirds to
    three quarters of the effect. The "roughly halves on denser photos" half is refuted (see Refuted): the rotation's
    bilinear sampler softens the unsharpened burn just as much.
  - G10-P3-2's contract anchor is corrected to ADR-349, which states it directly.
  - Own repros (`zz-g10r-sharpen.test.ts`, `zz-g10r-jig-photo.test.ts`) were run one at a time
    with `node ../../../node_modules/vitest/vitest.mjs run <file>`, then deleted.
  - KNOWN G9-P2-1 confirmed by code reading. 20-P3-1, 07-P3-1 and 07-P3-2 spot-checked and still
    present. The #1371 opacity "Verified clean" claim holds (`editor-session-layers` 19/19).

## Headline

This week's fixes hold on the paths they patched and on the siblings checked:
- the Image Studio heal, opacity and kept-session fixes;
- the trace detector windows and the jig's Line + fill;
- cooperative trace conditioning;
- single-rounding tones.

The most important defect found is in G9's area, and G9 raised it first (G9-P2-1, KNOWN here).
The Preview raster cache key omits the ADR-670 tone curve. After a calibration is applied through
the real Photo engraving Apply, Preview keeps the uncalibrated burn: 16 dots against the 12 the
G-code burns. G10 reproduced this independently.

The two new findings are twins of this week's code, both P3:
- ADR-671 sharpening does nothing on a rotated photo whose source is about 3× or more coarser
  than the burn grid, and is weakened at 1.5–3×. (Refuter: the "about half on other rotations"
  part is refuted; that loss is the rotation's sampler, not the sharpen.)
- The jig tracer CNC-fairs Photo shading ribbons, which the Trace dialog deliberately keeps
  (ADR-349). Narrow highlight ribbons lose 4–6 % of their area. (Refuter: the loss depends on the
  image, up to 34 % on 0.2 px hairlines; every edge stays within 0.05 mm.)

## Findings

### G10-P3-1 — Sharpen at engraving resolution (ADR-671) vanishes on a rotated photo whose source is about 3× or more coarser than the burn grid

- **Where:**
  - `src/core/job/raster-rotated-sample.ts:167-205` (`prepareSharpenedRotatedRaster`). A rotated
    or angled-scan raster sharpens its sample grid. When `reducedSampleGrid` (`:126`) returns null,
    that grid is the source itself. It returns null for a source no denser than the burn grid
    (`reducedExtent`, `:207-211`) and for Threshold's nearest kernel.
  - `:190` passes `cells.alongWidth / sampleWidth`, which is above 1 burn cell per source pixel on
    an upscaled source.
  - `src/core/raster/luma-sharpen.ts:87-90` (`gridSigma`) then divides the radius, so 1 cell
    becomes sigma 0.2 source px.
  - `gaussianKernel` (`:190`) at sigma 0.2 is `[~4e-6, ~1, ~4e-6]`, so `v − blur ≈ 0`.
  - The upright path sharpens the burn grid itself (`compile-job-raster.ts:333-337`). The
    non-quarter-turn path samples the sharpened grid bilinearly, which low-passes it again.
- **Anchor:**
  - Twin: the upright burn-grid sharpen (`compile-job-raster.ts:333`) against the rotated
    sample-grid sharpen, for the same photo and settings.
  - Contract (ADR-671 Decision 2, "Sharpen at engraving resolution"): sharpening runs "on the
    burn grid itself", and on rotated images "the radius is converted so it stays the same size in
    millimetres".
  - The ADR claims parity only for "a quarter turn of a reduced source".
  - The Photo engraving hint promises the effect whatever the rotation:
    `PhotoEngravingFields.tsx:179` reads "Sharpens the eyes and hair … over 0.100 mm".
- **Scenario:**
  1. A 600 px wide web portrait is placed at 100 mm and engraved at 254 DPI (10 lines/mm), so the
     source is coarser than the burn grid.
  2. In Photo engraving, the user sets Sharpen 100 % at 1 line.
  3. Upright, the burn changes. After a 0.5° straightening rotation, or a 90° turn to fit the bed,
     the sharpening has exactly no effect.
  4. On a normal, denser photo, a 0.5° or 30° rotation gives about half the upright effect.
  - The Photo engraving preview shows the result, so this is not silent. But nothing tells the
    user that rotation turned the setting off.
- **Evidence:** REPRO. `node ../../../node_modules/vitest/vitest.mjs run src/core/job/zz-g10-sharpen-rotated.test.ts`.
  - Setup: real `compileRasterGroupsForLayer`, Grayscale at 100 %, 20 × 20 mm at 5 lines/mm
    (100 × 100 cells), sharpen 100 % at radius 1.
  - Metric: mean |ΔS| between sharpened and unsharpened, over the compiled cells (S max 1000).

    | Source | 0° | 90° | 0.5° | 30° |
    |---|---|---|---|---|
    | 20 × 20 px (coarser than the grid) | 34.56 (max 146) | **0.00 (max 0)** | **0.00** | **0.00** |
    | 400 × 400 px (denser) | 16.90 | 16.90 | 7.70 | 4.63 |

  - The rotated cases average over a larger bounding box (10201 and 18769 cells). Per image cell
    that is about 7.9 and 8.7, roughly half of upright.
  - L7: `compile-job-raster-sharpen.test.ts:177` asserts "Sharpening is live on every path, not
    silently skipped". Its "source coarser than the grid" case (`:150`) is upright only, and no
    case rotates a coarser source.
- **Refuter:** CONFIRMED, narrowed; P3 kept.
  - **What would make it false:**
    - a rotated path that does not sharpen an unreduced source at a sub-pixel sigma;
    - ADR text that sanctions it;
    - a preview that shows sharpening the burn lacks (that would make it P2, not false).
  - **Code:**
    - `prepareRotatedRaster` (`raster-rotated-sample.ts:86-87`) sends every sharpened rotated or
      angled-scan raster to `prepareSharpenedRotatedRaster`.
    - With `reducedSampleGrid` null, the sample grid is the source itself (`:173-178`).
    - `gridSigma` divides the radius by the cells per source pixel (`luma-sharpen.ts:87-90`).
    - At sigma ≤ 0.28 px the neighbour weight is ≤ 0.002, so even a 255-level step at 100 % moves
      a value by under 0.5, and the single rounding drops it.
  - **Own repro** (`zz-g10r-sharpen.test.ts`, deleted):
    - Setup: real `compileRasterGroupsForLayer`, Grayscale at 100 %, 20 × 20 mm at 5 lines/mm
      (100 × 100 cells), sharpen 100 % at 1 line.
    - Source: a different textured image with a hard diagonal edge from the auditor's.
    - Metric: detail boost, meaning high-pass detail (mean |S − mean of 4 neighbours|) sharpened ÷
      unsharpened, in the central 10 × 10 mm.

    | Source (over 100 cells) | 0° | 90° | 0.5° | 30° |
    |---|---|---|---|---|
    | 20 px (5 cells per px) | 1.98× | **1.00×** (max \|ΔS\| 0) | **1.00×** | **1.00×** |
    | 30 px (3.3) | 1.92× | 1.005× (max \|ΔS\| 2) | 1.005× | 1.005× |
    | 40 px (2.5) | 1.90× | 1.13× | 1.12× | 1.11× |
    | 60 px (1.67) | 1.90× | 1.59× | 1.58× | 1.45× |
    | 200 px (0.5, denser) | 1.93× | 1.93× (same bytes as 0°) | 1.67× | 1.82× |

  - **Correction to the Scenario.** Step 1's example (600 px over 100 mm at 10 lines/mm) is 1.67
    cells per source pixel, so sigma is 0.6 px. The rotated burn keeps about two thirds to three
    quarters of the upright effect (the 60 px row; mean |ΔS| 6.44 against 8.37 per image cell). It
    is not "exactly no effect".
    - The effect is gone only when the source is about 3× or more coarser than the grid at
      radius 1. One example is a 300 px web image at 100 mm and 254 DPI. At the 3-line maximum
      radius, the threshold is about 10×.
    - The effect is weak at 2.5×.
  - **ADR.** ADR-671 Decision 2 prescribes this path for rotated images. It sharpens "on the
    source-aligned sample grid, before the bilinear or centre sampler reads it". On an unreduced
    source, "the radius is converted so it stays the same size in millimetres".
    - The code does exactly that. The gap is a design consequence (a sub-pixel sigma on a coarse
      grid), not code drifting from the ADR, so a fix needs an ADR-671 amendment.
    - The anchors that hold are two. The twin: upright sharpens the upscaled burn grid. The UI
      hint: `PhotoEngravingFields.tsx:179` promises "Sharpens the eyes and hair … over X mm"
      whatever the rotation.
  - **Severity (§3): P3 kept.**
    - **Tones:** sharpening is local contrast. ADR-671 measured mean tone moving under 0.1 level
      at 30 %. Burned density does not change; only the requested edge boost is missing.
    - **No preview disagrees with the burn.**
      - The Photo engraving preview compiles the live, rotated object through
        `compileRasterGroupsForLayer` (`photo-engraving-preview.ts:29`). Its image is
        `photoEngravingImage(session.image, …)` (`use-photo-engraving-preview.ts:52-62`), and
        `session.image` is the scene object with its transform.
      - The canvas Preview compiles the same way (`draw-raster-preview.ts:267`).
      - So both show the unsharpened burn, and the user who looks sees no sharpening. That is
        not a misleading result.
    - **Save Processed Bitmap:** it sharpens the image-oriented grid (`processed-bitmap.ts:80-89`),
      so its file shows sharpening the rotated burn lacks. That is an export, not a pre-burn view,
      and it is the KNOWN 20-K-1 orientation gap.
  - **L7:** confirmed.
    - The "source coarser than the grid" case (`compile-job-raster-sharpen.test.ts:150`) is
      upright: 53 px over 80 cells.
    - The rotated cases use the same 53 px source over 30 cells, which is denser than the grid.
    - The "live on every path" check (`:177-178`) is `not.toEqual`, so one changed byte passes.
  - **Novelty:**
    - Nothing in `docs/audits/` names `gridSharpen`, `prepareSharpenedRotatedRaster` or rotated
      sharpening strength. G1 checked that the rotated path compiles, not its effect.
    - `gh pr list --state open` returns 0.
    - origin/main has not touched `raster-rotated-sample.ts` or `luma-sharpen.ts` since
      `9a2bf6b13`.
- **Fix direction:**
  - When the sample grid is coarser than the burn grid, sharpen after sampling: in the rotated
    path, that means on the burn-grid rows (which are already materialized there). Or say in the
    Photo engraving hint that rotation weakens it.
  - Add rotated-coarser and 0.5° cases that assert the effect size, not just stream equality.

### G10-P3-2 — The jig tracer CNC-fairs Photo shading ribbons, which the Trace dialog keeps unfaired because ribbon width is tone

- **Where:** `src/ui/workspace/registration-jig/jig-trace-import.ts:103-105`.
  `buildJigTraceObject` runs `fairTracedPathsForCnc` on every trace when
  `project.machine?.kind === 'cnc'`.
- **Anchor:**
  - Twin: the Trace dialog gates the same fairing with `shouldFairTracedImageForCnc`
    (`src/ui/trace/fair-traced-image-for-cnc.ts:6-11`, `machineKind === 'cnc' &&
    options.photoDetail === undefined`), used at `trace-machine-conditioning.ts:71`. Its reason is
    at `ImportImageDialog.tsx:405-406`: "Photo ribbon width encodes tone; generic contour fairing
    changes that coverage and can erase narrow highlights."
  - Contract: ADR-633 Decision 1, "The image is read the way Trace Image reads it". Decision 2:
    the commit replaces the image "as Trace Image does".
  - Same class as the 07-P2-3 / 07-P3-3 jig twins. ADR-633 Amendment 1 fixed only the trace mode.
- **Scenario:**
  1. On a CNC machine with a registration jig, a Pro user opens Edit jig, then Trace an image,
     and picks Photo shading. On CNC the picker says "All styles are available"
     (`dialog-parts.tsx:121`).
  2. The jig preview shows the unfaired ribbons.
  3. The committed trace is welded and faired, so highlight ribbons come out narrower: lighter
     tone than the preview and than the same trace made through Trace Image.
- **Evidence:** REPRO. `node ../../../node_modules/vitest/vitest.mjs run src/ui/trace/zz-g10-jig-photo-fairing.test.ts`.
  - Setup: real `traceImageToColoredPaths` with `TRACE_PRESETS['Photo shading']` on a 96 × 64
    grey ramp. Then the jig's own `fairTracedPathsForCnc` at 0.1, 0.25 and 0.5 mm per pixel.
  - `shouldFairTracedImageForCnc('cnc', photo)` = **false** (the dialog keeps the ribbons).
  - Total ribbon area, raw against jig-faired:

    | mm per px | Raw (px²) | Jig-faired (px²) | Change |
    |---|---|---|---|
    | 0.1 | 4120.4 | 4073.0 | −1.15 % |
    | 0.25 | 4120.4 | 4103.1 | |
    | 0.5 | 4120.4 | 4112.7 | |

  - Per ribbon at 0.1 mm/px, the narrowest ribbons lose the most:
    - 31.5 px² −5.6 %, 29.2 px² −5.4 %, 17.4 px² −5.2 %;
    - mean −3.9 % over the 13 ribbons under 40 px².
- **Refuter:** CONFIRMED, P3 kept. Anchor corrected.
  - **What would make it false:**
    - the jig commit gating fairing the way the dialog does;
    - Photo shading being unreachable in a CNC jig;
    - fairing that leaves ribbon geometry alone.
  - **Code.** `buildJigTraceObject` fairs whenever `project.machine?.kind === 'cnc'`
    (`jig-trace-import.ts:103-105`). It has no `photoDetail` check, and that file is unchanged on
    origin/main since `9a2bf6b13`.
    - The dialog's `conditionTracedImageForMachineSteps` gates fairing on
      `shouldFairTracedImageForCnc` (`trace-machine-conditioning.ts:71`).
    - The Photo shading preset sets `photoDetail: 60` (`trace-presets.ts:63`).
    - The jig's commit also keeps the raw `bounds` after fairing. The dialog recomputes them
      (`fair-traced-image-for-cnc.ts:17`). This is negligible: inside 0.05 mm.
  - **Reach.**
    - The jig's preset picker passes the machine kind (`JigTraceControls.tsx:32-34`, `:62`).
      On CNC Pro it offers every style, Photo shading included.
    - The Registration Jig command is laser-only (`machine-command-gate.ts:43`, ADR-101 Decision
      2). But the jig bar's **Edit jig** (`RegistrationJigPanel.tsx:29-36`) checks only for
      registration boxes, and `setMachineKind` keeps the scene.
    - So a jig project switched to CNC, or opened on a CNC machine, reaches this path. The
      builder's own CNC branch shows the author expected that.
  - **Own repro** (`zz-g10r-jig-photo.test.ts`, deleted):
    - Setup: a 120 × 80 px radial-plus-ramp portrait, traced by the real
      `traceImageToColoredPaths` with `TRACE_PRESETS['Photo shading']`. The trace went through
      the real `buildJigTraceObject` (CNC and laser projects) and the dialog's real
      `conditionTracedImageForMachine(…, 'cnc', {options})`, at 0.1 mm/px.
    - The dialog returned the same path array (`===`), with area 5971.2 px². So did the laser
      jig.
    - The CNC jig returned new paths: 5869.4 px², **−1.7 %**, 79 polylines in both. The per-ribbon
      change runs from −0.5 % to −6.5 % on most ribbons.
    - The six hairline highlight ribbons (0.2 px wide, 16–21 px²) lost **33.9 %** each. Two
      corners were cut within the 0.05 mm deviation budget.
    - So two independent lines (the real jig builder against the real dialog helper, and the
      auditor's ramp) agree. The size of the loss depends on the image.
  - **Anchor.** ADR-633 Decisions 1–2 ("read the way Trace Image reads it"; "as Trace Image does")
    cover reading the source and replacing the image, not commit conditioning. The direct
    contract is **ADR-349** (`docs/decisions/ADR-349-photo-shading-trace.md:30-32`): "CNC commits
    preserve the reviewed ribbon geometry, because generic contour fairing changes the narrow
    widths that carry tone." The twin anchor stands as written.
  - **Severity (§3): P3 kept.**
    - **Not P1:** fairing moves the cut at most `CNC_TRACE_MAX_DEVIATION_MM` = 0.05 mm
      (`cnc-trace-fairing.ts:28`). The trace's own pixel quantisation is ±0.045 mm at 254 DPI (same
      comment), so position, scale and depth stay within the trace's precision.
    - **Area:** total ribbon area moves 1.15–1.7 %. The ribbons that change most are ≤ 0.02 mm
      wide, below any cutter.
    - **What is shown:** the committed, faired geometry is what the canvas and the CNC preview
      show and what is cut. Only the jig's pre-commit preview differs, and only at under 0.05 mm.
    - **Not P2:** an ordinary user does not hit it, because the jig is a laser-only tool reached on
      CNC only by switching or opening a jig project. The result is invisible at that scale rather
      than misleading.
    - **Precedent:** 07-P3-3 has the same root (the jig skips the dialog's commit conditioning)
      and a larger power effect, and it was kept P3.
  - **Novelty.** This symptom is new: no audit names `shouldFairTracedImageForCnc` or jig ribbon
    fairing. But it shares 07-P3-3's root and fix (route the jig commit through the dialog's
    conditioning helper). 07-P3-3 already cites `jig-trace-import.ts:102-107` as "CNC fairing
    only" without noticing the Photo exception. Coordinator: ledger it on 07-P3-3's fix card.
  - **Side note (not raised; G9/H-area):** ADR-101 Decision 1 (`DECISIONS.md`) says laser-only
    surfaces are "hidden … while the other family is active". The jig bar showing **Edit jig** on a
    CNC project may itself drift from that gate-and-hide rule.
- **Fix direction:** Build the jig's commit through `conditionTracedImageForMachine` (or at least
  `shouldFairTracedImageForCnc`), so it matches the dialog for every preset. The same helper would
  also close 07-P3-3.

## Known (not raised as new)

- **G9-P2-1** (canvas-scene, raised first; reproduced independently here). The Preview raster cache
  key (`draw-raster-preview.ts:166`, `adjustmentKey` `:306-308`) omits `photoToneCurve`.
  - The G10 repro (`zz-g10-tone-curve-preview.test.ts`, deleted) used the real `photoEngravingImage`
    Apply of a calibration only (`initialPhotoEngravingDraft` plus a curve), on Jarvis.
  - Result: `apply changed object=true sameDataUrl=true`. Before: built 1, preview = compile, 16
    burned px. After Apply: built 1, preview **16** burned px, compile **12**, `equal=false`.
  - Undo restored the match only because the stale canvas happened to be the pre-curve one.
  - An operation-level curve change (no override) misses the same way. With Grayscale, pixel 4
    stays at 177 while the G-code burns 233.
  - G9 already covers the fix, so it is not double-counted.
  - **Refuter: confirmed by code reading alone.**
    - `previewSettingsKey` (`draw-raster-preview.ts:158-167`) and `adjustmentKey` (`:307-309`)
      never mention the curve. The file has 0 hits for `photoToneCurve`.
    - Compile applies the curve: `compile-job-raster.ts:160` calls
      `prepareImageLuma(sourceLuma, obj, layer)`, which calls `applyPhotoToneCurve(…,
      settings.photoToneCurve)` (`image-processing.ts:17-28`).
    - The cache record survives a new object reference. `recordFor`
      (`raster-preview-cache.ts:105-115`) matches by id plus `sameRasterContent` (`:61-71`), which
      checks only `dataUrl`, luma, asset, size and clip. So an Apply that changes only the curve hits the old key and reuses the old canvas.
- **07-P3-1:** Line + fill still uses the fractional taper. `trace-work-budget.ts:66` excludes
  only `centerline` and `edge`, and ADR-438 Amd 3 "Not part of this amendment" says so.
  (Refuter spot-check: `taperedSupersampleFactor` still returns null only for `centerline` and
  `edge`.)
- **07-P3-2:** Optimize 0 still scales tolerances by 0.85 (`trace-optimize.ts:10-14`).
  (Refuter spot-check: `1 + (0 − 0.2) × 0.75` = 0.85, floor 0.25; still present.)
- **07-P3-3:** The jig still skips colour-layer powers, as ADR-633 Amd 1 Consequences says. The
  jig also never runs laser conditioning; see 07's Refuted section, where compile flattens anyway.
- **20-P3-1:** NaN tones still resolve to black after #1443. `clampLevel(NaN)` is 0
  (`luma-adjust.ts:53-55`), so `{brightness: NaN}` gives an all-black LUT. G1 re-ran it.
  (Refuter spot-check: NaN passes `?? 0` and `brightness !== 0`, then `clampLevel` returns 0 for
  every level. Still present.)
- **20-P3-2, extended:** `.lf2` accepts any finite value for the new `sharpenAmount` and
  `sharpenRadius` too (`project-shape-validator.ts:328-330`).
  - Compile clamps them (`luma-sharpen.ts:56-67`), so the burn stays bounded.
  - The Photo engraving window, though, seeds its draft unclamped
    (`photo-engraving-settings.ts:40-41`). A stored 900 % then makes Apply fail validation
    (`photo-engraving-apply.ts:216`, `:226-231`) until the user edits the field.
  - This needs a hand-edited file.
- **20-K-1 (F20):** Save Processed Bitmap still dithers the image-oriented grid
  (`processed-bitmap.ts:106-109`, no orientation step).
- **#1401 leftover hitches:** the PR #1401 body lists these under "Not changed / remaining":
  - CNC fairing still runs in one task;
  - worker-result deserialisation takes 0.6–0.9 s at 9 MP;
  - the finer commit grid's `getImageData` decode takes 1–3 s.
- **G1-P3-2, G3-P3-2:** tone calibration power scale, and Copy/Paste dropping the curve. These
  were met again in `photo-engraving-apply.ts` and `PhotoEngravingDialog.tsx:153-170`; nothing new.
- **23-P3-1..P3-9 and 23-K-1..K-5:** the image editor items #1371 did not address. They are still
  present in the files read (for example `image-editor-store.ts` Delete fills white, and
  `mask-morphology.ts` feather quantisation). They were not re-measured.

## Refuted

Refuter (2026-10-27):

- **G10-P3-1, second half: "ADR-671 sharpening roughly halves on any other non-quarter-turn
  rotation of a denser photo".** Refuted as a sharpening defect.
  - The halving is in absolute |ΔS|. It comes from the bilinear sampler that every non-quarter-turn
    rotation applies (`raster-rotated-sample.ts:203`), and that sampler softens the unsharpened
    burn just as much.
  - In the refuter's repro (200 px over 100 cells), high-pass detail of the *unsharpened* burn fell
    from 5.96 (0°) to 2.34 (0.5°) and 3.05 (30°).
  - Relative to its own rotated burn, sharpening still boosted detail 1.67× (0.5°) and 1.82× (30°),
    against 1.93× upright. A quarter turn gave bytes identical to upright.
  - ADR-671 Decision 2 places the sharpen "before the bilinear or centre sampler reads it" on
    purpose. The softer rotated burn is the rotation's resampling, which the sharpen setting does
    not promise to undo.

Auditor-dropped candidates (checked and not raised):

- **A non-photo image on a pass-through operation: Photo engraving Apply forces Pass-through off
  and a photo dither.** This is by design. ADR-581 and `photoDither` start other modes on Jarvis,
  and the window shows the dither it will write.
- **The kerf Thicken gate ignores the ADR-670 curve** (`editor-kerf-thicken-target.ts:154-161`
  checks tones and sharpen, not the curve). Not a defect:
  - the gate only admits Threshold or Grayscale;
  - the repair paints black;
  - the curve is pinned 0 → 0 (`photo-tone-curve.ts:133-134`), so painted black still burns
    `blackS`.
- **A fractional `thresholdAt` coordinate makes the new throwing `localMean` abort a trace.** Every
  caller floors its coordinates (`contour-boundary.ts:130-133`, `saddle-connectivity.ts`,
  `automatic-detail-mask.ts`), and the sketch radius is whole (`sketch-window.ts:28-30`).
- **A stash resumes after a `lumaBase64`-only change** (`ownersShareSource` does not compare luma).
  No writer changes luma without `dataUrl`: the writers grepped are import, Studio Apply, Crop,
  stamp and SVG hydration.
- **An Apply in flight, then Close, then a nudge drops the Apply silently.** ADR-311 Amd 2 states
  it ("a decode or Apply that finishes after its object was replaced still silently no-ops"), and
  the stash keeps the session dirty, so no edit is lost.
- **Multi-File Trace Line + fill** never builds a `traced-image`: it writes SVG/DXF files. The only
  two `traced-image` constructors (`ImportImageDialog.tsx:379`, `jig-trace-import.ts:88`) both
  use `traceModeForOptions`.
- **Raster trace output of Line + fill outlines its fills** (`trace-raster-output.ts:91`). Not
  reachable: raster output is disabled for Line + fill (`dialog-parts.tsx:183`).

## Verified clean

- **#1371 Image Studio:**
  - Heal samples the active layer's ring with alpha weighting, and from the composite only on an
    empty upper layer (`editor-session-retouch.ts:50`, `:68-77`; `spot-heal.ts`).
  - The opacity slider previews without history and commits one step on `change`, blur or unmount
    (`LayersPanel.tsx:257-304`). No other Studio range control records history (AdjustDialog,
    ColorPicker and EditorOptionsBar are tool or preview state).
  - The kept session resumes on settings-only changes. Photo engraving Apply and Adjust Image keep
    `dataUrl`, size and bounds, so they resume. A pixel change warns.
  - Tests pass: `image-editor-reopen` 2/2, `editor-session-retouch` 6/6, `editor-session-layers`
    19/19.
  - **Refuter spot-check (opacity): holds.**
    - `previewLayerOpacity` (`editor-session-layers.ts:190-203`) writes with a null history label.
    - `commitLayerOpacity` (`:206-218`) records one "Layer opacity" step from `startOpacity`, and
      none when the value is back at the start.
    - The slider (`LayersPanel.tsx:262-304`) commits on the native `change`, on blur, on unmount,
      and when the drag moves to another layer.
    - `editor-session-layers.test.ts` re-run: 19/19, including the "opacity slider drag (audit
      23-P2-2)" block.
- **#1365 windows:**
  - Every detector window reads `detectorWindowScale`: sketch, automatic detail, Faint lines,
    light-solid fill, Edge neighbourhood and region-enhance context.
  - The downscale route resets it (`trace-downscale-options.ts:25`).
  - Multi-File Trace (`multi-file-trace-action.ts:303`) and the CLI (`run-trace-cli.ts:143`) use
    `traceOptionsForCommitGrid`.
  - Photo shading keeps the preview grid (`trace-commit-grid.ts:187-198`).
  - The jig traces only its preview grid, so it has no preview/commit split.
  - The jig's Line + fill keeps `hybrid` through the shared `traceModeForOptions`.
- **#1401:** cooperative laser conditioning gives the same geometry as the one-task run, and the
  owner is re-claimed with a machine check after the slices (`trace-machine-conditioning.test.ts`
  8/8).
- **#1443 tones:** one LUT feeds every tone consumer. Only `luma-adjust.ts` computes the curve, and
  the consumers are compile (materialized, streamed, rotated), the Photo engraving preview, Save
  Processed Bitmap, the Adjust Image preview and the canvas adjusted display.
- **#1443 sharpen:**
  - It is keyed in the Preview cache (`draw-raster-preview.ts:306-308`).
  - Kerf Thicken excludes it.
  - The streamed row source gets a fresh row array per call, so the sharpen row cache cannot alias
    it (`luma-resample.ts:100-104`).
  - It is off for Pass-through.
  - The Photo engraving preview and Apply carry it.
  - `photo-engraving-sharpen.test.ts` passes 6/6.
- **#1442 image side:**
  - `prepareImageLuma` applies tones, then Negative, then the curve, in every path that starts
    from it.
  - Save Processed Bitmap resolves the effective operation, so a photo override's curve is
    included.
  - The Photo engraving preview builds from the same `photoEngravingImage` as Apply.
  - `photo-engraving-tone-curve.test.ts` passes 4/4. The core #1442 tests were run by G1, and the
    dialog test by G6.
- **#1329 blue noise:** every dither picker draws from `DITHER_ALGORITHMS` or `PHOTO_DITHERS`
  (Adjust Image, layer settings, Photo engraving). Its noise hashes grid indices, so the Preview
  cache's translation reuse is safe.
- **#1425:** the locked-aspect resize caps both edges together, a held gesture retires on a
  session, tool or owner change, and the info readout reads the displayed composite.

## Not verified

- No browser run. Real decodes of CMYK and 16-bit PNG, EXIF-rotated phone photos, and >100 MP
  images were not exercised; only the ADR-404 header path was read.
- Large-image timings were not measured. Not timed: sharpening a rotated Threshold photo on its
  full unreduced source (sigma capped at 12 px), the Preview build for sharpened streamed grids,
  and the #1401 leftovers. The PC was low on memory.
- The heavy #1365 tests were not re-run: `sketch-window-tapered-grid` and
  `trace-commit-detector-windows` trace up to 3000 × 1200 px. They merged with CI.
- `e2e/photo-tone-calibration.e2e.ts` and `e2e/photo-engraving-numbers.e2e.ts` were not run.
- Not checked:
  - whether MCP or the phone can change a raster while Image Studio or the Trace dialog is open;
  - if they can, Apply silently no-ops (`image-editor-lifecycle.ts:184`), and so do Close and the
    post-conditioning claim (`ImportImageDialog.tsx:422`).
- The rolling-v2 area 23 P3 items were not re-measured.

```json
[
  {"id":"G10-P3-1","severity":"P3","area":"image-raster-trace","file":"src/core/job/raster-rotated-sample.ts","line":167,"anchor":"Twin: upright burn-grid sharpen (compile-job-raster.ts:333) vs rotated sample-grid sharpen; UI hint PhotoEngravingFields.tsx:179 (\"over X mm\"); ADR-671 Decision 2 prescribes the sample-grid sharpen with a millimetre-constant radius, so the gap is ADR-level design, not code drift","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Narrowed. Own repro (real compileRasterGroupsForLayer, Grayscale, 100x100 cells, 100% at 1 line, different textured source): detail boost upright 1.90-1.98x; rotated 90/0.5/30 deg 1.00x at 5 cells/px, 1.005x at 3.3, ~1.12x at 2.5, 1.45-1.59x at 1.67. The auditor scenario (600 px/100 mm/254 DPI = 1.67) keeps 2/3-3/4 of the effect, not zero. The halves-on-denser-photos half is refuted (bilinear sampler softens the unsharpened burn equally; relative boost 1.67-1.82x vs 1.93x; quarter turn byte-identical). P3 kept: mean tone unchanged; Photo engraving preview and canvas Preview both compile the rotated object, so no preview shows sharpening the burn lacks (Save Processed Bitmap does, but that is the KNOWN 20-K-1 export gap)","known":false,"summary":"ADR-671 sharpening is a no-op on a rotated or angled-scan photo whose source is about 3x or more coarser than the burn grid (radius 1; ~10x at radius 3) and weakened at 1.5-3x, because the radius is converted to a sub-pixel sigma on the source grid; upright sharpens fully. The sharpen test never rotates a coarser source and only asserts inequality"},
  {"id":"G10-P3-2","severity":"P3","area":"image-raster-trace","file":"src/ui/workspace/registration-jig/jig-trace-import.ts","line":103,"anchor":"Contract: ADR-349 (docs/decisions/ADR-349-photo-shading-trace.md:30-32, CNC commits preserve the reviewed ribbon geometry); Twin: shouldFairTracedImageForCnc (fair-traced-image-for-cnc.ts:6) used by trace-machine-conditioning.ts:71. ADR-633 Decisions 1-2 cover source reading and replacement only","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro through the real buildJigTraceObject vs the real conditionTracedImageForMachine on a Photo shading trace of a different image (120x80, 0.1 mm/px): dialog and laser jig return the same paths (===), CNC jig -1.7% total area, hairline 0.2 px ribbons -33.9%. Reachable: Edit jig bar ignores machine kind and setMachineKind keeps the scene, though tools.registration-jig is laser-only. P3 kept: fairing is bounded at 0.05 mm (within the trace own +-0.045 mm quantisation), the faired geometry is what canvas and CNC preview show and cut, not an ordinary-user path; same root and fix as 07-P3-3","known":false,"summary":"Jig tracer CNC-fairs every trace including Photo shading, whose ribbon width is tone (ADR-349 says CNC commits keep it); ribbon area -1.15 to -1.7% overall, up to -34% on hairline highlights, versus the dialog commit and the jig own preview. Shares 07-P3-3 root (jig skips the dialog commit conditioning)"},
  {"id":"G9-P2-1","severity":"P2","area":"canvas-scene (reproduced by G10)","file":"src/ui/workspace/draw-raster-preview.ts","line":166,"anchor":"Contract: ADR-670 Verification and limits; Twin: compile prepareImageLuma with photoToneCurve","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Code reading only: previewSettingsKey (:158-167) and adjustmentKey (:307-309) omit photoToneCurve (0 hits in file); compile-job-raster.ts:160 prepareImageLuma applies it (image-processing.ts:17-28); recordFor (raster-preview-cache.ts:105-115) reuses the record across new object references with the same content","known":"G9-P2-1 (raised first by G9)","summary":"Preview cache key omits photoToneCurve; real photoEngravingImage Apply of a calibration only leaves Preview at 16 burned px vs 12 compiled (Jarvis)"},
  {"id":"07-P3-1","severity":"P3","area":"trace","file":"src/core/trace/trace-work-budget.ts","line":66,"anchor":"ADR-438 clause 3","evidence":"READ","verdict":"CONFIRMED","refuter":"Spot-check: taperedSupersampleFactor still returns null only for centerline and edge","known":"rolling-v2 07-P3-1 (ADR-438 Amd 3 excludes it)","summary":"Line + fill still uses the fractional supersample taper"},
  {"id":"07-P3-2","severity":"P3","area":"trace","file":"src/core/trace/trace-optimize.ts","line":10,"anchor":"LightBurn Trace Image: 0 = no optimization","evidence":"READ","verdict":"CONFIRMED","refuter":"Spot-check: 1 + (0 - 0.2) * 0.75 = 0.85, still present","known":"rolling-v2 07-P3-2","summary":"Optimize 0 still scales tolerances by 0.85"},
  {"id":"07-P3-3","severity":"P3","area":"trace (jig)","file":"src/ui/workspace/registration-jig/jig-image-trace.ts","line":84,"anchor":"ADR-461; ADR-633 Amd 1 Consequences","evidence":"READ","verdict":"KNOWN","known":"rolling-v2 07-P3-3","summary":"Jig trace still skips colour-layer darkness powers; G10-P3-2 is a new symptom of the same root"},
  {"id":"20-P3-1","severity":"P3","area":"raster","file":"src/core/raster/luma-adjust.ts","line":53,"anchor":"Twin neutral fallbacks","evidence":"READ","verdict":"CONFIRMED","refuter":"Spot-check: NaN passes ?? 0 and brightness !== 0; clampLevel(NaN) returns 0 for every level","known":"rolling-v2 20-P3-1 (G1 re-ran after #1443)","summary":"Non-finite tones still give an all-black LUT after the single-rounding rewrite"},
  {"id":"20-P3-2","severity":"P3","area":"raster","file":"src/io/project/project-shape-validator.ts","line":328,"anchor":"Contract: documented ranges","evidence":"READ","verdict":"KNOWN","known":"rolling-v2 20-P3-2, extended to sharpenAmount/sharpenRadius","summary":".lf2 accepts any finite sharpen values; compile clamps, but Photo engraving seeds the draft unclamped and Apply then fails validation"},
  {"id":"20-K-1","severity":"P3","area":"raster","file":"src/ui/raster/processed-bitmap.ts","line":106,"anchor":"Twin: compile orients then dithers","evidence":"READ","verdict":"KNOWN","known":"2026-07-17 F20 / rolling-v2 20-K-1","summary":"Save Processed Bitmap still dithers the image-oriented grid (and, per the G10-P3-1 refuter, sharpens it even where the rotated burn does not)"},
  {"id":"PR1401-remaining","severity":"P3","area":"trace","file":"src/ui/trace/trace-machine-conditioning.ts","line":71,"anchor":"PR #1401 Not changed / remaining","evidence":"READ","verdict":"KNOWN","known":"PR #1401 body","summary":"CNC fairing still one task; 0.6-0.9 s worker-result deserialisation at 9 MP; 1-3 s getImageData decode for a finer commit grid"}
]
```
