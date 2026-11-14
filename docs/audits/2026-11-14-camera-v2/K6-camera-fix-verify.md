# K6 — Camera fix verification (camera audit v2, `camera-fix-verify`)

**Question.** Camera audit v2 (K1–K5, 31 findings) ended with "Verify camera fixes". Every fix and three maintainer decisions are on `main`. For each one:
- does the earlier auditors' and refuters' **own** repro now pass;
- how much of the original gap is left (the windows the PRs name as known gaps);
- did the fix move a defect somewhere else (regression probes)?

The PRs: #1917 and #1918 (K1), #1922 (K2 and K1-P2-2), #1925 (K3), #1930 (K4), #1932 (K5 security), and the decisions #1935 (Material height follows the material and is saved), #1936 (an unsaved timelapse is kept) and #1937 (a network camera's calibration is portable). #1649 (no login, path or query token in a saved file) is re-checked after #1937.

**Tree.** `origin/main` @ `5e465bfe6`, read-only export `j43-main`. The "before" numbers are the K1–K5 auditors' and refuters' own outputs on `ba08a81af` (`j42-main`), as recorded in their `zz-k1` … `zz-k5r` folders. `git diff --stat ba08a81af 5e465bfe6` touches the camera only through the PRs listed above (the other 120 changed files are tools-audit work: stamp, kerf, offset, trace worker, rubber-band outline).

**Method.**
- **Their scripts, re-pointed.** Every repro script of K1, K1r, K2, K2r, K3, K3r, K4, K4r, K5 and K5r was copied into `zz-k6\<area>\` with its imports changed from `j42-main` to `j43-main` and nothing else, except:
  - K3 and K3r's placement step now follows the UI of #1925 exactly: a piece with a doubt (`piece.doubt`) or `partial` starts left out (`piece-scan-store.ts` `startsLeftOut`), and `piecesTheDesignFits` drops the pieces a copy runs off before `piecePlacements` (`PiecesControl.tsx`). Without this the old scripts would have ticked pieces the app now leaves out.
  - Stub ports were moved to 127.0.0.1:5351–5359.
- **New probes (own).**
  - `k1\k6-floor.mts` + `est-var.ts`: a copy of the app's `extrapolation-estimate.ts` with only `FLOOR_PER_PIXEL` and `SPREAD_TO_ERROR` made variable, on 24 truth cameras of the K1 renderer, to answer "is a tighter estimate possible without unwarned points".
  - `k2r\k6-live.mts`: the real `installCameraHelpers` (with the real 15 s live check) on the K2 refuter's truth camera; knock, job, weak-view and hidden-overlay timings.
  - `k2r\k6-nudge.mts`: the real `compareViews` → the moved store's verdict → the real `nudgeMoveCheck`, for small tips, rolls, yaws and lid drops, with the true bed error left after a one-offset fix.
  - `k2r\k6-nudge-race.mts`: Fix a small offset pressed before the live check has measured a knock.
  - `k2r\k6-height.mts`: the real `followMaterialHeight` and `cameraHeightWarnings` over session and project sequences.
  - `k3r\k6-necks.mts`: single blanks with a neck of their own, and a bed 70 % covered.
  - `k5r\k6-portable.mts`: the portable identity (#1937): a calibration from "computer A" opened on "computer B" (its security parts are in the private file).
  - `k4r\k6-jpegtail.mts`: the cut-picture check on whole JPEGs with bytes after the end marker.
- **Security.** The relay repros (K5 `p2-relay.mts`, K5r `r1-relay.mts`) were re-run against their stubs on 127.0.0.1 only. Details are in `zz-k6\SECURITY-DETAILS.md`, not here.
- **Runs.** One Node process at a time (`--max-old-space-size=380`), 1.2–1.9 GB free. No Vitest, browser, pnpm, FFmpeg, camera, network or hardware; my stubs were stopped after each run.

## Headline

**The fixes hold on the earlier auditors' own repros: every K1–K5 P1 is fixed or reduced to its announced window, and the K5 security finding is fixed. But two of the fixes introduced new P1 regressions, and #1937 added a P2 security weakness.**

- **Fixed, re-measured with the original scripts:**
  - the bed estimate warns everywhere the truth is over 1.5 mm (46 of 47 calibrations; least estimate/truth 0.81);
  - Fix refuses every measured turn that a one-offset fix would leave ≥ 1.14 mm off;
  - the head camera's band is graded fair at 3.6 mm (truth 3.84);
  - the live picture is re-checked: a 0.8° knock reaches Job Review in 4.9–8.8 s;
  - the height rule warns for rotaries, named materials and target-height-only calibrations;
  - Find pieces separates 2 mm gaps, packed coasters (12/12) and tiles (15/15), drops glare, survives shadows and 2,700 mm² of scorch, and keeps copies on the material;
  - the Print-and-Cut target and taped marks are refused;
  - timelapses ride out stalls (60 s stall: 17 frames, was 6) and RTSP viewers closing;
  - a cut JPEG is refused; an unsaved timelapse survives Continue.
- **Partly:**
  - an RTSP camera that no viewer ever claims still turns itself off at 15 s and ends the recording (K4-P2-2);
  - a straight-down camera with its height typed still reads "fair 3.6 mm" at 0.80 mm true (K1-P2-1);
  - the mirrored picture is still measured as a 24 mm move (K2r-P3-1, not fixed);
  - K2-P1-1 keeps its announced 0–15 s window and has no Start check.
- **New:**
  - **K6-P1-1:** #1935 restores a Material height kept from the last session or project when the project names no material. 85 mm left from a rotary job puts the next flat job 71.5 mm off, with no warning.
  - **K6-P1-2:** #1925's neck cut splits one bone tag, ornament or hourglass offcut into two pieces, and every blank gets two copies.
  - **K6-P2-1:** a calibration from another computer is used for any camera at the same address, with a panel-only notice and nothing in Job Review.
  - **K6-P2-2:** Fix inside the window after an unmeasured knock still bakes the tilt in.
  - **K6-P2-3:** SECURITY (redacted).
  - Four P3s.
- **The #1917 trade-off, measured:**
  - no part-sheet calibration is graded good (0 of 45);
  - accurate cameras are over-read 2.6–37×, median 7×;
  - the model-independent floor alone sets about 2.9–3.7 mm on the default sheet, so no change of the two constants gives a mild lens "good" without leaving the strong lens or the 300 × 300 sheet unwarned. A tighter estimate needs new information, not new constants.

## Tables

### #1917 + #1918 — calibration estimate, nudge, head camera (K1, K1r scripts; `k1\*.out.jsonl`, `k1r\*.out.jsonl`)

"Unwarned" = grid points (5 mm) whose true error is over 1.5 mm where `estimateWithin` says 1.5 mm or less, at the sheet height.

| Finding | Before (`ba08a81af`) | After (`5e465bfe6`) | Verdict |
|---|---|---|---|
| K1-P1-1 estimate under-reads (auditor matrix A/B/C + degradations, 35 calibrated cases) | 7 graded **good** at true 2.75–4.50 mm; 17 cases with unwarned points (e.g. A3 219/219, A1 87/87) | 0 graded good on a part sheet; **0 unwarned points in 34 of 35** (A3 0/219, est 3.82 vs true 4.50). The exception is X5, a deliberately mis-engraved sheet (one column 1.2 mm off): 147 of 2,082 points unwarned at up to 2.35 mm, where before none were; it is graded "Good for rough placement" with a 22 mm estimate, so not raised | **fixed** |
| K1-P1-1 (refuter, own Brown/fisheye truth, 12 calibrated cases) | R3/R11/R12 good at 2.68–2.84 mm; unwarned up to 64/64 | all fair, **0 unwarned** in all 12 (R3 est 3.73 vs 2.84) | **fixed** |
| K1-P1-1 least estimate/truth where truth > 1.5 mm (24 truth cameras, `k6-floor`) | 0.28 | **0.81** (C1 600 × 400 bed), A3 0.85 | **fixed** (as claimed) |
| K1-P1-1 wrong corner named | "near the bottom-left" while top-right worst | estimate peaks at (0,0) "top-left" while truth peaks at (400,0) in A1/A3/A8/C5; the map no longer leaves the true worst corner unwarned (it is ≥ 1.06× there) | fixed in effect; the named corner still differs (P3, not raised: covered by the map) |
| K1-P2-1 full-bed sheet false "fair" | C3 fair 1.8 (true 0.36), C4 fair 5.3 (0.50); FB3 fair 1.59 (0.30) | C3 good 0.72, C4 good 0.75; FB1–FB4 all good (est 0.72–1.45, true 0.24–1.35) | **fixed** |
| K1-P2-1 straight-down camera with the tape height typed (refuter SD2) | fair "about 6 mm" (5.95), true 0.80 | fair "about 3.6 mm" (3.61), true 0.80 | **partly** (4.5× over; now part of the trade-off below) |
| K1-P3-1→P2 head camera band (refuter r7) | good, "0.00/0.01 mm"; band truth max 3.84 mm | **fair**, "up to about 3.6 mm off where the stitch uses it"; band truth p95 1.84 / max 3.84 | **fixed** |
| K1-P3-1 head camera (auditor k4, 8° tilt) | good, tiles max 0.83 | good + advice "up to about 1.5 mm off where the stitch uses it"; tiles max 0.83 | **fixed** (honest) |
| K1r-P3-1 refusal message for the full-bed sheet | no mention of ring size | refusal unchanged (`anchors-unclear`, r6), message now says "engrave larger rings (Engrave settings, Ring size)" | **fixed** |
| K1-P1-2 Fix a small offset on a turn (real `compareViews` → moved store → `nudgeMoveCheck`, `k6-nudge`) | Fix offered at pitch 0.5–1° (bed 4.1–6.8 mm after), "Nothing to fix" at roll 0.5–1° (bed 3.5–5.7 mm) | refused ("turned or tipped… Calibrate again") for every move whose bed error left after a one-offset fix is ≥ 1.14 mm: pitch ≥ 0.3°, roll ≥ 0.3°, yaw ≥ 0.3°, lid ≥ 2 mm lower. Fix still offered for pitch 0.1–0.2°, yaw 0.2°, lid 1 mm, slides: bed after the fix ≤ 0.87 mm. "Nothing to fix" only at roll 0.2° (bed 0.92 mm) | **fixed** when the moved check has measured the move; see K6 nudge race below |
| K1-P1-2 Fix clears the turned-camera warning | yes | `applyNudge` returns false on a measured turn; a "changed" view keeps its warning | **fixed** (same condition) |
| Saved round trip, outlier drop, Check camera (r8, k5, k3) | exact; drops; 8/8 moves flagged | unchanged | holds |

**The trade-off (#1917): how often an accurate camera is now graded fair.**
- Cameras whose true worst error over the whole visible bed is ≤ 1.5 mm, calibrated on the default 300 × 200 part sheet with the height known (8 cases: A2, A7, B5, M2, M3 from K1's renderer; R4, R6c, SD2 from the refuter's): **8 of 8 are graded fair**, at 3.4–13.5 mm against a truth of 0.36–1.36 mm (median 7× over; B5 division 0.36 → 3.58 mm, 10×; R6c 0.51 → 5.47, 11×; A7 1.36 → 13.5).
- Before #1917, 7 of these 8 were already fair, at 1.4–6.0 mm; B5 lost its "good".
- Of the 41 part-sheet calibrations in the auditor's and refuter's matrices (and the 4 extra mild lenses of the floor study), **none is graded good**; only the six full-bed sheets are. On the default sheet, "good" is now unreachable; the grade only tells a part sheet from a full-bed sheet. The engraved-target read-back (K3 `k3-target`, truth 0.45 mm worst) also reads "fair, about 3.8 mm".
- **Can it be tighter without unwarned points?** (`k6-floor`, 24 truth cameras, the app's estimate with only its two constants changed):

  | FLOOR_PER_PIXEL / SPREAD_TO_ERROR | cases with unwarned points | least est/truth (truth > 1.5) | accurate cameras graded good |
  |---|---|---|---|
  | 0.025 / 1.5 (shipped) | 0 | 0.81 | 0 of 6 |
  | 0.02 / 1.5 | 0 | 0.65 | 0 of 6 |
  | 0.015 / 1.5 | 2 (A3 16/219, C2 27/73) | 0.51 | 0 of 6 |
  | 0.01 / 1.5 | 7 | 0.34 | 2 of 6 |
  | 0 / 1.5 (spread only) | 7 (A3 219/219, C2 73/73, D5 62/62, D1 78/98 …) | 0.23 | 3 of 6 |
  | 0.025 / 1.0 | 1 (B6 2/531) | 0.74 | 0 of 6 |
  | 0.02 / 1.0 | 2 (A5 45/269, B6 2/531) | 0.65 | 0 of 6 |
  | 0.025 / 0.75 | 1 (B6 93/531) | 0.60 | 0 of 6 |

  "Accurate cameras" here are the six of the 24 whose truth is ≤ 1.5 mm (A2, A7, B3, B5, M2, M3).

  - The floor alone gives 2.9 mm (0.02) or 3.65 mm (0.025) at the far corners of the default sheet's geometry **whatever the lens**, so no setting of these two constants makes a mild lens "good" while keeping the strong lens A3 and the 300 × 300 sheet C2 warned. The shipped pair is at the edge of what the 24 cameras allow (0.02 still leaves no unwarned point but only 0.65× margin).
  - A tighter estimate needs information the floor does not use (for example the fitted radial profile's curvature at the outermost rings, or a second photo), not new constants. Kept as the known trade-off; not raised.

### #1922 — live re-check, height rule, sign, mirror (K2, K2r scripts; `k2r\*.out.jsonl`)

| Finding | Before | After | Verdict |
|---|---|---|---|
| K2-P1-1 live picture checked once (refuter r2, real `installCameraHelpers`) | 0.8° knock: "steady" through 24 s of live use and a job; zoom 1.30 silent until a camera restart | same script: the A2 step still shows "steady" because its overlay is hidden half of the time (the check skips a hidden picture) — see `k6-live`; zoom 1.30: "changed" with the Job Review line **10 s later on the live picture** (weak at the start check + weak at the next live tick) | **fixed** with a window |
| K2-P1-1 window (`k6-live`, real 15 s timer, 0.8° tip = 9.7 mm) | never noticed | knock while the live picture shows: Job Review line after **7.8 s and 4.9 s** (two phases; at most 15 s + the check). Knock during a streaming job: nothing for the job (by design), line **8.8 s after the job ends**. Zoom 1.30 at start: weak at 5.5 s, "changed" line at **15 s**. Overlay hidden while knocked: nothing for 20 s, line **14.3 s after it is shown again**. Mirror at start: "moved 24.3 mm" at 5.5 s | **known gap measured:** a Start within 0–15 s of a knock (or of re-showing the picture, or of a job's end) still burns on the old picture with no warning; there is no check at Start |
| K2-P1-2 rotary picture height (refuter r3 + `k6-height`) | Job Review silent at 0–3 mm on an 85 mm-high tumbler (burn 32 mm off) | "Camera placement is on, and so is the rotary … drawn at a Material height of 10 mm …" in Job Review and under Material height; silent at 85; silent at 80 (= the diameter) with the picture 5.4 mm off (K6-P3-2) | **fixed** |
| K2-P2-1 material thickness ignored (`k6-height`) | 3/6/18 mm stock drawn at 0: 2.6/5.3/16.3 mm off, silent | with the material named the height follows it (0 mm off), a hand-set 10 on 3 mm stock warns (6.1 mm off). With no material named: still 0 → 2.6/5.3 mm off, silent (nothing to compare) | **fixed** where the project knows the thickness; see K6-P1-1 |
| K1-P2-2 target-height-only calibration at another height | silent at 20/40 mm (7.7/16.9 mm off) | "the camera calibration lines up only at the height of its target sheet (3 mm)…" at 20 mm (Job Review and the note); not said for a relative Start from (by design) | **fixed** |
| K2-P3-1 sign of the moved displacements (r1) | reported = −true in 13/13 | numbers unchanged (−true); the doc comments now describe them as they are | **fixed** (documentation) |
| K2r-P3-1 mirrored picture read as a small move (r1, `compareViews`) | measured "moved 24.3 mm" (true 437 mm) | **unchanged: measured "moved 24.27 mm"** on the refuter's camera. The new `mirrors()` test sits after the fit, and the fit chosen here does not mirror (a similarity cannot), so it never fires | **not fixed** (still warns; figure 18× too small) |

### #1925 — Find pieces, fit check, Print-and-Cut target, whole marks (K3, K3r scripts; `k3\*.out.jsonl`, `k3r\*.out.jsonl`)

| Finding | Before | After | Verdict |
|---|---|---|---|
| K3-P1-1 close blanks merge (refuter gaps1–3, rot45, coasters) | square-on 3.5 mm merged, 45° 4 mm merged; 12 packed coasters "Found 1 piece", 15 tiles 1 mm apart 1 piece; copies on seams | square-on: 2 mm and wider separate; 0, 0.5, 1 mm pairs merge but each is flagged "Much larger than the other pieces: it may be two pieces touching" and starts left out (0 copies on seams). 45°: all separate from 2 mm. Coasters 12/12, tiles 15/15. Auditor "touching": 8 blanks → 6 found, 2 merged pairs flagged and left out, 0 burn off | **fixed** |
| K3-P1-1 sample mode on a merged pair (refuter gaps1, sample on the left blank of the 0 mm pair) | copies on seams 6.87 mm off | the sample is the flagged merged piece; every other copy runs off and is left out: "Nothing was placed: the design runs off every ticked piece. Make it smaller or put it on one of the pieces" (0 burned). Safe, reason misleading (K6-P3-3) | fixed (safe) |
| K3-P1-2 placed off the material (auditor offcut; refuter offcut) | L, ring, frame: 100 % off (30–43 mm); crescent 50 % | L: on the wood (margin 4.25 mm); ring and frame: left out "The design runs … off this piece, so it is left out of Place"; crescent 0.32 mm past its edge (under the 1 mm limit); 20 × 14 design on the ring: one corner 1.22 mm past the hole (offPct 0.8) | **fixed** |
| K3-P1-3 glare as pieces (auditor glare, glare-mild; refuter sweep, BIG) | 3 extra ticked pieces, copies 82–172 mm on the bed | extras flagged "Not the colour of the other pieces: it may be glare…" and left out: 0 copies on the bed in all 7 runs | **fixed** |
| K3-P1-4 calibration target through a Print-and-Cut registration (refuter rt, real store) | marks kept, registration applied, rings 8.6–13.2 mm off, burn stamped as seen | Add target to canvas clears the marks (`printAndCutTargetsKept: false`), Start registration "none", stamped and seen correctly | **fixed** |
| K3-P1-4 (auditor k3-target: registration made by hand on the generated scene) | rings 11–18 mm off, `burnSeen: true`, calibrated 14.4/21.9 mm off under "fair 1.6 mm" | rings still burn 11–18 mm off (the auditor builds the registration directly), but `burnSeen` stays unset and the photo is refused: "This target's rings were burned through the project's Print and Cut registration…" | **fixed** (refused) |
| K3-P2-1→P1 shadows (auditor shadow, shadow-noref; refuter grey, MDF) | dC 4.3–6.3 mm; no reference: the shadows were the pieces (10.5 mm) | dC 0.26–0.60 (auditor), 0.00–0.09 (refuter, all three beds); no reference: 3/3 right | **fixed** |
| K3r-P1-1 scorched MDF (refuter mdf, mdf2, mdf3 to 2,700 mm², bright blanks) | blanks lost from 1,350–1,800 mm² of scorch; marks became pieces, copies 158 mm off | 4/4 blanks found at every scorch area up to 2,700 mm², test grids, kerf outlines; 0 copies off the wood | **fixed** |
| K3-P2-2 design larger than the piece (auditor small, design 70×40; refuter small) | 9.2–27.8 mm onto the bed | the pieces it runs off are left out with the note; the rest placed (worst 0.35 mm past an edge) | **fixed** |
| K3-P2-3 taped Print-and-Cut mark (auditor sweep 20–31 %; refuter rm 10–40 %) | accepted at 0.81–1.28 mm off, "found both marks" | refused from 10 % covered on the side and corner, from 15 % on the top (10 % top: found, 0.27 mm); 20 % covered corner case of the auditor: found at 0.02 mm. Message "found 1 mark-like shape, but no two are 335.9 mm apart" | **fixed** |
| K3-P3-1 piece near the edge called partial (refuter edges, auditor edges) | 0.5/1/2 mm from the edge: partial | 0.5/1 mm partial, 2 mm and more whole | **fixed** |
| K3-P3-2 L offcut called round | "⌀ 120.5 mm" | "120.2 × 120.2 mm", square | **fixed** |
| Clean cases (baseline, darkwood, lowcontrast, 48 tags, accuracy, fixture, trace, engrave target, PnC rings/crosses/dots) | 0.01–0.4 mm | 0.01–0.6 mm, 48/48 tags, fixture unchanged, trace 0.39 mm, engrave 0.00 mm | holds |
| Pieces below 100 mm² (refuter "tiny") | 4 found (sizes inflated by the old blur) | 2 found: the 9 mm square (81 mm²) and ⌀11 disc (95 mm²) are now under the documented 10 mm-square minimum | as designed |

### Regression probes on #1925 (own)

| Probe | Before (`j42`, same renderer) | After | Verdict |
|---|---|---|---|
| 4 bone-shaped tags (two ⌀30 lobes, 14 mm neck), 20 × 14 design (`k6-necks`) | 4 pieces, 1 copy per tag | **8 pieces, no doubt, all ticked: 2 copies on every tag** | **K6-P1-2** |
| 3 snowman ornaments (⌀40 on ⌀56) | 3 pieces, 1 copy each | **6 pieces, 2 copies on every ornament** | **K6-P1-2** |
| 2 hourglass offcuts (two ⌀60 overlapping) | 2, 1 copy each | **4, 2 copies each** | **K6-P1-2** |
| Same bone tags, 50 × 12 design along the tag | 4 copies on the wood | every half "runs off": "Nothing was placed…" | safe; same root |
| Key fobs with a 12 × 10 tab | 4, 1 copy each | 4, 1 copy each | clean |
| 16 blanks 86 × 62 covering 71 % of the bed, 8 mm gaps | 16/16 | 16/16, sizes ±0.2 mm | clean |
| Auditor "knot" (square blanks with a dark knot, sample mode) | 4 copies, margin 8.8 mm | piece 4 left out: the knot is read as a hole, `offPieceMm` 4.89 → "The design runs 4.9 mm off this piece, so it is left out of Place" | **K6-P3-1** |

### #1930 — timelapse hiccups, RTSP idle, shared failure, cut JPEG (K4, K4r scripts; `k4\*`, `k4r\*`)

| Finding | Before | After | Verdict |
|---|---|---|---|
| K4-P2-1 recorder ends after 5 failures (auditor E1, real `serveHttpFrame` + back-off, 18 scenarios) | 7 scenarios ended at 5–6 frames: stall 60 s 6/46, hang 30 s 6/38, refuse 2 requests 6/16, refuse 20 s 6/26, malformed 10 s, huge 10 s, HTML 3 s 6/16 | none ends: stall 60 s **17**/46 (frames resume after the stall), hang 30 s **19**/38, refuse 2 requests **14**/16, refuse 20 s **10**/26, HTML 3 s **15**/16; note cleared when pictures return; final frame kept in 18/18; frames in order | **fixed** |
| K4-P2-1 with the overlay polling the same camera (refuter r1, real bridge server) | 9 of 18 runs ended at 5 frames (refuse 1.2 s + overlay, stall 16 s + overlay: 5/21 …) | 0 of 18 end: 10–13 of 13, stall 16 s 13/21, stall 25 s 10–11/23 | **fixed** |
| K4-P2-1 toast after 3 misses | none | `missedFrame` pushes one "Timelapse: The camera has not sent a picture for a while…" toast at the 3rd miss (READ; neither E1 nor r1 records toasts) | fixed by READ |
| K4r-P3-1 one shared failure counted per request | 2 s hold after one shared timeout | `noteFrame` ignores a failure while the camera is already held back (READ); r1 overlay runs no longer collapse | **fixed** |
| K4-P2-2 RTSP session ends when its last viewer closes (refuter r2, real bridge + fake ffmpeg; auditor E3) | session failed 6.2–16.4 s, camera off, 3–8 of 11–16 frames | panel closes, overlay replaced, panel-only, one viewer's ffmpeg exits or stalls: session stays **live**, 10–15 frames, no camera error (5/5 r2, 3/4 E3) | **partly fixed** |
| K4-P2-2 "never claimed" (E3: RTSP source started, nothing shows the preview: overlay off, panel closed) | camera error at 15.1 s, 8/13 | **unchanged: "RTSP preview request did not start in time", camera error at 15.06 s, recording stops at 8/13** | **not fixed** (that part) |
| K4-P2-3 next run empties the last recording (decision #1936; auditor E2, refuter r3) | Continue 14 ms after a finished 7-frame timelapse: 0 frames | Continue: **7 frames kept**, Save video still offered, note "This timelapse is not saved yet, so it was kept and the next job was not recorded…"; jobs B and C not recorded; the same in E2 (10 and 11 frames kept, second job 2 s after finish keeps 8) | **decision implemented** |
| K4-P3-1 flat recording after a size change (E7) | 0 of 10 frames, 2.5–3.6 requests/s, no note | 0 of 10 frames (correct: it cannot be flattened), **0.5 requests/s**, note "The camera's picture changed size…" | **fixed** |
| K4-P3-2 cut JPEG passes (refuter r4 part A; auditor E1 truncated-10s) | close-delimited and self-consistent cuts: 200, kept as frames (16/16) | 502 "The camera sent a picture cut short." (r4); E1 truncated-10s keeps 8/16 (the cut ones refused) | **fixed**; see K6-P3-3 |
| Long job, pause, abort, order (E2, E8) | 310 frames / 12 h, 74 MB; pause takes no pictures; abort keeps the recording | identical (310 frames, 73.9 MB retained, 0 requests while paused) | holds |

### #1932 — K5-P2-1 (SECURITY, redacted)

| Finding | Before | After | Verdict |
|---|---|---|---|
| K5-P2-1 SECURITY (CWE-441, P2) | reproduced by auditor and refuter | auditor's repro and an own probe of 14 attempts: no use of the camera's login by another program; the rightful client works | **fixed** (details private) |

### Decisions

| Decision | Verified | Result |
|---|---|---|
| #1935 (ADR-441 Amd 14) Material height follows the job material and is saved (`k6-height`, real `followMaterialHeight`) | material 18 named at start → 18 (0 mm off); material named later → follows; hand-set kept and saved; rotary on → not followed, rotary off → follows the material again; value restored next session | **implemented**, but a kept height reaches projects with no material named: **K6-P1-1** |
| #1936 (ADR-490 Amd 4) unsaved timelapse kept; Job Review asks before Start | E2, r3: kept on Continue, Second pass, next job; note + toast (`KEPT_TIMELAPSE_NOTE`); `TIMELAPSE_UNSAVED_WARNING` is added to Start's warnings whenever a timelapse is wanted and the last one is unsaved (`start-machine-snapshot.ts:73`, `camera-off-target-warning.ts:66`, READ). `markTimelapseSaved` after Save video; Clear empties it | **implemented**. Every later job stays unrecorded until the operator saves or clears (as decided). Whether the recovery Continue passes through Job Review was READ only |
| #1937 (ADR-692 Amd 3) calibration portable across computers (`k5r\k6-portable`) | computer B (new key, same address): keyed fingerprint differs, portable equal → the calibration is used (`ownModelUsed: true`, `modelFromElsewhere: true`), no view reference, the "calibrated on another computer: run Check camera once" notice; old calibrations without the portable field stay tied (K5 p4 `identity-second-computer`: `source-mismatch`). A password change in a query/path login field now keeps the calibration for recognised field names (K5r-P3-4) | **implemented**; **K6-P2-1** (where the notice lives and what it claims) and K6-P2-3 (SECURITY, redacted) |
| #1649 after #1937 (K5 `p3-routes`, 16 routes; K5r `r2-privacy` parts 1–3, 35 shapes and legacy files) | project save, autosave/recovery, recent, template, `.lfmachine`, canonical profile, execution artefact, plain storage, last machine, reopened-then-saved | **no literal login, user, path or query token in any saved file** (0 of 35 shapes, 0 leak fields in 16 routes); see K6-P2-3 (SECURITY, redacted). See K6-P2-3 (SECURITY, redacted) |

## Findings

### K6-P1-1 — A Material height kept from an earlier session or project is used for a project that names no material: 85 mm left from a rotary job puts the next flat job's picture 71.5 mm off, and nothing warns

- **Where:** `src/ui/camera/helpers/material-height.ts:48-64` (`followMaterialHeight`): at start `materialThickness(project) ?? savedMaterialHeight()`; afterwards the height follows only a *named* thickness that changes; every change is saved to `kerfdesk.camera.materialHeightMm`. `src/ui/camera/camera-height-rule.ts:64-83` can only warn against a named thickness, a rotary or a target-height-only calibration.
- **Anchor:** ADR-441 Amd 14 ("At start: the job material's thickness when the project names one, else the height kept from the last session") meant to fix K2-P2-1, whose harm was the picture drawn at the wrong height "with no warning". ADR-441 Amd 13: the height rule says when the height is wrong.
- **Evidence:** REPRO `k2r\k6-height.mts` (real `followMaterialHeight` + `cameraHeightWarnings`, the K2 refuter's exact truth camera):
  - session ends with the rotary height hand-set to 85 (as Job Review tells the operator to); next session, flat 3 mm plywood, no material named → **Material height 85**, Job Review `[]`, picture **71.53 mm** off;
  - project A names an 18 mm board; project B opened (no material named), 3 mm stock → height stays 18, Job Review `[]`, **13.08 mm** off.
  - Before #1935 the height started at 0 every session: the same flat 3 mm job was 2.6 mm off.
- **Scenario:** a tumbler job on Friday (Material height 85, set as told); on Monday the camera starts by itself and draws on the canvas without the panel opening (K2-P2-1's path); the operator places a logo on a plywood blank on the picture and starts. The logo burns about 70 mm from the blank. Projects that never pick a material (most imported SVG jobs) never correct it.
- **Severity: P1.** It harms a job with no warning; the shifted picture is a visible result, not a warning (METHOD §3). It is a regression of the decision's implementation, not the decision itself: following a named material and saving were chosen, silently reusing a stale height for an unnamed one was not.
- **Announced?** No. The note under Material height says nothing without a material or rotary.
- **Novelty:** new (introduced by #1935).
- **Fix direction:** keep the saved height only together with what it was set for (the material name/thickness, or "rotary"), and on a project or session with no material named start at 0 or the calibration's target height; or let the height rule warn when the height did not come from this project (e.g. "Material height 85 mm was kept from the last job; this project names no material").

### K6-P1-2 — The new neck cut splits one blank with a waist into two pieces, and the fill puts a copy on each half: bone tags, ornaments and hourglass offcuts get two designs each

- **Where:** `src/core/camera/pieces/piece-split.ts:1-17` (watershed "dynamics" cut: `PROMINENCE_MM = 3`, `MIN_DEPTH_MM = 5`), called from `piece-components.ts`; `piece-doubts.ts` sees two equal halves as a normal batch, so no doubt is raised; `PiecesControl` places one copy per ticked piece.
- **Anchor:** ADR-442 Amd 2 ("Pieces that touch at a narrow neck, such as two coasters laid side by side, are cut apart"); K3-P1-1's harm in reverse (a copy per *found* piece, not per blank).
- **Evidence:** REPRO `k3r\k6-necks.mts` (K3 refuter's top-down renderer, the real `findPieces`, the new UI flow): 4 bone tags → **8 pieces, 8 copies, 2 per tag**; 3 snowman ornaments → 6, 2 per ornament; 2 hourglass offcuts → 4, 2 each; no doubts, nothing left out, every copy on the wood. Control `k6-necks-j42.mts` (same scenes on `ba08a81af`): 4/3/2 pieces, one copy per blank. Key fobs with a 12 × 10 tab: unaffected.
- **Scenario:** a batch of bone-shaped pet tags or two-ball ornaments, the design dropped beside them (centred mode). "Found 8 pieces." Place repeats the design 8 times; every blank is engraved twice, off its centre. With a design long enough to span the tag, every half "runs off" and nothing is placed ("Make it smaller or put it on one of the pieces"), which misleads but harms nothing.
- **Severity: P1.** Every blank of the batch is ruined, with no warning; the doubled outlines on the canvas are a visible result (METHOD §3). The trigger is ordinary product shapes (blanks sold as bone tags, figure-8 ornaments).
- **Announced?** No; ADR-442 Amd 2 names only blanks pushed together.
- **Novelty:** new (introduced by #1925).
- **Fix direction:** cut a neck only when both sides look like separate pieces of the batch (similar area or shape to other found pieces, or a straight cut line typical of two touching outlines), otherwise keep one piece and flag it ("may be two pieces touching"), like the flush squares; or flag every piece produced by a cut so it starts left out with that reason.

### K6-P2-1 — A calibration made on another computer is used for whatever camera answers at the same address, with a panel-only notice that says it is "the same camera", no moved check and nothing in Job Review

- **Where:** `src/core/camera/model/saved-cameras.ts:52-71` (`matchesNetworkCamera`: a portable match is a match), `src/ui/camera/panel/CameraElsewhereNotice.tsx` (only in `CameraPanel.tsx:62`), `src/ui/camera/helpers/camera-moved-start-warning.ts` (null without a view reference on this computer).
- **Anchor:** ADR-692 Amd 3 / the maintainer's "Notice + Check camera"; ADR-663 Amd 5 (Job Review warns while the camera may have moved); K2 verified-clean "a project reopened on another computer … the overlay refuses to draw".
- **Evidence:** REPRO `k5r\k6-portable.mts` part C: a `machine-jpeg` camera calibrated on computer A, opened on computer B at the same address → `ownModelUsed: true`, `fromElsewhere: true`, `viewReferenceHere: false`, Job Review moved line `null`. READ: the notice text "It is the same camera at the same address"; the portable identity depends on the address only, so any camera at that address matches.
- **Scenario:** two laser owners with the same machine model share a project or `.lfmachine` file; the model's built-in camera answers at the same fixed address on each machine (or both use a vendor-default IP such as 192.168.1.64 and the default stream path). On the second machine the first machine's calibration is drawn over a different camera; the camera starts by itself and draws on the canvas without the panel, Job Review says nothing, the moved check cannot run (no reference here). Placement is off by however much the two cameras' mounts differ.
- **Severity: P2.** The behaviour was decided and a notice exists; the gap is where it is said (panel only) and what it claims (an identity the app cannot know). P1 is arguable where the camera starts by itself without the panel (no warning reaches the operator).
- **Announced?** Partly: the panel notice.
- **Novelty:** new (introduced by #1937).
- **Fix direction:** say it in Job Review while camera placement is on ("This camera's calibration was made on another computer and has not been checked here"), and word the notice as "a camera at the same address" until Check camera passes.

### K6-P2-2 — Fix a small offset on a knock the moved check has not measured yet still bakes the tilt in: the reference is renewed from the tilted view and the camera stays "steady"

- **Where:** `src/ui/camera/calibrate/nudge-actions.ts:162-194` (`applyNudge`): the refusal reads the moved store as it is; on `open` the refreshed held picture becomes the new view reference and `markCameraSteady()` runs. The nudge photo itself (`captureSourceFrame`) is never checked for moves. After the Fix the canvas holds a still, so `checkLivePictureForMoves` skips (`live-moved-check.ts:35-36`).
- **Anchor:** ADR-663 Amd 7 ("a measured turn is never fixed with one offset"); K1-P1-2.
- **Evidence:** REPRO `k2r\k6-nudge-race.mts` (real helpers, real `applyNudge`): 0.6° tip 1 s before Fix → screen check `open`, `applied: true`, state `steady` 3 s and 35 s later, Job Review `null`, 2 captures in 35 s (no live check while the still is held). `k6-nudge.mts`: after a one-offset fix this tip leaves the bed **2.32 mm** off; a 1° tip (centre 8.7–9.2 mm, under the 10 mm limit) leaves 6.5–6.8 mm (K1/K1r).
- **Scenario:** the operator knocks the camera while setting up the nudge scrap, burns the ring (no checks during the job), takes the photo and presses Fix within the 15 s window. From then on the moved check compares against the tilted view.
- **Severity: P2.** The Fix screen now says "It lines up the middle of the bed only … if the picture is off towards the edges, use Check camera"; the window is narrow (the knock must fall within ~15 s before the ring job, or the picture be held/hidden).
- **Announced?** Partly (the middle-only sentence).
- **Novelty:** residual of K1-P1-2 (KNOWN gap class), new mechanism.
- **Fix direction:** run the moved check on the nudge photo (or on the refreshed still) against the old reference before replacing it, and refuse on a turn.

### K6-P2-3 — SECURITY (redacted)

- **Impact class:** information exposure from saved/shared files. **CWE-200**. **Severity P2.** Introduced by #1937. Details in `zz-k6\SECURITY-DETAILS.md`.

### K6-P3-1 — The fit check reads a dark knot as a hole and leaves the piece out, saying the design "runs 4.9 mm off this piece"; with the design on a flagged merged pair, it tells the operator to put the design on a piece it is already on

- **Where:** `src/core/camera/pieces/piece-fit.ts:20-60` (`offPieceMm` measures against the outline and its holes), `piece-mask.ts` (a knot darker than the pieces' colour becomes a hole); `PiecesControl.tsx` `NOTHING_FITS`.
- **Evidence:** REPRO `k3\k1-pieces.mts knot` (auditor's scene): `holes [1,1,0,1]`, `fitOffMm [0,0,0,4.89]`, piece 4 left out (burned 0); before #1925 all 4 burned with 8.8 mm margin. Refuter `gaps1` sample on the left blank of a flush pair: the sample is the flagged merged piece, every other copy "runs off", "Nothing was placed: … put it on one of the pieces".
- **Severity: P3.** Nothing burns in the wrong place; a blank is skipped with a wrong reason (the piece can be re-done by hand).
- **Novelty:** new (#1925). **Fix direction:** ignore holes smaller than the design's own clearance (or holes fully surrounded by material of similar hue) in the fit check; when the sample is a doubtful piece, say so instead of NOTHING_FITS.

### K6-P3-2 — The rotary height rule accepts the part's diameter as its top: Material height 80 on an 80 mm tumbler whose top is 85 mm is silent with the picture 5.4 mm off

- **Where:** `src/ui/camera/camera-height-rule.ts:66-69` (`height + 1 < diameter`), and its note "at least 80 mm for this part".
- **Evidence:** REPRO `k6-height.mts`: "rotary, hand-set 80 (= diameter)" → Job Review `[]`, picture 5.37 mm off (85 mm top). 85 → 0 mm.
- **Severity: P3.** The note asks for the top and gives the diameter only as a floor; an operator typing the floor is off by the axis clearance.
- **Fix direction:** say "the axis height plus half the diameter" with the axis height asked once in Rotary setup, or warn until the height exceeds the diameter by a stated clearance.

### K6-P3-3 — The cut-picture check refuses a whole JPEG with 15 or more bytes after its end marker

- **Where:** `electron/camera-frame-proxy.ts` `endsLikeJpeg` (looks for FF D9 only in the last 16 bytes).
- **Evidence:** REPRO `k4r\k6-jpegtail.mts` (the real function): 0–14 trailing zero bytes accepted, 15/16/32/512 refused; a real cut refused.
- **Scenario:** a camera whose encoder pads its JPEG buffer (block-aligned buffers, appended metadata) would read "The camera sent a picture cut short" on every picture and never connect. Prevalence not verified on real cameras.
- **Severity: P3.** **Fix direction:** search for FF D9 within the last few KB, or accept when the body is a decodable JPEG.

### K6-P3-4 — SECURITY (redacted)

- **Impact class:** local denial of service (no login use). **CWE-400**. **Severity P3.** Residual after #1932. Details in `zz-k6\SECURITY-DETAILS.md`.

## KNOWN status (on `5e465bfe6`)

| ID | Status |
|---|---|
| K1-P1-1 | fixed (0 unwarned in 46 of 47 calibrations, the exception a mis-engraved sheet graded rough; least est/truth 0.81) |
| K1-P1-2 | fixed for measured moves; residual K6-P2-2 |
| K1-P2-1 | partly: full-bed sheets fixed; straight-down camera with typed height still "fair 3.6 mm" at 0.80 mm true |
| K1-P2-2 | fixed (Job Review + note at another height) |
| K1-P3-1→P2 (head camera) | fixed |
| K2-P1-1 | fixed with the announced window (5–15 s live; up to 15 s after a job or after re-showing); no Start check |
| K2-P1-2 | fixed; K6-P3-2 |
| K2-P2-1 | fixed where a material is named (decision #1935); K6-P1-1 |
| K3-P1-1 | fixed (2 mm gaps separate; flush pairs flagged and left out); K6-P1-2 is its reverse |
| K3-P1-2, K3-P1-3, K3-P1-4, K3-P2-1→P1, K3r-P1-1, K3-P2-2, K3-P2-3 | fixed (K6-P3-1 on the fit check) |
| K4-P2-1 | fixed |
| K4-P2-2 | partly: closing viewers and one viewer's ffmpeg failure no longer stop the camera; a session never claimed still fails at 15 s and stops the recording (E3 8/13) |
| K4-P2-3 | decision #1936 implemented |
| K5-P2-1 | SECURITY fixed (redacted) |
| P3s: K1r-P3-1, K2-P3-1, K3-P3-1, K3-P3-2, K4-P3-1, K4-P3-2, K4r-P3-1 | fixed |
| K2r-P3-1 (mirror read as a small move) | **not fixed** (still "moved 24.27 mm" on the refuter's camera; the new mirror test never fires with the fit chosen) |
| K5-P3-2 (https/redirect read as "check the address") | unchanged (K5 p4: tls, redirect → generic message); not in scope of the fixes |
| K5-P3-3 | decision #1937 implemented; K6-P2-1, K6-P2-3 |
| K5r-P3-4 (password change → "different camera") | fixed for recognised login field names; unrecognised fields still change the identity |
| #1649 | holds for literal logins, paths and tokens; K6-P2-3 (SECURITY, redacted) |
| #1917 trade-off | measured: every part-sheet calibration is "fair" (0 of 45 good), accurate cameras over-read 2.6–37× (median 7×); the floor alone sets about 2.9–3.7 mm on the default sheet, so no constant change helps (table above) |
| Follow-ups named in the ledger | Start check (K2-P1-1): absent; RTSP reconnect (K4-P2-2): absent; frozen last picture (W4-P3-1): not re-run |

## Verified clean

- **Calibration on the rings:** on-target error 0.04–0.29 mm, saved round trip exact (r8), outliers dropped (k5), Check camera flags every move (k3, r3), blur and covered targets refused.
- **Overlay, origins, mounts:** not touched by the fixes (`git diff`), K2 mounts not re-run.
- **Find pieces on simple scenes:** 48/48 tags, centre 0.02–0.11 mm, angle ≤ 0.09° (refuter accuracy); baseline, dark walnut, low-contrast birch 0.08–0.43 mm; fixture replay unchanged; a 71 %-covered bed 16/16.
- **Print and Cut:** rings, crosses, dots, 90° and 180° turns, a toner speck: 0.01–0.07 mm; printer skew/scale limits unchanged (two-point limit, not raised).
- **Trace and engrave target:** trace 0.39 mm worst; engrave 0.00 mm, read-back 0.04 mm rms.
- **Timelapse:** 12-hour job 310 frames / 74 MB, pause takes no pictures, abort keeps the recording, frames in order in every run.
- **Relay and privacy:** the security fix holds (redacted); no literal login in any saved file.

## Not verified

- Vitest, the rendered UI (notes under Material height, the Elsewhere notice, NudgeSteps), real webcams, FFmpeg, Chromium JPEG decode.
- The toast after three missed frames (READ only); whether Continue after a lost connection passes through Job Review (READ only).
- K5 bridge gates (`p1-bridge`) and the refuter's blind-port relay intruder and HTTP-login part 4 (`r1-relay` B, `r2-privacy` part 4): unchanged code; not re-run (see the security file).
- K2 `k1-place`, `k4-modes`, `k6-mounts` (overlay geometry, unchanged code) and K4 `e4`/`e5`/`r5` (frozen picture, main-process load; r4 part B numbers were far better than before but that run is confounded by machine load, not counted).
- K1r R7/R8 (commented out in the refuter's script).

## Repro files

All in `…\scratchpad\zz-k6\`. Each `<area>\` folder holds the earlier auditor's or refuter's scripts with imports moved to `j43-main` and stub ports moved to 5351–5359; run from that folder with `node --max-old-space-size=380 --no-experimental-webstorage --import ./register.mjs <file>`; `run-all.sh` in each folder runs them in order.
- `k1\`: `k1-matrix-{a,b,c}`, `k2-degrade-{a,b}`, `k3-nudge-drift`, `k4-head`, `k5-saved-outliers`, `k6-why`, `k7-fullbed` `.out.jsonl`; **`k6-floor.mts` + `est-var.ts`** → `k6-floor.out.jsonl`, `k6-spread1.out.jsonl` (`SPREAD=1.0`), `k6-spread075.out.jsonl`; summary `..\sumfloor.cjs`.
- `k1r\`: `r1-{a,b,c}`, `r3-nudge`, `r5-{a,b}`, `r6-fbdebug`, `r7-head`, `r8-roundtrip` `.out.jsonl`.
- `k2r\`: `r1-moved`, `r2-helpers` (`register-stub.mjs`), `r3-rotary` `.out.jsonl`; **`k6-nudge.mts`**, **`k6-height.mts`**, **`k6-live.mts`** and **`k6-nudge-race.mts`** (`register-stub2.mjs`: the picture capture stubbed everywhere).
- `k3\`: `k1-pieces.out.jsonl` (patched to the new UI flow; `sum6.cjs`), `k1-fitoff.out.jsonl` (fit offsets), `k2-marks`, `k3-target`, `k4-trace`, `k5-fixture` `.out.jsonl`.
- `k3r\`: `rp.out.jsonl` (`rlib.mts` patched to the new UI flow; `sumrp.cjs`), `rt`, `rm` `.out.jsonl`; **`k6-necks.mts`** (+ `k6-necks-j42.mts`, `rlib42.mts` for the before tree).
- `k4\`: `e1-recorder`, `e2-runner`, `e3-rtsp-session`, `e7-flat-size-change`, `e8-long-job` `.out.jsonl` (stub `stub-cam.mjs`, stopped).
- `k4r\`: `rall.log`, `r1-backoff`, `r2-rtsp`, `r3-runner`, `r4-bridge` `.out.jsonl`; **`k6-jpegtail.mts`**.
- `k5\`, `k5r\`: `p2-relay`, `p3-routes`, `p4-messages`, `r2-privacy` (parts 1–3) `.out.jsonl`; **`k6-relay.mts`**, **`k6-portable.mts`**. Security details: `SECURITY-DETAILS.md` only.

## Counts

Raised 9 (K6-P1-1, K6-P1-2, K6-P2-1, K6-P2-2, K6-P2-3 SECURITY, K6-P3-1, K6-P3-2, K6-P3-3, K6-P3-4 SECURITY) / P1 2 / P2 3 / P3 4 / known 34 (20 K1–K5 P1/P2, 11 P3, 3 decisions re-measured: 25 fixed or implemented, 4 partly — K1-P2-1, K2-P1-1 window, K4-P2-2, K5r-P3-4 — and K2r-P3-1 not fixed).

```json
[
  {"id":"K6-P1-1","severity":"P1","area":"camera-fix-verify","file":"src/ui/camera/helpers/material-height.ts","line":48,"anchor":"ADR-441 Amd 14 / Amd 13; K2-P2-1","evidence":"REPRO","known":false,"summary":"Material height saved from an earlier session/project applies to a project naming no material: 85 mm after a rotary job -> flat 3 mm job 71.5 mm off; 18 mm project -> next project 13.1 mm off; Job Review silent (before #1935: 2.6 mm)"},
  {"id":"K6-P1-2","severity":"P1","area":"camera-fix-verify","file":"src/core/camera/pieces/piece-split.ts","line":1,"anchor":"ADR-442 Amd 2 neck cut","evidence":"REPRO","known":false,"summary":"One blank with a waist (bone tag, two-ball ornament, hourglass offcut) is cut into two pieces with no doubt; fill places 2 copies per blank (8 for 4 tags); j42 placed 1 each"},
  {"id":"K6-P2-1","severity":"P2","area":"camera-fix-verify","file":"src/core/camera/model/saved-cameras.ts","line":52,"anchor":"ADR-692 Amd 3; ADR-663 Amd 5","evidence":"REPRO+READ","known":false,"summary":"Calibration from another computer used for any camera at the same address; notice only in the Camera panel and says 'the same camera'; no view reference so no moved check; Job Review silent"},
  {"id":"K6-P2-2","severity":"P2","area":"camera-fix-verify","file":"src/ui/camera/calibrate/nudge-actions.ts","line":162,"anchor":"ADR-663 Amd 7; K1-P1-2","evidence":"REPRO","known":false,"summary":"Fix a small offset within the 15 s window after a knock: check 'open', Fix applied, reference renewed from the tilted still, steady 35 s later; 0.6 deg tip leaves 2.3 mm, 1 deg 6.5-6.8 mm"},
  {"id":"K6-P2-3","severity":"P2","area":"camera-fix-verify","summary":"SECURITY (redacted): information exposure from saved files, CWE-200","evidence":"REPRO","known":false},
  {"id":"K6-P3-1","severity":"P3","area":"camera-fix-verify","file":"src/core/camera/pieces/piece-fit.ts","line":20,"evidence":"REPRO","known":false,"summary":"Dark knot read as a hole: piece left out 'runs 4.9 mm off'; merged sample -> misleading NOTHING_FITS"},
  {"id":"K6-P3-2","severity":"P3","area":"camera-fix-verify","file":"src/ui/camera/camera-height-rule.ts","line":66,"evidence":"REPRO","known":false,"summary":"Rotary rule accepts the diameter as the top: 80 on an 85 mm top silent, 5.4 mm off"},
  {"id":"K6-P3-3","severity":"P3","area":"camera-fix-verify","file":"electron/camera-frame-proxy.ts","line":195,"evidence":"REPRO","known":false,"summary":"endsLikeJpeg refuses whole JPEGs with >=15 bytes after FF D9"},
  {"id":"K6-P3-4","severity":"P3","area":"camera-fix-verify","summary":"SECURITY (redacted): local denial of service, CWE-400","evidence":"REPRO","known":false}
]
```


## Refuter (2026-11-15)

**Method.** Own scripts in `…\scratchpad\zz-k6r\` (own renderer, own shapes, own camera geometry, real store actions). The auditor's scripts were read for API shape only and not re-run. Tree `j43-main` (`5e465bfe6`); control runs on `j42-main` (`ba08a81af`). One Node process at a time (`--max-old-space-size=350`). No Vitest, browser, pnpm, FFmpeg, camera or network. My only stub listened on 127.0.0.1:5361 and was stopped. Security results are only in `zz-k6r\SECURITY-DETAILS.md`.

### Verdicts on the auditor's findings

| ID | Auditor | Refuter | Own evidence |
|---|---|---|---|
| K6-P1-1 | P1 | **P1 confirmed** | `r1-height.mts`: real `newProject`, `setJobLaserMaterial`, device rotary, real `followMaterialHeight`, real Start warnings `cameraOffTargetWarnings`. A new project names **no material** (`laserMaterial: null`). Rotary job with 85 mm typed → restart → New project, 3 mm stock: Material height **85**, Job Review `[]`. Own pinhole: worst corner 46–83 mm off for a camera 450–250 mm above the bed. #1922's material rule **cannot fire**: with no material named, `materialThicknessMm` is undefined and no issue is built. Naming a material corrects it at once (3 → 0 mm off); clearing the material keeps the last height. Nuance: inside one session the height carried over before #1935 too (it was simply never reset). The **new** harm is the carry across restarts and into new projects, which before always started at 0 (2.5 mm off on 3 mm stock). |
| K6-P1-2 | P1 | **P1 confirmed, and wider** | `r2-necks.mts` (own renderer, 6 blanks per scene, j43 vs j42): bone (⌀30 lobes, 14 neck), guitar (r25 + r20), peanut (r20, centres 30 and 24 apart) and snowman (r14 on r20) → **12 pieces, no doubt, 2 copies on every blank**; j42 had 6 pieces and 1 copy each. Not cut: peanut with centres 20 apart (waist 2.7 mm under the 3 mm prominence), heart, ellipse. Rule (`piece-split.ts`): a lobe is cut off when its inscribed radius is ≥ 5 mm and ≥ 3 mm above the waist half-width. Nothing marks a cut piece; `piece-doubts.ts` sees equal halves as a batch. **Wider (`r6-holes.mts`, `r6b-holes-small.mts`):** a **centre hole or a dark knot at the middle** of a square blank makes four depth maxima near the diagonals, and the cut splits the blank. 70 mm squares with a 14 × 9 mm knot at the middle → 2 pieces each, **2 copies per blank, 20–24 mm off centre**. When only every other blank has a knot, the clean blanks are flagged "larger" and **left out**, while the knotted ones get 2 copies. Square clock blanks 100 mm with an 8 mm centre hole → **4 pieces each, 3 copies per blank**, 28–33 mm off centre (30 × 30 design; a 60 × 60 design runs off every quarter and nothing is placed). Controls: the same squares without hole or knot give 1 each; j42 gives 1 each. Fix direction: the auditor's "similar area to the batch" test fails when every blank is split alike. Two solid blanks can only touch along a narrow contact, so cut only where the neck is narrow (about ≤ 2–3 mm, or a small share of the smaller lobe's depth). A neck through material 15–30 mm wide (bone, hole, knot) is one blank. Flag any piece that comes from a cut wider than that. |
| K6-P2-1 | P2 | **P2 confirmed** (not P1) | `r3-portable.mts` (real identity functions): computer B (new key) and another physical camera at the same address give keyed fingerprints that differ, portable fingerprints that are equal, `networkIdentityMatch` = `elsewhere`, `modelBelongsTo` true, binding compatibility `match` (same frame size), calibration used. The view reference is on A and not on B. `cameraMovedStartWarning` is null. Another path at the same host does not match. **Replaced camera at the same IP on the same computer:** it matches by the keyed identity too (as before #1937), but the view reference is there, so the moved check sees a changed view and Job Review warns within one or two live checks. The silent case needs a second computer that has no calibration of its own (a file's calibration replaces nothing already there) **and** a different camera at an identical address. The maintainer chose a notice for this case. The gap is that the notice lives only in the panel and claims "the same camera". P2 stands; P1 is not met. |
| K6-P2-2 | P2 | **P2 confirmed; mechanism partly refuted** | `r4-nudge-race.mts`: real `installCameraHelpers` + real `applyNudge`, with the **camera picture worker path present**, as in Electron (`Worker`, `OffscreenCanvas` and `createImageBitmap` exist; my fake worker runs the real `compareViews` one macrotask later). The knock (14, −9 px slide) came just before Fix: screen check `open`, Fix applied. **0.3 s after Fix the state is `moved` 28.0 mm and Job Review warns** ("the camera may have moved…"). The held-still check of the refreshed picture was prepared against the **old** reference, and its reply lands **after** `applyNudge`'s `markCameraSteady()`. The auditor's "steady 35 s later, Job Review null" holds only on the worker-less path (Node: `pictureClient()` null, so the comparison runs synchronously before `markCameraSteady`). That path never runs in the shipped desktop app. **The defect remains:** the Fix has already saved the tilted view as the reference. The next picture refresh (Alt+C, or the automatic refresh after the next job) compares against it, publishes `steady`, and **silently withdraws the warning** (`after an Alt+C refresh: state steady, jobReview null`). From then on the moved check guards the tilted view. P2: a warning reaches Job Review once, and the window is narrow. Fix direction unchanged (check the nudge photo or the refreshed still against the old reference before replacing it), plus: never let a renewed reference withdraw a verdict that the old reference produced. |
| K6-P2-3 | P2 | **P2 confirmed** | SECURITY (redacted). Information exposure from saved or shared files. CWE-200. Reproduced with an independent implementation. It is cheaper than the auditor's estimate (details private). It is partly inherent in the chosen design; alternatives that keep portability are in the private file. |
| K6-P3-1 | P3 | **P3 confirmed** (off-centre knot); centred knot → K6-P1-2 | `r5-knot.mts`: a knot 12 mm off centre → hole kept, 1–3 pieces left out ("runs off"), nothing misplaced. A knot at the **middle** goes through the neck cut instead and gives 2 copies per blank (above). Also seen, not raised: a round clock blank ⌀100 with an 8 mm centre hole gets its 30 × 30 design 26 mm off centre, beside the hole. That is ADR-442 Amd 2's "on the material" rule working as written. Whether a design should cover a small hole is a maintainer question. |
| K6-P3-2 | P3 | **P3 confirmed** | Read: `height + HEIGHT_TOLERANCE_MM < diameter`, so 80 on an 80 mm part is silent. Own pinhole at 300 mm: 5 mm under the true top is about 5.8 mm off at the far corner. Kept P3: the Job Review text states "at least … (axis height plus half the diameter)". |
| K6-P3-3 | P3 | **P3 confirmed** | Read: the loop scans `i` from `len−2` down to `len−16`, so FF D9 is accepted with at most 14 bytes after it, and 15 or more are refused. A padded encoder buffer (block-aligned frame buffers on low-cost modules) would refuse every picture. |
| K6-P3-4 | P3 | **P3 confirmed** | SECURITY (redacted). Local denial of service, no login use. CWE-400. Reproduced with my own probe of the real function on my own stub. |

### "Fixed" claims, spot-checked

- **Find pieces 2 mm gaps** (`r7-gaps.mts`, rows of 40 mm squares): 2 and 3 mm separate (6/6); at 45° all separate from 0 mm (the diamonds' tips are necks). A row where **every** blank is flush or ≤ 1 mm apart is one 240 × 40 mm piece with **no doubt**, ticked, and its copy lands on the seam between blanks 3 and 4. This is the **announced** remaining gap of ADR-442 Amd 2 ("doubted larger only when it sits among a batch"), so it is KNOWN and not raised. It is still the K3-P1-1 harm for a tray packed edge to edge.
- **Fix refuses measured turns:** read `nudgeMoveCheck`: refused when any corner moved ≥ `MOVED_MM` (1 mm) more than the middle. This agrees with the auditor's 1.14 mm. The real-app ordering problem above is K6-P2-2.
- **Live knock reaches Job Review:** read `LIVE_MOVED_CHECK_MS = 15_000`, which skips a held or hidden picture and skips during a job. The auditor's 4.9–8.8 s are phase samples inside a 0–15 s window. Consistent.
- **K2r-P3-1 (mirror) not fixed:** read. `mirrors()` tests only the fitted map, and a slide or similarity cannot mirror. If it ever fires, the result is `weak` and becomes "changed" after two checks, which is still a warning. Agree: not fixed.
- **K5-P2-1 fixed:** confirmed with my own probe (private file).
- **K4-P2-2 "never claimed":** read. `STARTING_TIMEOUT_REASON` is unchanged in `rtsp-camera-session.ts`. Agree: partly fixed.
- **#1649:** the saved `sourceId` is scheme, host and port only (own run: `http://192.168.1.64/`). No literal login is saved. K6-P2-3 is the only residual.
- **#1917 trade-off, is there a design fix?** Yes, by measuring instead of extrapolating where the sheet does not reach, rather than by tuning constants:
  - **(a) Corner read-back.** After the target, burn four small rings (or use the head's red-dot or a 1 % dot) at the bed corners and read them back. The grade then comes from measured residuals over the whole bed, so a mild lens is "good" because it was measured good, and a strong lens is "fair" with its measured corner error.
  - **(b) A second pose.** Photograph the same sheet a second time, moved to the far corner (the moved-sheet offset is known from the jog). This doubles the measured area and tests the extrapolation directly.
  - **(c) Hold out the outer rings.** Fit without the outermost ring and predict it. The prediction error scales the floor per camera instead of the fixed 0.025 px/mm.
  - (a) needs no new hardware. (b) and (c) are cheapest in code.

### Remaining partials (agree)

RTSP camera with no viewer stops at 15 s (read). Straight-down camera with a typed height reads "fair ~3.6 mm" (part of the #1917 trade-off; fixed by (a)–(c) above). Mirrored picture still read as a ~24 mm move (read; above).

### Refuter repro files

`zz-k6r\`: `r1-height.mts`, `r2-necks.mts` (argument `j43-main` or `j42-main`), `r3-portable.mts`, `r4-nudge-race.mts` (argument `1` = worker path), `r5-knot.mts`, `r6-holes.mts`, `r6b-holes-small.mts`, `r7-gaps.mts`, each with its `.out.jsonl`. Run from `zz-k6r` with `node --max-old-space-size=350 --no-experimental-webstorage --import ./register.mjs <file> [arg]`. The security scripts and results are in `SECURITY-DETAILS.md` there.

Refuter counts: raised 9, refuted 0, P1 2, P2 3, P3 4, known 35

(No finding refuted outright. K6-P2-2's mechanism is partly refuted: Job Review does warn once on the shipped worker path, but the poisoned reference silently clears that warning on the next refresh, so P2 stands. K6-P1-2 widened to blanks with a centre hole or knot. K6-P2-3 is cheaper than stated, still P2. Known 35 = the auditor's 34 plus the announced all-flush-row gap of ADR-442 Amd 2, re-measured.)
