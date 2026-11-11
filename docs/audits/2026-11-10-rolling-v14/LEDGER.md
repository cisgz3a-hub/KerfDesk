# Rolling audit v14 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| Z1 | Camera thread verify (#1691, #1695) | origin/main @ 74191e0c7 (auditor and refuter; camera changes since are dead-export clean-ups only). The coordinator re-read 7d28c8e0e. Browser runs with 127.0.0.1 stub cameras and a real-time simulated GRBL that records lit stops; a CDP trace; the same bench in the shipped Electron 44.5.1 runtime | [Z1-camera-thread-verify.md](Z1-camera-thread-verify.md) | 5 | 0 | 1 | 2 | 2 | 6 |
| Z2 | Rotary resume verify (#1697) | origin/main @ 7d28c8e0e (auditor and refuter). The coordinator re-read 236cccf6e, where only #1732 touched these files: it adds a job-kind field, and its automatic Abort restore skips rotary jobs (`abort-auto-restore-eligibility.ts:84`). Node with main's real stop, restore, resume and Job Review code, the real store in the GRBL simulator, an independent rotary controller model, and the stock GRBL source for reset semantics | [Z2-rotary-resume-verify.md](Z2-rotary-resume-verify.md) | 5 | 0 | 1 | 2 | 2 | 5 |
| **Total** | | | | **10** | **0** | **2** | **4** | **4** | **11** |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| Z1-P1-1 | Z1 | **#1691's overlay still shrinks each bridge-camera picture on the UI thread.** Chromium decodes off the thread but scales on the thread that resolves `createImageBitmap`.<br>• A CDP trace shows one 157–243 ms renderer-main task per 4K picture resized to 1,920 px, and 98–166 ms in Electron 44.5.1. The same call in a worker blocks nothing.<br>• In a job on the window route, a 4K RTSP camera held the UI thread 20–31 % of the time, at every window size tried. That includes 1280 × 720, the viewport #1691's own guard runs at.<br>• Lit stops reached 137–259 ms, and an aimed Abort waited 100–130 ms.<br>• A 1080p camera is affected too: 75–81 ms Abort and lit stops up to 137 ms. A maximised full-HD window shrinks a 1,920 px picture by 3 px and pays the whole cost.<br>• No warning names this cause. | **READ** on main `7d28c8e0e`: `machine-frame-feed.ts:100-104` resizes with `createImageBitmap(blob, { resizeWidth, resizeQuality: 'medium' })` in window code. `use-machine-frame.ts:52-55` caps the width at 1,920 = round(CSS width × DPR × 1.5). Auditor and refuter **REPRO**. Main's Browser smoke fails `e2e/camera-overlay-mjpeg-ui-thread.e2e.ts:48`, #1691's own guard. | fix PR #1740 (open; camera session). Originally routed to the camera session (local_3a5a202f). Fix direction: resize in the camera picture worker and transfer the bitmap; skip near-equal resizes; run the guard at 1920 × 1080 during a job |
| Z1-P2-1 | Z1 | **Starting or switching a camera during a job, including opening the Camera panel, still decodes a full frame on the UI thread** for the camera-moved check 3 s later.<br>• 76–141 ms at 4K, with a 71–138 ms lit stop on the window route.<br>• With a saved view reference, `viewThumbnail` reads the whole frame on the UI thread too: 47–119 ms more at 4K, and 152–327 ms at 24 MP.<br>• `autoStart` is on by default, so every panel open during a job does this. | **READ** on main: `install-camera-helpers.ts:116-137` runs `captureSourceFrame(source)` and then `checkCameraMoved` on the window. `frame-source.ts` reaches `decode-jpeg.ts:37-39` (`drawImage` + `getImageData`). Auditor and refuter **REPRO**. | fix PR #1740 (open; camera session). Originally routed to the camera session, as one cluster with Z1-P2-2 |
| Z1-P2-2 (refuter) | Z1 | **Alt+C (Update Overlay) or Refresh picture during a job decodes the full frame on the UI thread and uploads a full-size held still.**<br>• One 251 ms block, then a 131 ms block at 4K.<br>• Abort waits up to 0.25 s, and the window route stopped lit for 148 ms.<br>• With a view reference, the moved check's thumbnail runs on top of that. | **READ** on main: `capture-overlay-still.ts:6,27` uses `captureSourceFrame`, which goes to `decode-jpeg.ts:37-39`; `refresh-picture.ts:13,26` does the same. Refuter **REPRO** (`r-job.json`, key `…-altc`). | fix PR #1740 (open; camera session). Originally routed to the camera session, as one cluster with Z1-P2-1. Fix direction: capture through the picture worker, hold a worker-shrunk `ImageBitmap`, and run the thumbnail in the worker |

| Z2-P1-1 | Z2 | **After a power-up or a reconnect between Abort and the re-run, the saved start turn is still in the old machine count.**<br>• Job Review advises turning the wrong way, Start from line sends `G53 G0 A<stale>`, and on stock GRBL Z, FluidNC and grblHAL with `$384=1` the Frame offer homes and turns the part to the wrong turn while saying it turned it back.<br>• The error is 11–94 mm round an Ø60 part the short way (85.4 mm in the A1 Pro case). The auditor's 68–240 mm counted whole turns, which don't show on a chuck.<br>• On the A1 Pro (`$384=0`, G92 restored at power-up) the Frame offer does not appear; the wrong Job Review advice and Start from line are what it reaches.<br>• The X/Y origin is already guarded against this (ADR-341 Amd 13, `originMachineZeroEpoch`); the rotary turn is not. | **READ** on main `236cccf6e`: `laser-job-stop.ts:482-490` (`rotaryStartTurnAtStop`) returns `{ axis, machine }` with no epoch, beside the X/Y origin that carries `originMachineZeroEpoch`. `resume-rotary.ts:43-47` writes `G53 G0 ${axis}${zero.machine}`. Auditor **REPRO** (simulator and model), refuter **REPRO** with the GRBL source: machine position clears at power-up, not at the Abort's soft reset. | routed to the rotary-axis session (local_cf75e975). Fix direction: stamp the start turn with `machineZeroEpoch` and drop it (with an honest "turn the part to its start by hand" message) when the epoch moved |
| Z2-P2-1 | Z2 | **The turn-back after Abort waits only 3 s for the rotary to stop.** From about 75° on A (or 75 mm of Z at 1,500 mm/min), a correct turn-back is reported as "The rotary did not finish turning back. Check the part.", and the Frame offer then refuses to Frame. The part ends at the right turn. The PR's own simulator finishes every jog in 400 ms, so its test cannot see this. | **READ** on main: `abort-rotary-turn.ts:80-89` jogs at 1,500 mm/min, then `waitForControllerStatus` must see Idle within `STATUS_WAIT_TIMEOUT_MS = 3_000` (`frame-status-wait.ts:13`), or it throws. Auditor and refuter **REPRO** (passes up to 70°, throws at 3.0 s from 75°). | routed to the rotary-axis session. Fix direction: wait for the length of the move (distance ÷ feed plus a margin), or until the status reports Idle after Run |
| Z2-P3-2 (P2, refuter) | Z2 | **On a Z rotary, the first Frame after any turn change is refused as "Controller or machine setup changed during Frame".** That includes aiming the design with the turn buttons, or a job that does not end at turn 0. The Frame's own `G92 Z0` changes Z's work offset. Framing again at the same turn passes, and A is never refused. It comes from #1671 (ADR-695), not #1697. | **READ** on main: `rotary-axis-frame.ts:64-67` puts `G92 Z0` first; `framed-run.ts:413-416` (`sameAxes`) compares the WCO's x, y and **z** before and after the Frame. Auditor and refuter **REPRO**. | routed to the rotary-axis session. Fix direction: leave the rotary axis out of the setup comparison when that axis is the job's rotary output |

### P3s (4)

- **Z2-P3-1:** on A/Z, the Restore tooltip and the Frame offer's OK line still say nothing moves; the offer can say it can't read the A axis and then turn the part 221.5°; a routing comment is out of date.
- **Z2-P3-3 (refuter):** after ABORT JOB on A/Z, Job Review's recovery for the interrupted job is a self-contradicting dead end. Its Start is refused with "ABORT JOB keeps the turn", and its "Restore saved origin" puts back X/Y only, while the warning tells the operator to use it. Nothing burns in the wrong place.
- **Z1-P3-1:** a picture worker that cannot load ends the timelapse silently, making a new worker and fetching a new 4K frame every 250 ms.
- **Z1-P3-2:** an EXIF-rotated JPEG is refused as the wrong size. The fix is to swap the header's width and height for orientations 5–8; `imageOrientation: 'none'` does not work in Chrome 156.

Proposed sweeps:
- camera robustness: Z1-P3-1, Z1-P3-2, and Y4-P3-1 to Y4-P3-3, which are still open;
- rotary wording and recovery: Z2-P3-1, Z2-P3-3. The rotary-axis session may fold these into its Z2 fix, since they touch the same files.

### KNOWN (11)

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
