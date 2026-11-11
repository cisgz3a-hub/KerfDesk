# Rolling audit v13 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| Y1 | Camera setup and calibration | origin/main @ f61a0757a. The refuter ran on the same tree; the coordinator re-read 4c4b98fd0, which has no camera changes. Synthetic lenses and renderers from both the auditor and the refuter went through the real calibration, grade, accuracy-map and moved-check code, plus Vitest on the camera folders (859 tests) | [Y1-camera-setup-calibration.md](Y1-camera-setup-calibration.md) | 9 | 0 | 3 | 0 | 6 | 20 |
| Y2 | Camera connection and login (trust boundary) | origin/main @ 4c4b98fd0 (refuter 4c4b98fd0; coordinator re-read bf841ff5e, camera code unchanged; local 127.0.0.1 RTSP, MJPEG, snapshot and phone stubs with synthetic logins traced through every save and share route; Vitest 182 login tests) | [Y2-camera-connection-login.md](Y2-camera-connection-login.md) | 6 | 0 | 0 | 3 | 3 | 5 |
| Y3 | Camera placement and burn (accuracy in mm) | origin/main @ bf841ff5e (refuter on bf841ff5e–82a9713a4, no change to these files; coordinator re-read 82a9713a4; synthetic camera scenes through the real overlay, Find pieces and Start preparation, G-code mapped back to the bed; flat-bed placement exact to 0.02 mm) | [Y3-camera-placement-burn.md](Y3-camera-placement-burn.md) | 4 | 0 | 3 | 0 | 1 | 9 |
| Y4 | Camera job watch, timelapse and remote stills | origin/main @ 82a9713a4 (refuter on 82a9713a4 to 8493f590c, no change to the cited code; coordinator re-read 8493f590c; browser runs with 127.0.0.1 stub cameras and a real-time simulated controller that records lit stops) | [Y4-camera-job-watch.md](Y4-camera-job-watch.md) | 6 | 0 | 2 | 1 | 3 | 9 |
| Y5 | Rotary fix verification (the v12 X8 fixes #1670–#1677, #1686) | origin/main @ 8493f590c (refuter on 144e45d76, with no src change; coordinator re-read 144e45d76; Node with main's real emit, resume, load and Job Review code, plus two independent rotary kinematics and controller models on GRBL, grblHAL, FluidNC, the A1 Pro and Marlin) | [Y5-rotary-fix-verify.md](Y5-rotary-fix-verify.md) | 8 | 0 | 4 | 2 | 2 | 10 |
| **Total** | | | | **33** | **0** | **12** | **6** | **15** | **53** |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| Y1-P2-1 (P1, refuter) | Y1 | **The default 300 × 200 calibration sheet grades "Accurate enough for placing artwork by eye", but the far bed is several mm off, and nothing later warns.**<br>• Centred cameras are 2.6–5.8 mm off at the far bed (4K, 30° oblique, a 600 × 400 bed), in the refuter's lenses.<br>• Off-centre cameras are 3–12 mm off in the refuter's lenses and 8–36 mm in the auditor's stronger lens.<br>• ADR-441 Amd 8 and the store comment promise "about 1.3 mm across a 400 mm bed", and the setup tooltip says A4 "calibrates the whole bed well".<br>• The grade uses only the in-sample ring RMS. Job Review, Start, Frame and the overlay never read the calibration's accuracy; the only signal is one wizard sentence, whose advice (a smaller margin) cannot help. | **READ** (main `4c4b98fd0`): `calibration-result.ts:94-98` (`GOOD_RMS_MM`, `EXTRAPOLATED_SHARE`) and `:124-130,153-160`; `camera-calibration-store.ts:146-151` (default sheet, with the 1.3 mm claim in the comment); `bed-calibration.ts:123-146` (in-sample figures only). **REPRO** (auditor and refuter): independent synthetic lenses through the real calibration (`zz-y1/`, `zz-y1r/r1-offsheet.mts`, `r1b-widelens.mts`, `r1c-sheetsize.mts`). | fixed by #1684 (also Y1-P3-1, Y1-P3-6) |
| Y1-P2-2 (P1, refuter) | Y1 | **The camera-moved warning stays silent on small rotations and knocks, and a later weak match withdraws a warning already on screen.**<br>• Silent on a 0.5–2° roll (2.7–10.6 mm), a 3° pitch (30 mm at the bed centre), a 20 mm slide, combined knocks, and 1–2 % focus breathing.<br>• The check is a translation-only edge correlation (±16 px, score ≥ 0.6).<br>• Any weak or failed match publishes `unknown`, which replaces a showing `moved` and hides the notice, so a knocked camera ends up with no warning.<br>• The withdrawal is the strongest P1 part; silence alone would be a P2 detection gap. | **READ** (main `4c4b98fd0`): `view-shift.ts:31,37,121-131,263-291`; `moved-check.ts:110-111` (a weak match publishes `unknown`) and `:154-159` (`publish` replaces the state); `CameraMovedNotice.tsx:20-26` (renders only while the state is `moved`). **REPRO:** refuter Vitest on the real check and notice (`zz-y1r/tree/src/ui/camera/helpers/zz-y1r-withdraw.test.tsx`, `r5-withdraw.vitest.txt`) and synthetic moves (`r2-moved.mts`). | fixed by #1680 (also Y1-P3-2) |
| Y1-P1-1 (refuter; was #1546 item 5) | Y1 | **A frame with the calibrated shape but a different size is used as a plain rescale, even when it is a sensor crop.**<br>• A 1080p calibration on a 720p crop of the same shape is 62 mm off on the target and 117 mm on the bed, for USB and phone cameras alike, with no notice.<br>• USB asks for an `ideal` 1920 × 1080, so a camera that cannot give it falls back silently. Phone and machine-JPEG sources serve whatever size their app is set to.<br>• Only `crop-and-scale` is refused.<br>• Whether real webcams crop at a smaller mode of the same shape is unconfirmed (no network). If none do, this drops to P3. | **READ** (main `4c4b98fd0`): `camera-model-frame.ts:39-58` (only `crop-and-scale` is refused); `camera-capture-binding.ts:83-89` (aspect within 0.001); `camera-model-record.ts:63-75` (`lensForFrame` scales); `web-camera.ts:71-72`. **REPRO:** refuter (`zz-y1r/r3-frame.mts`). | fixed by #1681 |
| Y2-P2-1 | Y2 | **SECURITY: credential exposure to other local processes.** Redacted until fixed. No remote reach. | **READ** (main `bf841ff5e`, coordinator; location held privately) and auditor and refuter **REPRO** (details in the coordinator's scratchpad only) | fixed by #1685 |
| Y2-P3-2 (P2, refuter) | Y2 | **SECURITY: a credential-bearing part of a camera address persists in saved and shared files.** Redacted until fixed. It reaches files that can be shared and conflicts with ADR-692 D1. | **READ** (main `bf841ff5e`, coordinator) and refuter **REPRO** (scratchpad only) | fixed by #1685 |
| Y2-P3-3 (P2, refuter) | Y2 | **SECURITY: a credential is sent in clear text on the local network where a secure option was available.** Redacted until fixed. The part inherent to some cameras' own protocol is already announced and stays KNOWN. | **READ** (main `bf841ff5e`, coordinator) and refuter **REPRO** (scratchpad only) | fixed by #1685 |
| Y3-P1-1 | Y3 | **On a rotary, Job Review's camera advice moves the burn along the part.**<br>• The advised mode, Current Position, centres X on the head. Artwork placed at X 250–280 with the head at X 60 burned 190–205 mm along the part on Y, A and Z rotaries, while the advice says the camera picture keeps that position.<br>• On A and Z, Absolute keeps the picture's X, yet the advice warns against it for a reason that is no longer true.<br>• Y regressed in #1641 (before it, the warning was right), and A/Z came with #1671.<br>• The existing test cannot catch it: its head X equals the artwork centre, and it covers only Y chucks.<br>• Fix direction: on A/Z, accept Absolute; on Y, tell the operator to jog over the artwork first. | **READ** (main `82a9713a4`): `start-job-readiness-policy.ts:112,143` (`cameraPlacementStartFromWarning`, the rotary branch from ADR-228 Amd 2) and `rotary-transform.ts:45-57`. Auditor and refuter **REPRO** (Node, real Start preparation on Y/A/Z: `zz-y3/`, `zz-y3r/r1-rotary.mts`) | fixed by #1686 |
| Y3-P1-2 | Y3 | **A canvas camera target burned from Current Position or User Origin lands away from its layout, yet calibration grades it "Accurate enough".**<br>• Pressing Set origin after "Add target to canvas" quietly switches Absolute to User Origin; the toast says only "Origin set to current head position (G92)".<br>• The burn is then not stamped as the target's, but the photo step still uses the layout and does not refuse.<br>• Results: 26.5–156 mm shifts; the real calibration finds 35/35 rings and gives the same grade as the control; every later placement carries the offset.<br>• Separate root from Y1-P2-1: a correct fit to wrongly labelled rings. | **READ** (main `82a9713a4`): `canvas-target-burn.ts:45-47` (`stampCanvasTargetBurn` returns false off Absolute); `calibration-actions.ts:157-170` (photo step uses the layout regardless). Auditor and refuter **REPRO** (`zz-y3r/r2-target-flow.mts`, `r2b-calibrate.mts`) | fixed by #1687 |
| Y3-P2-1 (P1, refuter) | Y3 | **Camera Print and Cut pairs the two registration marks the wrong way round once the sheet is turned past about 90°.**<br>• With marks at opposite corners: 92°, 120°, 180°, 270° and −100° all mis-pair; the cut misses by 136 mm on average (186 mm worst).<br>• With both marks on one edge it already fails at 88° (225 mm).<br>• An upside-down sheet reports "turned 0.0°", and the unusual-registration check never fires. The head-capture route flags the same sheet; the camera route loses that protection. | **READ** (main `82a9713a4`): `match-mark-pair.ts:50-61` (both orderings tried; the smallest `offsetMm` wins, which is ambiguous under a half turn); `registration-check.ts:27`; `print-cut-camera.ts:129-150`. Auditor and refuter **REPRO** (`zz-y3r/r3-printcut.mts`) | fixed by #1688 (also Y3-P3-1) |
| Y4-P1-1 | Y4 | **Job watch decodes, flattens and encodes each camera picture on the UI thread, and Abort is sent from that thread, so Abort waits for the picture work.**<br>• Abort reached the controller 74–205 ms after the key (4K to 24 MP) in the refuter's run and 154 ms in the auditor's, against 10–19 ms with the watch off. At 6000 mm/min that is 6–20 mm of extra lit travel.<br>• The burn check's first picture blocks 145–278 ms at Start.<br>• When a job streams from the window (an adapter with no unique ID, or background streaming off), each block also drains the controller. With M3 (constant power) the head stops with the beam on for up to 373 ms per frame.<br>• Plain 720p and 1080p cameras do not block; it needs 4K or larger, or a calibrated camera on a large job.<br>• ADR-490 says the watcher "cannot hold a job back"; the running-job budget is 50 ms.<br>• Job watch existed in 1.0.29, so this is not a 1.0.30 regression. | **READ** (main `8493f590c`): `decode-jpeg.ts:26-40` (`createImageBitmap`, then a DOM canvas and `getImageData` on the UI thread); `bed-image.ts:58-64`; `job-watch-runner.ts:98-113`. Auditor and refuter **REPRO** (browser; the refuter's real-time simulated controller records lit stops: `zz-y4/mut/e2e/zz-y4-watch.e2e.ts`, `zz-y4r/mut/e2e/zz-y4r-job.e2e.ts`, `out/r-job.json`) | fixed by #1695 (also Y4-P2-1) |
| Y4-P1-2 (refuter) | Y4 | **A calibrated network (RTSP) camera's live overlay re-uploads the picture to WebGL on the UI thread every 33 ms, whether or not the frame changed.** With a 4K RTSP camera, watch off:<br>• The UI thread is held 97–98 % of the job.<br>• Streaming from the window, 109–119 lines went out in 15–20 s, against 3,803 with the overlay hidden.<br>• The beam stayed on over a stopped head for 4–11 s in total, with single stops of 5.3–5.5 s.<br>• Abort waits 76–83 ms.<br>A 4K phone camera blocks 14 % of the time; a USB camera is clean. | **READ** (main `8493f590c`): `use-bed-overlay-drawing.ts:96-137` (`watchLiveFrames` redraws when the key changes) and `:214-222` (`liveFrameKey` changes every `STREAM_FRAME_MS = 33` for a stream, so the overlay redraws about 30 times a second). Refuter **REPRO** (`zz-y4r/mut/e2e/zz-y4r-job.e2e.ts`, `out/r-job.json`) | fixed by #1691 |
| Y4-P2-1 | Y4 | **A phone or MCP camera still (`get_camera_snapshot`) does the same decode and encode on the PC's UI thread during a job.** A 4K still blocks 62–195 ms; 1080p does not. The phone asks only when tapped, so this needs a control-approved client asking repeatedly. Same cause and fix as Y4-P1-1. | **READ** (main `8493f590c`): `src/ui/remote-control/adapter.ts:74-75,113-126`. Auditor and refuter **REPRO** (`zz-y4/mut/e2e/zz-y4-watch.e2e.ts`) | fixed by #1695 |
| Y5-P1-1 | Y5 | **On an A or Z rotary, a re-run after Abort starts from whatever turn the part stopped at.**<br>• Every job and Frame opens with `G92 A0`/`Z0`, but the Abort origin restore puts back X and Y only.<br>• The re-run lands 66–84 mm round an Ø60 part on the A1 Pro (A), on FluidNC (A) and on stock GRBL (Z). The Y-port control lands 0.00 mm off.<br>• Nothing warns: the Abort card says Restore "puts the origin back where the job started", and KerfDesk never shows the A position.<br>• From #1671, which shipped in 1.0.30. | **READ** (main `144e45d76`): `abort-alarm-recovery.ts:46-53` (`restoreAbortOriginFromIdle` restores `{x, y}` only); `rotary-axis-emit.ts:37` (`G92 A0` per job); `unrestored-abort-origin.ts:165-172` (the rotary returns null on A/Z). Auditor and refuter **REPRO** (`zz-y5/`, `zz-y5r/r1-abort-resume.mts`) | fixed by #1697 |
| Y5-P1-2 | Y5 | **Start from line and lost-link recovery on an A or Z program re-enter at the head's X but not at the part's turn.**<br>• The resume moves only `G0 X… Y… S0`.<br>• On the A1 Pro the first burn is 22 mm off. On FluidNC A and GRBL Z, where the reset clears G92, every remaining line is 19.4–174.4 mm off.<br>• Neither the picker nor the resume review mentions the turn. | **READ** (main `144e45d76`): `resume-program.ts:204-215` (`applyWord` tracks X and Y only) and `:344-349` (`positionMove` writes X/Y); `start-job-resume-stream.ts:163-166` (the same builder serves lost-link recovery); no rotary check in `resume-review-warnings.ts`. Auditor and refuter **REPRO** (`zz-y5r/r1-abort-resume.mts`) | fixed by #1697 |
| Y5-P2-1 (P1, refuter) | Y5 | **On a tapered part the Max-feed clamp bites without Job Review's promised warning.**<br>• The warning checks only the rotary's Y scale, and only when that scale is above 1. It never reads the taper factor.<br>• A roller with no roller diameter has a scale of exactly 1, so it can never warn.<br>• On an Ø88→Ø72 tumbler with a fill at 6000 Max feed, the narrow end burns 118.7–122.2 %, silently. Same class as X8-P1-1. | **READ** (main `144e45d76`): `rotary-surface-speed-warnings.ts:16-26` (`if (!(scale > 1) …) return []`); `rotary-surface-feed.ts:54-62` (the clamp includes the taper). Auditor and refuter **REPRO** (`zz-y5r/r3-taper-clamp.mts`) | fixed by #1698 |
| Y5-P1-4 (refuter) | Y5 | **On a Z or A rotary, the feed is capped only at the profile's Max feed; the axis's own max rate (`$112`/`$113`) is never read.**<br>• The controller then slows the move silently, and round strokes get 107–430 % of the dose.<br>• The A1 Pro preset names Z as its fallback, and the repo's A1 Pro settings dump has `$112=2000` against a 36,000 Max feed.<br>• Stock GRBL on Z with `$112=500` and a fill at 6000 gives 191 %.<br>• No warning in any case.<br>• Unverified: whether a real A1 Pro routes the rotary to Z with that rate. | **READ** (main `144e45d76`): no `$112`/`$113` read anywhere in `src/core/output` or `rotary-axis-emit.ts`; `rotary-surface-feed.ts:54-62` clamps at the profile Max feed. Refuter **REPRO** (`zz-y5r/r4-challenges.mts`; GRBL v1.1h's per-axis planner) | fixed by #1697 (warns; the controller planner caps the move) |
| Y5-P1-3 (P2, refuter) | Y5 | **The row-step warning's first suggested interval (one step) can leave rows on rounding ties, and the warning then goes silent.**<br>• 136 of 382 rows double-burn only with an exact 12.73 lines/mm entry, a lone or bottom photo, and rows placed at mid-pitch then written to 3 decimals.<br>• The printed 0.079 mm interval doubles 4 rows of 380. Same effect as X8-P2-3 (P2). | **READ** (main `144e45d76`): `emit-raster.ts:233` (rows written to 3 decimals); `CutSettingsImageFields.tsx:283-316`. Refuter **REPRO** (`zz-y5r/r2-rowstep.mts`, `r2b-rows.mts`) | fixed by #1698 |
| Y5-P2-2 (refuter) | Y5 | **A 1.0.29 rotary project opens with no old-project burn notice, although its strokes round the part now get 6.28× the dose 1.0.29 gave them.** ADR-682 Amd 3 says the file must raise this, not only the release notes. The 1.0.31 update notes do mention it. | Refuter **REPRO** (the 1.0.29 rotary golden through the real load: `zz-y5r/r4-challenges.mts`) | fixed by #1698 |

## Round result (2026-11-10)

Each of the five areas went through an auditor, a fresh refuter and a coordinator check in main's code. The trees were `f61a0757a`, `4c4b98fd0`, `bf841ff5e`, `82a9713a4`, `8493f590c` and `144e45d76`. Cameras were stubs only: synthetic lenses, frames and targets, and 127.0.0.1 RTSP, MJPEG, snapshot and phone stubs. No real camera or network was used.

**Totals.**
- 33 raised, 0 refuted: P1 12, P2 6, P3 15, plus 53 earlier findings rechecked and still open (KNOWN).
- Refuters raised 10 findings: seven re-ratings and three new ones (Y1-P1-1, Y4-P1-2, Y5-P1-4). They lowered one (Y5-P1-3 to P2).
- Three security findings (Y2) were kept redacted until #1685 fixed them.

**Fix status.**
- **Camera (Y1–Y3):** every P1 and P2 is fixed on main, by #1680, #1681, #1684, #1685, #1686, #1687 and #1688, plus follow-up #1683.
- **Y4:** Y4-P1-2 has fix PR #1691 open. Y4-P1-1 and Y4-P2-1, the camera picture work on the UI thread, are with the camera session.
- **Y5:** all six P1 and P2 are routed to the rotary sessions.

**Release.**
- Y3-P1-1, the rotary camera advice, was a 1.0.30 regression from #1641 and #1671. 1.0.30 was held until #1686 fixed it.
- Y5-P1-1 and Y5-P1-2 come from #1671 and shipped in 1.0.30. The 1.0.31 notes should name their fixes.
- Y4's findings date back to 1.0.29.

**The pattern.**
- **Twin routes again.** A fix that covered one route left another uncovered:
  - Y-port vs A/Z for Abort and resume (Y5-P1-1, -2);
  - the camera advice per rotary axis (Y3-P1-1);
  - head capture vs camera for Print and Cut (Y3-P2-1).
- **Numbers that aren't true.** A grade or check reported a number the hardware didn't deliver:
  - "Accurate enough" (Y1-P2-1, Y3-P1-2);
  - the moved check (Y1-P2-2);
  - the Max-feed warning on a taper (Y5-P2-1);
  - the per-axis rate (Y5-P1-4).
- **Heavy work on the UI thread.** Camera pictures are processed on the same thread that sends Abort (Y4-P1-1, -P1-2).

### Camera status (the maintainer asked for camera tests)

Flat-bed camera placement is exact: within 0.02 mm with a correct calibration, for every origin mode, the A1 Pro and the head camera. Camera logins stay out of every saved and shared file.

The calibration grade, the camera-moved check, sensor-crop detection, target engrave, Print and Cut past 90°, and the rotary camera advice were all wrong. All are now fixed on main.

Still open: camera picture work on the UI thread can delay Abort by 74–205 ms and stall window-route streams, with the beam lit (Y4). Fixes are in progress.

### Rotary status (the maintainer's question: "put in a round glass … and burn perfect burn while it rotates")

**On a first, uninterrupted run, yes.** On the A1 Pro's A preset with Test rotation confirmed:
- a straight or tapered glass wraps exactly 360° with a 0 mm seam;
- a 20 mm square measures 20.00 mm;
- strokes in every direction burn within 0.84 % of the layer speed;
- photos are even at the warning's 2-step interval.

**Not yet in these cases:**
1. After an Abort, or with Start from line or lost-link recovery, on an A or Z rotary. The re-run or resume ignores where the part turned to (Y5-P1-1, -2).
2. On a tapered tumbler on rollers with fills near Max feed. The clamp bites silently (Y5-P2-1).
3. On a Z rotary with a low Z max rate (Y5-P1-4).

All are routed to the rotary sessions. The maintainer's own `$$`/`$I` with the rotary fitted would settle which axis their A1 Pro's rotary port uses.

### Maintainer decisions open

BQ-20, W9-P2-1, S9-P3-1, S8-P2-1, S8-P3-3, the Worker redeploy, and the X6-P1-1 rating, all carried over from v12.

### P3s (15)

Listed per area report. Proposed sweeps:
- camera wording and messages: Y1-P3-x, Y2-P3-4, Y3-P3-1, Y4-P3-1 to Y4-P3-3;
- rotary wording: Y5-P3-1, Y5-P3-2;
- camera robustness: Y1-P3-3, Y1-P3-4, Y2-P3-5.

### Not verified

- Real cameras, phones, NVRs and ffmpeg.
- Hardware and real serial ports.
- The packaged Electron app.
- GPUs other than one Intel Iris Xe.
- The serial-worker streaming route with a real port.
- Marlin streaming, which was read but not simulated.
