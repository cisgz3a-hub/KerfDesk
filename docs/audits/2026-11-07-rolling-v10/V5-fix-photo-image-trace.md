# Rolling audit v10 — V5 Fix: photo, image and trace (#1555, #1557, #1578, #1586, #1587, #1594)

- **When:** 2026-11-08 about 04:00–05:00 (+0800)   **Tree:** origin/main @ `5f09e1110` (scratchpad export `j10-main`); 1.0.29 = `df2279e26` (scratchpad `zz-v2/old29`, three trace and loader files checked byte-equal to `df2279e26`)
- **Scope:** the six fix PRs and their governing ADRs. ADR-581 Amendment 1 (#1555), ADR-357 Amendment 3, ADR-598 Amendment 3 and ADR-288 Amendment 3 (#1557), ADR-245 Amendment 1 (#1578), ADR-530 Amendment 15 (#1594). #1586 and #1587 have no ADR; they are recorded in `docs/audits/2026-11-02-performance-s1/P3-SWEEP.md`. Original findings: U3-P2-3, S3-P2-1, S3-P2-2, S5-P2-1, S5-P3-1, S5-P3-3 and S6-P3-3.
- **Lenses run:**
  - L10: original repros, siblings, ADR against code, test truth by reading.
  - L3: preview against burn, worker decode against 1.0.29's decode, traced paths against 1.0.29.
  - L4 and L6: by reading, plus Node repros where the code is DOM-free.
  - **L12:** only #1594 of this area merged without CI on main, and its related e2e specs and the desktop build were **not run**. The browser gate (3 GB free) was never met: free memory stayed between 680 and 1,230 MB all session. The Vitest gate (1.5 GB) was never met either.
- **Counts:** 3 raised → 0 refuted (refuter pending) → P1 0 / P2 0 / P3 3 (+ 0 KNOWN)

## Headline

All six fixes hold where I could run them, and none changes the burn.
- **Traces.** Across 7,345 traces, plus 1,000 on the cooperative runner, the traced paths are byte-identical to 1.0.29 across all 8 presets, the LightBurn-style overrides and the dialog's frozen-option route. No trace differed.
- **Photo engraving.** The 12 MP phone photo that showed "~140 MB materialized working set exceeds the 64 MB budget" at every size on 1.0.29 now previews at 30, 100 and 360 mm.
- **Streamed preview against the materialized burn.** The preview's streamed compile matches the burn's materialized compile row for row, across 72 cases: every dither, negative, rotation, mirror, clip, mask, scan angle, cross-hatch, multi-pass, lines/mm, power floor, pass-through and tone.
- **Luma decoder.** The rewritten base64 luma decoder matches 1.0.29's on 200,000 fuzzed strings.

The three P3s:
- **V5-P3-1.** Image Studio's fit-view Threshold and Posterize preview (#1578) differs from what OK produces over whole textured areas, not "a screen pixel" as ADR-245 Amendment 1 says.
- **V5-P3-2.** The worker decode's byte-identity, which is burn input, rests on one manual browser measurement. No regression test covers it.
- **V5-P3-3.** #1587 adds two new workers, one per Preview raster build and one per Trace decode, outside the shared worker memory lane. No ADR records this.

The real-browser identity of the worker decode (EXIF, ICC profiles, CMYK, 16-bit, GIF/WebP, huge images) could not be run here. It is the main item under "Not verified".

## Findings

### V5-P3-1 — Image Studio's fit-view Threshold / Posterize preview misstates textured areas, not just edges: on a grainy photo 13–17% of screen pixels differ by more than 32 levels from what OK produces, on a halftoned scan 22–24% differ by more than 96

- **Where:** `src/ui/image-editor/adjust-preview-window.ts:101-106` (`computeWindowPreview`). Pointwise adjustments run `runAdjustment` on `ws.activeBase`, the area-averaged window made by `sampleWindowInto` (`:168-189`). The committed result is `commitAdjustment` over full resolution (`editor-adjust-session.ts:14-31`), and the canvas then draws it small.
- **Anchor:**
  - **Twin.** The dialog preview should show what OK produces (ADR-245 decision 5, "One composite path"), and before #1578 it did.
  - **Contract.** ADR-245 Amendment 1, decision 6 (`docs/decisions/ADR-245-amendment-1-image-studio-previews-adjustments-at-display-resolution.md:45-49`) bounds the difference: "a Threshold edge can differ by a screen pixel from the full-resolution result drawn small."
- **Scenario:** a user opens a phone photo with ordinary sensor grain in Image Studio at fit view and drags Threshold. The preview shows clean black and white. OK gives a speckled result, which looks grey at fit, wherever the photo's mid-tones sit near the level. Threshold(average) is not average(Threshold), and a halftoned scan of a printed photo shows this most.
  - On the halftone, the preview is 33–42 levels lighter on average.
  - Moving the level from 128 to 100 changes the preview, but not the committed result.
- **Evidence:** **REPRO**, Node, real modules from `j10-main` bundled with esbuild. Scripts: `scratchpad\zz-v5\studio-twin.mjs` and `studio-halftone.mjs`. The "shown" image is the committed composite area-averaged to the same window, my stand-in for the browser's downscale. A 2000 × 2000 document:

  | Document | Adjustment | Scale | Pixels off > 32 | Pixels off > 96 | Mean luma, preview / OK shown |
  |---|---|---|---|---|---|
  | Astronaut, clean | Threshold 128 | 0.25 | 4.5% | 1.1% | 129.3 / 129.4 |
  | Astronaut + grain σ 14 | Threshold 128 | 0.25 | **16.5%** | 3.6% | 129.3 / 128.5 |
  | Astronaut + grain σ 14 | Threshold 128 | 0.5 | 13.6% | 4.5% | 129.5 / 128.5 |
  | Astronaut + grain σ 14 | Posterize 3 | 0.25 | 7.9% | 0 | 124.5 / 122.8 |
  | Astronaut + grain σ 14 | Levels γ 1.6 | 0.25 | 0 | 0 | 143.8 / 142.2 |
  | Halftoned scan (8 px pitch) | Threshold 128 | 0.25 | — | **21.7%** | **151.2 / 117.9** |
  | Halftoned scan | Threshold 100 | 0.25 | — | 23.5% | 160.3 / 117.9 |
  | Every document, every adjustment | | 1.0 | 0 | 0 | equal (decision 6 holds at 100%) |

  The e2e `e2e/image-studio-adjust-preview.e2e.ts:48` asserts that the fit-view preview is over 90% pure black or white, which pins the cleaner-than-OK look rather than OK's result.
- **Severity:** **P3.**
  - It is display only. OK commits the full-resolution result unchanged; the golden test pins those pixels, and I read that `runAdjustment` equals 1.0.29's `runOp`. After OK, the canvas shows the truth before anything burns.
  - The fault is the ADR's understated consequence and a preview that misleads while the user picks the level.
  - A refuter could argue P2 ("misleading result"), because 1.0.29's preview was exact.
- **Novelty:** new. `docs/audits` has no report on `adjust-preview-window`, and no open PR touches it.
- **Refuter:** PENDING.
- **Fix direction:** two options.
  - For the discontinuous pointwise adjustments (Threshold, Posterize, and Remove white background with cleanup), keep the cheap window but compute it as average(adjust(full-resolution window pixels)), with the window's source pixels read once per step. This is still O(window × scale⁻²) with no document-sized allocation.
  - Or keep the current preview and correct ADR-245 Amendment 1 decision 6 to say that textured areas differ.

### V5-P3-2 — The worker routes' luma and trace pixels are burn input, but their byte-identity with the in-window decode has no regression test; only a one-time manual measurement in one Chrome on one GPU

- **Where:**
  - `src/ui/import/image-luma-worker-client.ts:29-46` and `:49-57` (`createImageBitmap(canvas)` snapshot, then a 1:1 redraw and readback on an `OffscreenCanvas` in `image-luma-worker.ts`).
  - The same pattern for Trace: `src/ui/trace/off-thread-trace-decode.ts:35-49`.
  - Their tests: `src/ui/import/image-luma-decode.test.ts:67-102` and `src/ui/trace/off-thread-trace-decode.test.ts` hand in fake contexts that return the input RGBA. They check the arithmetic, not the snapshot and readback.
- **Anchor:** **Contract.** ADR-357 Amendment 3 decision 2 (`docs/decisions/ADR-357-amendment-3-photo-import-decodes-in-a-worker.md:35`): "The bytes may not change, so the canvas may not change either". The same section records that a first worker version changed JPEG luma by 1 in about a third of the bytes. The PR's identity evidence is the manual 6-fixture SHA-256 comparison (`:72-77`). The ADR lists as not measured "the packaged desktop app and a PC without GPU canvas acceleration" (`:85-86`). The performance audit rule requires byte-identical burn input.
- **Scenario:** the stored `lumaBase64` is the compiler's only image input. A future Chromium or Electron change could alter what a canvas snapshot redraws to. Examples are colour-managed snapshots, premultiplied-alpha rounding in the GPU-to-CPU path, or a different `OffscreenCanvas` default colour space. Any of them would change every new photo import's burn by a level or so with nothing failing. The UI-thread fallback (no Worker, a masked source, or a worker error) would keep the old bytes, so two imports of the same photo could burn differently.
- **Evidence:** **READ**, plus a REPRO of the arithmetic.
  - `scratchpad\zz-v5\luma-twin.mjs`: the worker's composite, luma and base64 equal 1.0.29's `compositeRgbOverWhitePreservingAlpha` + `extractLumaBase64` on 7 RGBA grids (every alpha value, widths 1–16,385).
  - The trace readback equals 1.0.29's composite byte for byte.
  - `bytesToBase64` equals `Buffer.toString('base64')` natively and chunked, at the 48 KiB boundaries and at 1 MB.
  - The real-browser readback could not be run here (memory gate).
  - No e2e compares the two routes: `grep -rln lumaBase64 e2e` returns 9 specs, and none of them forces both routes.
- **Severity:** **P3** (missing test on a burn-input invariant). No difference is shown.
- **Novelty:** new. The PR body states the manual check. No audit or open PR adds a guard.
- **Refuter:** PENDING.
- **Fix direction:** add an e2e that imports 6–8 real fixtures through both routes and compares the `lumaBase64` SHA-256 in the same page. Force the fallback with a test hook such as `offThreadImageDecodeAvailable`. The fixtures should cover EXIF 6 and 3 JPEGs, an ICC-tagged JPEG, CMYK JPEG, 16-bit PNG, a PNG with every alpha value, an animated GIF and a resized wide JPEG. Run the same check in the desktop smoke if it can host Playwright.

### V5-P3-3 — #1587 adds two workers outside the shared worker memory lane with no ADR: one per canvas-Preview raster build, started back to back for every photo in Preview, and one per Trace decode

- **Where:**
  - `src/ui/workspace/raster-preview-worker-client.ts:31` (one `new Worker` per build, no `reserveWorkerMemory`).
  - `src/ui/workspace/draw-raster-preview.ts:292` (each cache miss builds through it).
  - `draw-raster-preview.ts:307` (`setTimeout(work, 0)` per object, so N photos start N workers at once).
  - `src/ui/trace/off-thread-trace-decode.ts:57`.
- **Anchor:** **Contract.**
  - ADR-598 decision 2 (`docs/decisions/ADR-598-performance-worker-and-cache-budgets.md:12`): "Retain one active heap in the shared worker memory lane."
  - ADR-357 Amendment 3 decision 5 records the same exception for the import luma worker, with its reason. #1587 records none, and its ledger row is in `P3-SWEEP.md`, not an ADR.
- **Scenario:** a user opens Preview on a project with several bed-sized photos. Before #1587, each raster compile ran in turn on the UI thread. Now every photo's compile starts in its own worker at once, beside the background job preparation worker. That preparation holds the lane and, by S3-P2-3, is the 3–9.5 GB peak.
- **Evidence:**
  - **READ** for the concurrency.
  - **REPRO** for the cost (`scratchpad\zz-v5\rp-mem.mjs`, the worker's own `rasterPreviewBitmap`, Node). One 4000 × 3000 photo grows RSS by about 43 MB at 400 mm (streamed) and about 62 MB at 200 mm (materialized), 0.5–1.0 s each.
  - So N photos add about N × 50–60 MB, plus one structured-clone copy of each photo's `lumaBase64` (16 MB at 12 MP) and its `editorDocument`.
  - This is small beside the preparation. That is why this is drift, not a memory finding.
- **Severity:** **P3**, doc/code drift. The measured cost is small and the old work ran in the same process anyway.
- **Novelty:** new. Open PR #1611 moves worker libraries but does not touch these clients.
- **Refuter:** PENDING.
- **Fix direction:** record the exception in an ADR-598 amendment, as ADR-357 Amendment 3 did, or run the Preview builds one at a time (a small queue in `raster-preview-worker-client.ts`).

## Refuted

None yet. Candidates I dropped myself:
- **Rotated photos fail to compile when streamed.** My first stream twin threw "dither-rows: luma row 0 has 0 values". The cause was my malformed `Transform` (an affine matrix instead of KerfDesk's `{x, y, scaleX, scaleY, rotationDeg, mirrorX, mirrorY}`). With a valid transform, all rotated, mirrored and masked cases compile and match.
- **The worker routes break cancel.** Esc aborts the decode (`awaitTraceSignal`) and the worker (`traceAbortError`, name `AbortError`). The import catches it as "import cancelled", and nothing is inserted, because `importRasterImage` runs only after success (`import-image-action.ts:58`).
- **Sharp's carried native input loses the dialog's report.** The report still comes from the carried input (`contour-trace.ts:181-185`).
- **Autosave preemption starves Start.** At most one restart per edit, as ADR-598 Amendment 3 item 2 states; that cost is accepted there.

## Verified clean

**#1555 (U3-P2-3, ADR-581 Amendment 1)**
- **Original repro fixed.** Script `zz-v5\pe-repro.mjs`, real `computePhotoEngravingPreview`, 4032 × 3024 photo.
  - 1.0.29 gives the old "~140 MB materialized working set…" error at 30, 100 and 360 mm and at 10 and 20 lines/mm, with no histogram.
  - Main previews all six. The display is 300 × 225 up to 1000 × 750, the histogram is present for Auto tones, and it takes 0.4–5.6 s in Node against the worker's 30 s limit.
- **Preview against burn.** Script `zz-v5\stream-twin.mjs`. The preview's `streamedPixelThreshold: 0` compile against the burn's default compile: **72 of 72 cases** have identical rows and group metadata.
  - The cases cover all 12 dithers.
  - For jarvis, grayscale, ordered and blue-noise they also cover negative, rotation 30° and 90°, mirror, owned clip, external mask, scan angle 45°, cross-hatch, 3 passes with angle step, 5 and 17.3 lines/mm, a power floor, bidirectional with overscan, pass-through and tone.
  - `zz-v5\preview-pixels.mjs`: the display bitmaps are equal across both compiles, and at 1:1 every display pixel is dark exactly where the burned row has power (0 mismatches over 8 cases).
- **Luma decoder.** The burn-path decoder (`raster-luma-decode.ts:40-104`) equals 1.0.29's on 200,000 fuzzed strings (`zz-v5\dec-fuzz.mjs`). The fuzz covers whitespace, padding misuse, non-ASCII and astral characters, NUL, truncation and every grid size.
- **ADR text matches the code:**
  - the 50 MP read ceiling;
  - the plain-words messages;
  - streaming only when materialized grids do not fit (`photo-engraving-preview-budget.ts:109`);
  - output keeping its 4 MP threshold (`compile-job-raster.ts:93`).

**#1557 (S3-P2-1, S3-P2-2)**
- **Arithmetic.** The worker's luma and base64 equal 1.0.29's (V5-P3-2 evidence).
- **Routing.** Masked sources and engines without Worker, OffscreenCanvas or createImageBitmap take the old loader (`image-luma-worker-client.ts:35`). A worker error resolves to null and falls back. A decode error rejects as before.
- **Failure paths:** a corrupt file, a zero-byte file, Esc mid-decode and Esc after decode (`assertImportActive` before insert). Each gives the existing truthful toast, with no half-inserted object.
- **Autosave.** It reserves `'interactive'` (`autosave-preparation-client.ts:71`). The lane preempts only owners with `onPreempt` (`worker-memory-lane.ts:76-90`), so an active autosave is never interrupted. The timeout toast now names the deadline, and the code matches ADR-288 Amendment 3 and ADR-598 Amendment 3.

**#1578 (S5-P2-1)**
- OK is unchanged: `commitAdjustment` calls `runAdjustment`, whose Curves runner is 1.0.29's `runOp` path.
- At scale 1 the window preview equals the committed composite for every case I ran (V5-P3-1 table, last row).
- Neighbourhood filters run on the full-resolution scratch copy before sampling.

**#1586 and #1594 (S5-P3-1, tracer speed round)** — traced paths byte-identical to 1.0.29.
- **Method:** the SHA-256 of `JSON.stringify(paths)` and of the frozen options. Both engines were bundled from source: `zz-v5\build-trace.mjs` and `ident.mjs`. Each trace takes the dialog's route, `mergeLightBurnTraceSettings`, then `resolveFrozenTraceSourceOptions`, then `traceImageToColoredPaths`.
- **Sets:**
  - `scenes`: fixture generators for light-solid, auto-detail, centerline, contour-topology, dense and trace-alpha, 60 images.
  - `variants`: real crops shaded grey, low-contrast, noisy, coloured and alpha, plus tiny auto-upscale sources.
  - `q4`, `q5`, `big` (the 4096 benchmark and a 12 MP photo at 2048) and `full`.
- **Coverage:** × all 8 presets × the overrides def, inv, thr, smooth0, ign, auto, paper, sketch, faint, transp, photo and col where they apply. The cooperative-runner route (`ident-coop.mjs`) was also run on q4 and scenes. Result: 7,345 of 7,345 identical on the native runner and 1,000 of 1,000 on the cooperative runner, with no errors (identity table below).
- Sharp's skip of the clean-art preparation (`trace-clean-art.ts:26`) and its carried native input (`trace-to-paths.ts:216`) change no path on any set.

**#1587 (S5-P3-3, S4-P3-1, S6-P3-3)**
- The trace readback composites exactly as 1.0.29 and keeps `rgbCompositedOnWhite`.
- The default edge is the same `PREVIEW_MAX_EDGE_PX`.
- The masked-source fallback is kept.
- The Preview raster worker runs the same `rasterPreviewBitmap` as its in-window fallback, given only the raster's mask object, which is all the compile reads (`compile-job-raster.ts:350-353`).
- The comparison thumbnail is display only (used only by `VectorComparisonPreview`).

## Trace identity table

SHA-256 of the JSON paths and of the frozen options, main `5f09e1110` against 1.0.29 `df2279e26`, in one process each. Output is in `scratchpad\zz-v5\out\ident-*.jsonl` and `coop-*.jsonl`.

| Set | Images | Presets × overrides | Traces | Identical | Different | Errors |
|---|---|---|---|---|---|---|
| scenes (fixture generators) | 60 | 8 × def | 480 | 480 | 0 | 0 |
| scenes | 60 | 8 × inv, thr, smooth0, ign, auto, paper, sketch, faint, transp, photo, col | 3,600 | 3,600 | 0 | 0 |
| variants (grey, noisy, colour, alpha, tiny crops) | 13 | 8 × all 12 | 884 | 884 | 0 | 0 |
| Q4 synthetic shapes and speckle | 65 | 8 × def, inv, thr, sketch, photo, col | 1,950 | 1,950 | 0 | 0 |
| Q5 cases | 47 | 8 × def, photo, col | 400 | 400 | 0 | 0 |
| big: 4096 benchmark and 12 MP photo, both at the 2048 preview edge | 2 | 8 × def | 16 | 16 | 0 | 0 |
| full-size perceptual assets | 5 | Sharp, Smooth, Line Art × def | 15 | 15 | 0 | 0 |
| **Native runner, total** | | | **7,345** | **7,345** | **0** | **0** |
| Cooperative runner (`steps.next(true)`, the inline fallback): Q4 and scenes | 125 | 8 × def | 1,000 | 1,000 | 0 | 0 |

Not run: images at 4096 px (bench4096, sparse4096, full-size 12 MP), for memory. The PR's own 12 traces at 4096 compare against `790b95c4a`, not 1.0.29.

## Not verified

- **Real-browser decode identity** for #1557 and #1587. I could not compare the worker route against the in-window route, or main against 1.0.29, on EXIF-rotated JPEGs, ICC-profiled or CMYK JPEGs, 16-bit PNG, alpha PNG, animated GIF and WebP first frames, TIFF pages or images near the 16,384 px canvas limit. I also could not compare on a non-accelerated canvas or in the packaged desktop app. Reason: free memory never reached the 3 GB browser gate (680–1,230 MB). Only the arithmetic was checked (V5-P3-2).
- **L12 for #1594:** the related e2e specs and the desktop build were not run, for the same reason. These are tracer-ui, trace-sharp-output, trace-presets-stress-worker, tracer-preview-upgrades, trace-part-editing, dense-trace-canvas-navigation and photo-shading, plus image-studio-adjust-preview and photo-engraving for this area.
- **Test truth, "fails before the fix":** not run, because the 1.5 GB Vitest gate was never met. By reading, these guards would fail before their fixes:
  - `trace-clean-art-preparation.test.ts:59,65` (1.0.29 prepares twice);
  - `trace-speed-round.test.ts` work counts;
  - `photo-engraving-preview-phone-photo.test.ts` (my Node repro shows 1.0.29 erroring);
  - `AdjustDialogHistogram.test.tsx` (six scans before, per the ADR).
  
  `photo-raster-gcode-identity.test.ts` and `adjust-apply-golden.test.ts` are invariance guards and pass before by design.
- **TIFF import route:** fflate is missing locally.
- **Timings:** not re-measured. All PR timing claims are unverified here.
- **Potrace:** not used; with paths byte-identical to 1.0.29 there is nothing new to compare.
- **Autosave and import interactions in a live app:** autosave during an import, and two imports at once, were checked by reading only.

```json
[
  {"id":"V5-P3-1","severity":"P3","area":"V5","file":"src/ui/image-editor/adjust-preview-window.ts","line":104,"anchor":"Twin + Contract (ADR-245 Amd 1 decision 6)","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Fit-view Threshold/Posterize preview is adjust(average) not average(adjust): grainy photo 13-17% of screen pixels off >32 levels, halftone 22-24% off >96 and 33-42 levels lighter; ADR says a screen pixel at edges"},
  {"id":"V5-P3-2","severity":"P3","area":"V5","file":"src/ui/import/image-luma-worker-client.ts","line":38,"anchor":"Contract (ADR-357 Amd 3 decision 2; perf audit byte-identical rule)","evidence":"READ","verdict":"PENDING","known":false,"summary":"Worker snapshot/readback luma and trace pixels are burn input; identity with the in-window decode rests on one manual Chrome measurement, unit tests use fake contexts, no e2e compares the routes"},
  {"id":"V5-P3-3","severity":"P3","area":"V5","file":"src/ui/workspace/raster-preview-worker-client.ts","line":31,"anchor":"Contract (ADR-598 decision 2)","evidence":"READ+REPRO","verdict":"PENDING","known":false,"summary":"#1587 starts one worker per Preview raster build (all photos at once) and per Trace decode outside the worker memory lane with no ADR; measured ~43-62 MB per 12 MP photo"}
]
```

## Refuter (2026-11-08)

- **Tree:** `j10-main` (main `5f09e1110`); 1.0.29 = `zz-v2/old29`. I rebuilt every bundle myself from those trees (`scratchpad\zz-v5r\build.mjs`) and did not reuse the auditor's.
- **Gates:** free memory was 1,100–2,030 MB all session, so the 3 GB browser gate was never met. Everything below is Node with real modules, or reading. I did not need Vitest.
- **Counts:** 3 auditor findings → 0 refuted → P1 0 / P2 0 / P3 3. No new findings.

### Verdicts

**V5-P3-1: CONFIRMED at P3.** I weighed it against P2 and kept P3.
- **Mechanism.** The code does what ADR-245 Amendment 1 decision 6 says it does. `adjust-preview-window.ts:104-106` runs the adjustment on `activeBase`, which is the area-averaged window from `:151-152` and `:168-189`. What is wrong is the amendment's stated consequence, "a Threshold edge can differ by a screen pixel" (`ADR-245-amendment-1-…md:47-49`).
  - The amendment justifies the trade-off only by the 100 ms / 200 ms / 1.5 GB budgets (`:79-91`). Texture is never considered.
  - S5-P2-1 (`S5-trace-image.md:49,53`) was a responsiveness finding. Its refuter did not discuss preview fidelity.
- **My repro.** Script `scratchpad\zz-v5r\studio-twin-r.mjs`, with two models of "OK drawn small": area-average, and bilinear point sampling, which is what `editor-canvas-draw.ts:109` asks the canvas for (`imageSmoothingEnabled` at default quality). Document 2000 × 2000.
  - **Clean photo, Threshold 128.** Off by more than 32 levels: 2.1–4.5 % of pixels at scale 0.25, 1.8–2.8 % at 0.4. Mean luma 129.3 / 129.4.
  - **Mild grain (σ 6).** 5.6–8.7 % off by more than 32. Mean equal: 129.3 / 129.4.
  - **Line art (arch outline).** 2.0–5.5 % off by more than 32, all at edges.
  - **Posterize 4.** At most 3.2 % off by more than 32. Means equal to 0.1 level.
  - So on ordinary photos the overall tone matches, and the difference is edge and grain texture. The auditor's large numbers come from heavy grain (σ 14) and a halftoned scan. I reproduced the mechanism, not their halftone figures.
- **Is there a cue?** No.
  - The dialog has no "approximate at this zoom" text.
  - The Preview checkbox says "Show the result on the canvas while adjusting" (`AdjustDialog.tsx:75-83`).
  - The e2e pins the cleaner look (`e2e/image-studio-adjust-preview.e2e.ts:48`, more than 90 % binary at fit).
- **Why not P2.**
  - **The burn matches what the canvas shows after OK.** OK commits the full-resolution result (`editor-adjust-session.ts:14-31`). The same canvas redraws it at once, as one Undo step. The workspace canvas and Preview then show the committed pixels before any Start.
  - **It is visible on the canvas, not a silent difference.** On a halftone the jump at OK is large: a clean poster turns back into the dot pattern.
  - **It is an editing preview, not a burn preview.** The user does not burn something different from what they last saw. They burn something different from what they saw while dragging, and the canvas has already shown them the difference.
  - It is also no wrong physical output under §3, because the committed pixels are exactly the ones shown before Start.
- **Severity reading.** Doc/code drift: the ADR understates the consequence. Add polish: the preview is cleaner than the result on textured sources. The fix direction stands. If it is fixed, line 48 of the e2e must change with it.

**V5-P3-2: CONFIRMED at P3. The browser comparison was not run (memory gate).**
- **Reading.**
  - The worker route snapshots the loader's accelerated canvas (`image-luma-worker-client.ts:38,49-57`; `image-loader.ts:260-275`, `getContext('2d')` without `willReadFrequently`). It redraws the snapshot on a `willReadFrequently` `OffscreenCanvas` and reads it back (`image-luma-worker.ts`; `image-luma-decode.ts:37-43`).
  - The fallback reads the accelerated canvas directly (`image-loader.ts:278-288`).
  - For opaque pixels the copy is premultiplied to premultiplied at 1:1. For partial alpha, the un-premultiply moves from the GPU readback to the CPU readback. That is the only place I see where rounding could differ.
  - ADR-357 Amendment 3 (`:72-77`) measured a PNG with every alpha value as identical in Chrome 156. It did not measure a 16-bit PNG, WebP, GIF, an ICC-tagged or CMYK JPEG, or a non-accelerated canvas (`:85-86`).
  - Unit tests use fake contexts (`image-luma-decode.test.ts`), so nothing would catch a Chromium change.
- **Nothing I found refutes the missing-guard claim, and no difference is shown,** so it stays P3. The same holds for the trace readback (`off-thread-trace-decode.ts:35-49`; `composited-pixels.ts:39-54`).

**V5-P3-3: CONFIRMED at P3, re-anchored and with sharper evidence.**
- **The anchor is weaker than stated.** ADR-598 decision 2 (`:12`) governs the lane's owners, not every worker. Only 5 clients reserve it: preparation, autosave, project Save, trace-part and idle markers. About 35 `new Worker` sites do not. They include `photo-engraving-preview-worker-client.ts:59` (ADR-581), the trace worker and the import workers.
- **What does hold.**
  - **Fan-out.** One worker per raster per output operation starts in the same task (`draw-raster-preview.ts:186-202,307-308`; `raster-preview-worker-client.ts:31,54`). `pruneRasterPreviewBuilds` (`draw-raster-preview.ts:101-113`) does cancel superseded keys, so a drag does not pile up workers.
  - **Unread payload.** Each build structured-clones the whole `RasterImage` minus `dataUrl` (`raster-preview-worker-client.ts:24`). That includes `editorDocument`, which every Image Studio Apply stores as full-document RGBA base64 per layer (`editor-project-document.ts:15-49`, up to 128 MiB raw). `src/core` never reads it for compiling.
  - **Measured** (`scratchpad\zz-v5r\clone-cost.mjs`, Node `worker_threads`, the same V8 serializer):
    - posting a 12 MP photo with one Studio layer: 80 MB of text, 26 ms on the posting thread, and RSS up about 92 MB;
    - with two layers: 144 MB of text and 62 ms.
  - So a Studio-edited photo costs about 64–128 MB more per Preview build than the auditor's 43–62 MB compile estimate, times N photos at once.
  - It is still under the 200 ms block budget, and `photo-engraving-preview-worker-client.ts:67-70` already has the same pattern. So P3, not P2.
- **Fix direction, added:** strip `editorDocument` (and `imageAsset` once hydrated) in `raster-preview-worker-client.ts:24`, as well as queueing or recording the exception.

### Challenges to "Verified clean"

- **Trace identity at 4096 px: holds.**
  - Script `scratchpad\zz-v5r\ident4096.mjs` with my own bundles of both trees. Output in `ident4096.jsonl` and `chain4096.log`.
  - 14 of 14 traces byte-identical, paths and frozen options:
    - the 4096 benchmark × Sharp, Line Art, Smooth, Centerline, Line + fill and Edge Detection;
    - a sparse 4096 page × Sharp, Line Art, Centerline, and Sharp with sketch;
    - a 4000 × 3000 photo × Photo shading, Colour layers with 4 colours (4 paths), Line Art with sketch, and Edge Detection.
  - There is no separate "Sketch" preset. Sketch is the `detectionMode: 'sketch'` override, and the 8 presets include Centerline and Colour layers.
- **#1555 on non-phone sizes: holds and fixes more than the phone photo.**
  - Script `scratchpad\zz-v5r\pe-sizes.mjs`, real `computePhotoEngravingPreview` from both trees.
  - **Previewed on main but refused on 1.0.29 with the 64 MB message:**
    - 9000 × 1200 panoramas at 600 mm / 10 lines/mm and at 400 mm / 20;
    - A4 scans at 300 and 600 dpi;
    - a 400 × 8000 strip;
    - pass-through at 400 mm;
    - cross-hatch with 3 passes at 45°;
    - grayscale dither at 300 mm;
    - a 49.9 MP source.
  - **Times on main:** 0.2–1.8 s, within the worker's 30 s.
  - **Equal on both trees:** a small icon enlarged to 8000 × 5333, and a 24 px image. Their display hashes are identical on main and 1.0.29.
  - **Above the read ceiling:** a 51 MP source gets the plain-words "51 megapixels; the preview reads up to 50" message (`photo-engraving-preview-budget.ts:61-73`).
- **#1557 autosave preemption cannot leave Start with a stale job (READ).**
  - Preemption re-queues the exact active request, the same immutable `project` and options, and retires the worker (`preparation-worker-client.ts:232-241`, wired at `:396`).
  - `retireWorker` clears a half-received transfer (`:467-468`), so a restart cannot splice two transfers.
  - A request for an edited project rejects everything queued and active for the old one (`:243-259`), and cache entries are keyed by project identity. A restarted preparation can only produce the result of the project it was asked for.
  - The autosave reservation is `'interactive'` (`autosave-preparation-client.ts:71`).
- **#1587 Trace decode, cancel and failure paths: hold (READ).**
  - **Abort before the worker:** checked after the decode (`off-thread-trace-decode.ts:44-47`).
  - **Abort during the worker:** `finish` detaches the handlers, terminates the worker and rejects with `AbortError` (`:65-79`).
  - **A worker that fails to start, errors, or fails to clone:** resolves null, and the window loader decodes again (`:56-62,83-90`).
  - **A real decode error:** rejects from `decodeImageOntoCanvas` as before.
  - **The preview owner** marks the attempt failed and retries only on a later request (`trace-preview-preparation.ts:46-50,64-67`). Both commit routes check the signal after the decode (`trace-commit-result.ts:55-60`; `trace-commit-at-grid.ts:109-114`).
  - **Masked sources** never take the worker route (`:40`; `trace-source-mask.ts:21-23`).
- **Image Studio histogram memo (#1578): holds.** Painting and undo really are parked while a dialog is open: the pointer at `use-editor-pointer.ts:56,172`, and keys at `editor-shortcuts.ts:43-47`.

### Not verified (refuter)

- **V5-P3-2's Chrome comparison** of the worker route against the in-window route and against 1.0.29, on EXIF 6/3 JPEG, alpha PNG and 16-bit PNG. The browser gate was never met: free memory peaked at 2,033 MB.
- **The halftone figures** of V5-P3-1, which I did not re-run, and an in-browser measure of what Chrome's downscale shows after OK.

Refuter counts: raised 3, refuted 0, P1 0, P2 0, P3 3, known 0
