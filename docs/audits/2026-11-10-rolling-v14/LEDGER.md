# Rolling audit v14 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| Z1 | Camera thread verify (#1691, #1695) | origin/main @ 74191e0c7 (auditor and refuter; camera changes since are dead-export clean-ups only). The coordinator re-read 7d28c8e0e. Browser runs with 127.0.0.1 stub cameras and a real-time simulated GRBL that records lit stops; a CDP trace; the same bench in the shipped Electron 44.5.1 runtime | [Z1-camera-thread-verify.md](Z1-camera-thread-verify.md) | 5 | 0 | 1 | 2 | 2 | 6 |
| Z2 | Rotary resume verify (#1697) | origin/main @ 7d28c8e0e (auditor and refuter). The coordinator re-read 236cccf6e, where only #1732 touched these files: it adds a job-kind field, and its automatic Abort restore skips rotary jobs (`abort-auto-restore-eligibility.ts:84`). Node with main's real stop, restore, resume and Job Review code, the real store in the GRBL simulator, an independent rotary controller model, and the stock GRBL source for reset semantics | [Z2-rotary-resume-verify.md](Z2-rotary-resume-verify.md) | 5 | 0 | 1 | 2 | 2 | 5 |
| Z3 | Rotary feed verify (#1698) | origin/main @ 236cccf6e (auditor and refuter). The coordinator re-read 1cf8f63a3, where none of the cited files changed. Node with main's real emit, prepare, Start readiness, Moshi encoder and decoder, project loader and Job Review detectors; two independent rotary physics models and G-code readers; 1.0.30 files saved by the 1.0.30 source | [Z3-rotary-feed-verify.md](Z3-rotary-feed-verify.md) | 7 | 0 | 2 | 1 | 4 | 5 |
| Z4 | Round-glass journey (all fixes together) | origin/main @ c3856ce06 (auditor and refuter). The coordinator re-read dcca5b8c4, where none of the cited files changed. Node with main's real Start preparation, emit, Job Review, Preview, Moshi encoder and decoder, project save and load, and the Abort/resume store; two independent G-code readers, a stroke-and-dose model and a surface-coverage model. No browser run (memory stayed under 1 GB) | [Z4-round-glass-journey.md](Z4-round-glass-journey.md) | 3 | 0 | 1 | 2 | 0 | 17 |
| **Total** | | | | **20** | **0** | **5** | **7** | **8** | **33** |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| Z1-P1-1 | Z1 | **#1691's overlay still shrinks each bridge-camera picture on the UI thread.** Chromium decodes off the thread but scales on the thread that resolves `createImageBitmap`.<br>• A CDP trace shows one 157–243 ms renderer-main task per 4K picture resized to 1,920 px, and 98–166 ms in Electron 44.5.1. The same call in a worker blocks nothing.<br>• In a job on the window route, a 4K RTSP camera held the UI thread 20–31 % of the time, at every window size tried. That includes 1280 × 720, the viewport #1691's own guard runs at.<br>• Lit stops reached 137–259 ms, and an aimed Abort waited 100–130 ms.<br>• A 1080p camera is affected too: 75–81 ms Abort and lit stops up to 137 ms. A maximised full-HD window shrinks a 1,920 px picture by 3 px and pays the whole cost.<br>• No warning names this cause. | **READ** on main `7d28c8e0e`: `machine-frame-feed.ts:100-104` resizes with `createImageBitmap(blob, { resizeWidth, resizeQuality: 'medium' })` in window code. `use-machine-frame.ts:52-55` caps the width at 1,920 = round(CSS width × DPR × 1.5). Auditor and refuter **REPRO**. Main's Browser smoke fails `e2e/camera-overlay-mjpeg-ui-thread.e2e.ts:48`, #1691's own guard. | **fixed by #1740** (camera session; ADR-440 Amd 11, ADR-663 Amd 6, ADR-598 Amd 6; verified by reading in Z4). Originally routed to the camera session (local_3a5a202f). Fix direction: resize in the camera picture worker and transfer the bitmap; skip near-equal resizes; run the guard at 1920 × 1080 during a job |
| Z1-P2-1 | Z1 | **Starting or switching a camera during a job, including opening the Camera panel, still decodes a full frame on the UI thread** for the camera-moved check 3 s later.<br>• 76–141 ms at 4K, with a 71–138 ms lit stop on the window route.<br>• With a saved view reference, `viewThumbnail` reads the whole frame on the UI thread too: 47–119 ms more at 4K, and 152–327 ms at 24 MP.<br>• `autoStart` is on by default, so every panel open during a job does this. | **READ** on main: `install-camera-helpers.ts:116-137` runs `captureSourceFrame(source)` and then `checkCameraMoved` on the window. `frame-source.ts` reaches `decode-jpeg.ts:37-39` (`drawImage` + `getImageData`). Auditor and refuter **REPRO**. | **fixed by #1740** (camera session; ADR-440 Amd 11, ADR-663 Amd 6, ADR-598 Amd 6; verified by reading in Z4). Originally routed to the camera session, as one cluster with Z1-P2-2 |
| Z1-P2-2 (refuter) | Z1 | **Alt+C (Update Overlay) or Refresh picture during a job decodes the full frame on the UI thread and uploads a full-size held still.**<br>• One 251 ms block, then a 131 ms block at 4K.<br>• Abort waits up to 0.25 s, and the window route stopped lit for 148 ms.<br>• With a view reference, the moved check's thumbnail runs on top of that. | **READ** on main: `capture-overlay-still.ts:6,27` uses `captureSourceFrame`, which goes to `decode-jpeg.ts:37-39`; `refresh-picture.ts:13,26` does the same. Refuter **REPRO** (`r-job.json`, key `…-altc`). | **fixed by #1740** (camera session; ADR-440 Amd 11, ADR-663 Amd 6, ADR-598 Amd 6; verified by reading in Z4). Originally routed to the camera session, as one cluster with Z1-P2-1. Fix direction: capture through the picture worker, hold a worker-shrunk `ImageBitmap`, and run the thumbnail in the worker |

| Z2-P1-1 | Z2 | **After a power-up or a reconnect between Abort and the re-run, the saved start turn is still in the old machine count.**<br>• Job Review advises turning the wrong way, Start from line sends `G53 G0 A<stale>`, and on stock GRBL Z, FluidNC and grblHAL with `$384=1` the Frame offer homes and turns the part to the wrong turn while saying it turned it back.<br>• The error is 11–94 mm round an Ø60 part the short way (85.4 mm in the A1 Pro case). The auditor's 68–240 mm counted whole turns, which don't show on a chuck.<br>• On the A1 Pro (`$384=0`, G92 restored at power-up) the Frame offer does not appear; the wrong Job Review advice and Start from line are what it reaches.<br>• The X/Y origin is already guarded against this (ADR-341 Amd 13, `originMachineZeroEpoch`); the rotary turn is not. | **READ** on main `236cccf6e`: `laser-job-stop.ts:482-490` (`rotaryStartTurnAtStop`) returns `{ axis, machine }` with no epoch, beside the X/Y origin that carries `originMachineZeroEpoch`. `resume-rotary.ts:43-47` writes `G53 G0 ${axis}${zero.machine}`. Auditor **REPRO** (simulator and model), refuter **REPRO** with the GRBL source: machine position clears at power-up, not at the Abort's soft reset. | **fixed by #1742** (ADR-695 Amd 2; re-measured in Z4). Originally routed to the rotary-axis session (local_cf75e975). Fix direction: stamp the start turn with `machineZeroEpoch` and drop it (with an honest "turn the part to its start by hand" message) when the epoch moved |
| Z2-P2-1 | Z2 | **The turn-back after Abort waits only 3 s for the rotary to stop.** From about 75° on A (or 75 mm of Z at 1,500 mm/min), a correct turn-back is reported as "The rotary did not finish turning back. Check the part.", and the Frame offer then refuses to Frame. The part ends at the right turn. The PR's own simulator finishes every jog in 400 ms, so its test cannot see this. | **READ** on main: `abort-rotary-turn.ts:80-89` jogs at 1,500 mm/min, then `waitForControllerStatus` must see Idle within `STATUS_WAIT_TIMEOUT_MS = 3_000` (`frame-status-wait.ts:13`), or it throws. Auditor and refuter **REPRO** (passes up to 70°, throws at 3.0 s from 75°). | **fixed by #1742** (ADR-695 Amd 2; re-measured in Z4). Originally routed to the rotary-axis session. Fix direction: wait for the length of the move (distance ÷ feed plus a margin), or until the status reports Idle after Run |
| Z2-P3-2 (P2, refuter) | Z2 | **On a Z rotary, the first Frame after any turn change is refused as "Controller or machine setup changed during Frame".** That includes aiming the design with the turn buttons, or a job that does not end at turn 0. The Frame's own `G92 Z0` changes Z's work offset. Framing again at the same turn passes, and A is never refused. It comes from #1671 (ADR-695), not #1697. | **READ** on main: `rotary-axis-frame.ts:64-67` puts `G92 Z0` first; `framed-run.ts:413-416` (`sameAxes`) compares the WCO's x, y and **z** before and after the Frame. Auditor and refuter **REPRO**. | **fixed by #1742** (ADR-695 Amd 2; re-measured in Z4). Originally routed to the rotary-axis session. Fix direction: leave the rotary axis out of the setup comparison when that axis is the job's rotary output |
| Z3-P1-1 | Z3 | **A Fill with Ramp (ADR-699) keeps its hatch angle on a rotary, and every layer in the job moves with it.**<br>• Images always scan along X on a rotary (ADR-492 D9); a ramped Fill compiles to a raster that never gets that rule.<br>• On the A1 Pro (A) at 30–45° the shape burns 45–61 mm along the glass and 82–134° round it from the design, at 107–116 % dose. At 5–20° it is still displaced (X +15 to +47 mm).<br>• On a Y-port rotary at 5–20° it passes preflight and Start silently: at 15° it burns about 75 mm along and 120 mm round, stretched to 33.5 mm. At 30° and over, Start runs it with a false "wraps N turns" or out-of-bed warning. With Current Position there is no warning at all.<br>• `jobYRange` takes the turned raster's scan-frame bounds as bed Y, so a plain Line layer in the same job moves 160° round the part.<br>• Cut Settings shows Scan angle and Ramp on every device. | **READ** on main `1cf8f63a3`: `fill-ramp.ts:60-66` takes `hatchAngleDeg` (plus 90° for Cross-hatch) with no rotary rule; `rotary-transform.ts:114-121` (`jobYRange`) and `:139-145` (`mapRasterGroup`) read raster `bounds.minY/maxY` as bed Y. Auditor and refuter **REPRO** with independent G-code readers; the refuter also drove the real `prepareStartJob`. | **fixed by #1743** (ADR-699 Amd 1; re-measured in Z4). Originally routed to the ADR-699 session (local_a84714db). Fix direction: give ramped Fills the image rule on a rotary (0° only, no Cross-hatch or per-pass angles, `image-scan-angle-rotary`), or refuse a turned raster in `machineSpaceJob`; test a ramped 45° Fill plus a Line layer on Y, A and Z |
| Z3-P1-2 | Z3 | **A Moshiboard (ADR-705) with a Y-port rotary writes one speed per layer, so strokes round the part get the wrong energy.** Strokes round an Ø80 glass burn at 15.9 % of the set energy in a 40 mm/turn chuck, 31.8 % at 80 mm/turn, and 183.6 % on a geared roller. Strokes along X burn at 100 %. A calibrated roller is unaffected. This is the X8-P1-1 class that #1672 fixed for G-code. Tools → Rotary Setup is always enabled and offers Y for Moshi, and no UI path checks the profile's rotary capability. The Moshi route has no Job Review and no warning. | **READ** on main: `emit-moshi.ts:38-44` refuses only A/Z and encodes `machineSpaceJob(...)`; `moshi-job-encoder.ts:111-117` writes each vector group at `group.speed / 60`, and a program has one speed header. The feed match lives only in `grbl-strategy.ts` (`rotaryFeedMatchFor`). Auditor and refuter **REPRO**, decoding the real Moshi bytes. | **fixed by #1744** (ADR-705 Amd 1; re-measured in Z4). Originally routed to the Moshiboard session (local_d7499c71). Fix direction: split each vector group into programs by matched surface speed (whole mm/s), or refuse a Y-port rotary on Moshi with a message, as A/Z already are; add a decode test |
| Z3-P2-1 | Z3 | **0° Fill hatch rows round the part are never checked against the rotary's steps.** The default 0.1 mm hatch burns 96 of 300 rows twice on an Ø150 bowl and 45 of 300 on Ø120; a 0.05 mm hatch burns 218 of 600 twice on Ø80. An image at the same pitch warns. | **READ** on main: `rotary-row-step-warnings.ts:64` checks only `kind === 'raster'` groups. Auditor and refuter **REPRO** (independent step models). | **fixed by #1745** (ADR-315 Amd 3, ADR-127 Amd 4; re-measured in Z4). Originally routed to the rotary-speed session (local_203c64d8). Fix direction: run the same placement check over scanline Fill groups whose rows run along X, worded as the Fill's Interval |
| Z4-P1-1 | Z4 | **On a tapered tumbler, a Fill at any hatch angle except 90° silently loses most of its burn.** The taper warp bends each hatch line into a polyline of more than 2 points, and the Fill planner drops every line that is not exactly 2 points.<br>• On a Ø90→Ø70 tumbler a 45° Fill covers 0.3 % of its area, a cross-hatch 0.6 %, and a solid 40 mm-wide 0° Fill 7 % (4 % with Current Position front-left). Even an almost-straight Ø76→Ø75 part keeps only 4 % at 45°.<br>• Every G-code dialect and every rotary axis (Y, A, Z) are affected. Moshi, 90° Fills, ramped Fills and Offset Fills are not.<br>• Start and preflight pass, and no warning names it. The Preview shows the whole hatch (preview ≠ output, against ADR-040).<br>• Introduced by #1670 (ADR-694 taper warp). The 2-point rule dates from ADR-034 (June 2026), and #1670's own test has no Fill case.<br>• The taper is opt-in and no preset turns it on. METHOD has no reach clause. | **READ** on main `dcca5b8c4`: `fill-sweeps.ts:52` skips any `seg.polyline.length !== 2`; `rotary-taper-warp.ts:163-172` (`pushSplitEdge`) splits every edge except a vertical one, which is why 90° survives. Auditor and refuter **REPRO** through `prepareStartJob`, with independent readers and coverage models. | routed to the taper session (local_6f397e18). Fix direction: keep warped hatch lines as Fill runs (plan and emit polylines), make the Preview read the warped job, and add a check that each Fill's burned length matches what was compiled |
| Z4-P3-1 (P2, refuter) | Z4 | **The turn-back after Abort waits for the jog feed, not the rotary axis's own rate.** At `$113` = 500°/min, every correct turn-back over about 85° is reported as "did not finish… Check the part", and the Frame offer is refused. Job Review's own advice for a slow A axis is to slow the layer, which keeps that slow axis. This is the same symptom as Z2-P2-1, left over after #1742. | **READ** on main: `abort-rotary-turn.ts:108-121` times the wait as |turn| ÷ `clampJogFeed(1500, maxFeed)` × 1.5 + 5 s; `$112`/`$113` are parsed but not used there. Auditor **REPRO** and refuter motion model. | routed to the rotary-axis session (local_cf75e975). Fix direction: time the wait at min(jog feed, the axis's `$11x` rate), or wait for Run and then Idle |
| Z4-P2-1 (refuter) | Z4 | **A Moshiboard Y-chuck rotary rounds Fill and Image rows to whole mils of machine Y.** On a 40 mm/turn chuck with an Ø80 glass, 200 rows at 0.1 mm land on 126 distinct mils, 0.160 mm apart, and 74 rows burn twice. There is no advisory, because the Moshi route has no Job Review. It is the Moshi twin of Z3-P2-1, which #1745 fixed for G-code only. | **READ** on main: `emit-moshi.ts` runs only the Moshi preflight and encoder notes; the rotary row check (`rotary-row-step-warnings.ts`) runs only on the G-code Job Review path. Refuter **REPRO** (real `emitPreparedMoshiJob` + `decodeMoshiProgram`). | routed to the Moshiboard session (local_d7499c71). Fix direction: run the ADR-315 row check with a one-mil step and add its sentence to the Moshi advisories, or snap the interval to whole mils on the part |

### P3s (8)

- **Z2-P3-1:** on A/Z, the Restore tooltip and the Frame offer's OK line still say nothing moves; the offer can say it can't read the A axis and then turn the part 221.5°; a routing comment is out of date.
- **Z2-P3-3 (refuter):** after ABORT JOB on A/Z, Job Review's recovery for the interrupted job is a self-contradicting dead end. Its Start is refused with "ABORT JOB keeps the turn", and its "Restore saved origin" puts back X/Y only, while the warning tells the operator to use it. Nothing burns in the wrong place.
- **Z3-P3-1:** the A1 Pro's one-step row advice (0.0784 mm) doubles 1–2 rows at about half the places a photo can sit, silently; the two-step advice is clean.
- **Z3-P3-2:** at a layer speed equal to Max feed, a 0° Fill on a taper warns "up to 100 %" (measured 100.0 %); the axis-rate warning has the same pattern.
- **Z3-P3-3:** the old-project rotary notice fires on 1.0.30 projects whose output is byte-identical.
- **Z3-P3-4:** the row-step warning prints the internal layer id and calls a ramped Fill an image.
- **Z1-P3-1:** a picture worker that cannot load ends the timelapse silently, making a new worker and fetching a new 4K frame every 250 ms.
- **Z1-P3-2:** an EXIF-rotated JPEG is refused as the wrong size. The fix is to swap the header's width and height for orientations 5–8; `imageOrientation: 'none'` does not work in Chrome 156.

Proposed sweeps:
- camera robustness: Z1-P3-1, Z1-P3-2, and Y4-P3-1 to Y4-P3-3, which are still open;
- rotary wording and recovery: Z2-P3-1, Z2-P3-3. The rotary-axis session may fold these into its Z2 fix, since they touch the same files.
- rotary feed warnings: Z3-P3-1 to Z3-P3-4. The rotary-speed session may fold these into its Z3-P2-1 fix, since they touch the same files.

### KNOWN (33)

Z4 (status of every Z1–Z3 item after its fix):
- **Fixed and re-measured:** Z2-P1-1 (a restart refuses the turn-back and Start from line, with the hand-turn message; within one session the re-entry is 0.0000 mm), Z2-P2-1 at the jog feed (the slow-axis rest is Z4-P3-1), Z3-P1-1 (a ramped Fill on a rotary scans along X), Z3-P1-2 (Moshi strokes burn at 97.7–100 %), Z3-P2-1 and Z3-P3-4.
- **Fixed by reading:** Z1-P1-1, Z1-P2-1, Z1-P2-2 (camera work runs in the picture worker), Z2-P3-2, Z3-P3-1, Z3-P3-2 and Z3-P3-3.
- **Still open, for the P3 sweep:** Z2-P3-3, Z1-P3-1 and Z1-P3-2 (not re-checked). Z2-P3-1 is partly fixed (the Restore tooltip).

Z3:
- Y5-P2-1 is **fixed**: every job Max feed holds back warns (83 of 83); the suggested speed burns at 100.00–100.12 %, confirmed by the refuter's own physics (122.2 % measured where it says 122 %).
- Y5-P1-3 is **fixed** on the Y chuck: v13's case now warns with the exact count (136 of 382), and every suggested interval lands evenly at every phase. The A1 Pro leftover is Z3-P3-1.
- Y5-P2-2 is **fixed**: the 1.0.29 golden and the scaled 1.0.30 goldens open with the right factor (6.28× and 1.96×). The over-notice is Z3-P3-3.
- The inspector's cylinder drawing (ADR-694/695) and Ruida `.rd` keeping one speed per layer on a rotary (ADR-127 Amd 2, out of scope; the Ruida UDP route inherits it) stay announced.

Z2:
- Y5-P1-1 is **fixed within one controller session**: re-run after Abort 0.00 mm off on A, Z, FluidNC and GRBL (v13 measured 66–84 mm). It is still wrong after a power-up; that is Z2-P1-1.
- Y5-P1-2 is **fixed**: Start from line re-enters at 0.00 mm, and lost-link recovery and restart are refused with a clear message.
- Y5-P1-4 is **fixed** where the settings (`$$`) were read: the right axis, setting and unit are named, and the suggested speed burns at 100 %. KerfDesk reads the settings at every connect; FluidNC's rate is announced as not read.
- Y5-P3-1 and Y5-P3-2 are **fixed**.

Z1:

- Y4-P1-1 and Y4-P2-1 are **fixed and hold** (#1695).
- Y4-P1-2 is **partly fixed** (#1691): one upload per picture, but the shrink stays on the UI thread. That is Z1-P1-1.
- Y4-P3-1, Y4-P3-2 and Y4-P3-3 are still open.

### Not verified

- The ADR-354 worker streaming route with a real port.
- KerfDesk Desktop itself (only the bare Electron runtime).
- Real cameras and phones, and other CPUs and GPUs.
- Any soak (Z1).
- Whether grblHAL and FluidNC keep the A count through the Abort's reset, and which boards reset when their USB port reopens (Z2).
- Steps lost when a reset stops a moving rotary (Z2).
- Start with a trusted work offset, the Frame permit path and the camera latch for Z3-P1-1; Moshi hardware timing (Z3).
- Z4: the camera job watch during a rotary job, Abort latency and lit stops, and the worker streaming route (no browser run; memory stayed under 1 GB). A real A1 Pro or any real rotary. grblHAL's shipped A-axis default rate.

## Round result (2026-11-11)

**Totals:** 20 raised, 0 refuted, P1 5, P2 7, P3 8, 33 KNOWN.

**v13 fixes verified.**
- Camera: #1695 held. #1691 was only partly fixed (Z1-P1-1) and is now fixed by #1740.
- Rotary: #1697 and #1698 held within one controller session. Their gaps (Z2, Z3) are fixed by #1742, #1743, #1744 and #1745.

**Pattern.** Nearly every new defect was a route that skips a rule kept elsewhere:
- Moshi and the rotary feed;
- a ramped Fill and the rotary scan rule;
- the turn-back and the axis rate;
- the taper warp and the Fill planner.
The fixes that hid these passed tests whose fakes were too kind: a simulator jog that finishes in 400 ms, and a guard run at a small window. Code quality audit C2 now hunts that shape on purpose ([../2026-11-11-code-quality-c2/AREAS.md](../2026-11-11-code-quality-c2/AREAS.md)).

**Rotary status for the maintainer's goal ("put in a round glass and burn perfect while it rotates").**
- **Straight glass: perfect** on GRBL with a Y chuck, grblHAL on A, the A1 Pro preset on A (model only; no real A1 Pro), FluidNC on A and stock GRBL on Z.
  - Text lands within 0.003 mm, and a full wrap closes at exactly 360.000°.
  - Lines, Fills at 0° and 45°, ramped Fills and dithered photos all burn at 100.0–100.5 % dose.
  - An Abort and re-run in the same session is exact. After a power cycle the turn-back is refused, with a hand-turn message.
  - Save, reopen and autosave recovery give byte-identical output.
- **Tapered tumbler: not yet.** A Fill at any angle except 90° loses most of its burn (Z4-P1-1). Text, photos, ramped Fills, 90° Fills and Offset Fills are fine.
- **Moshiboard rotary:** stroke dose is right, but rows are rounded to whole mils (Z4-P2-1).
- **Slow rotary axes** (`$113` near 500°/min): a correct long turn-back is reported as failed (Z4-P3-1).

**Open fix routes:**
- Z4-P1-1 → the taper session (local_6f397e18);
- Z4-P3-1 → the rotary-axis session (local_cf75e975);
- Z4-P2-1 → the Moshiboard session (local_d7499c71).

**P3 sweep:**
- camera robustness: Z1-P3-1, Z1-P3-2, Y4-P3-1 to Y4-P3-3;
- rotary recovery wording: Z2-P3-1 rest, Z2-P3-3.
