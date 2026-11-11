# Rolling audit v14 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| Z1 | Camera thread verify (#1691, #1695) | origin/main @ 74191e0c7 (auditor and refuter; camera changes since are dead-export clean-ups only). The coordinator re-read 7d28c8e0e. Browser runs with 127.0.0.1 stub cameras and a real-time simulated GRBL that records lit stops; a CDP trace; the same bench in the shipped Electron 44.5.1 runtime | [Z1-camera-thread-verify.md](Z1-camera-thread-verify.md) | 5 | 0 | 1 | 2 | 2 | 6 |
| **Total** | | | | **5** | **0** | **1** | **2** | **2** | **6** |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| Z1-P1-1 | Z1 | **#1691's overlay still shrinks each bridge-camera picture on the UI thread.** Chromium decodes off the thread but scales on the thread that resolves `createImageBitmap`.<br>• A CDP trace shows one 157–243 ms renderer-main task per 4K picture resized to 1,920 px, and 98–166 ms in Electron 44.5.1. The same call in a worker blocks nothing.<br>• In a job on the window route, a 4K RTSP camera held the UI thread 20–31 % of the time, at every window size tried. That includes 1280 × 720, the viewport #1691's own guard runs at.<br>• Lit stops reached 137–259 ms, and an aimed Abort waited 100–130 ms.<br>• A 1080p camera is affected too: 75–81 ms Abort and lit stops up to 137 ms. A maximised full-HD window shrinks a 1,920 px picture by 3 px and pays the whole cost.<br>• No warning names this cause. | **READ** on main `7d28c8e0e`: `machine-frame-feed.ts:100-104` resizes with `createImageBitmap(blob, { resizeWidth, resizeQuality: 'medium' })` in window code. `use-machine-frame.ts:52-55` caps the width at 1,920 = round(CSS width × DPR × 1.5). Auditor and refuter **REPRO**. Main's Browser smoke fails `e2e/camera-overlay-mjpeg-ui-thread.e2e.ts:48`, #1691's own guard. | routed to the camera session (local_3a5a202f). Fix direction: resize in the camera picture worker and transfer the bitmap; skip near-equal resizes; run the guard at 1920 × 1080 during a job |
| Z1-P2-1 | Z1 | **Starting or switching a camera during a job, including opening the Camera panel, still decodes a full frame on the UI thread** for the camera-moved check 3 s later.<br>• 76–141 ms at 4K, with a 71–138 ms lit stop on the window route.<br>• With a saved view reference, `viewThumbnail` reads the whole frame on the UI thread too: 47–119 ms more at 4K, and 152–327 ms at 24 MP.<br>• `autoStart` is on by default, so every panel open during a job does this. | **READ** on main: `install-camera-helpers.ts:116-137` runs `captureSourceFrame(source)` and then `checkCameraMoved` on the window. `frame-source.ts` reaches `decode-jpeg.ts:37-39` (`drawImage` + `getImageData`). Auditor and refuter **REPRO**. | routed to the camera session, as one cluster with Z1-P2-2 |
| Z1-P2-2 (refuter) | Z1 | **Alt+C (Update Overlay) or Refresh picture during a job decodes the full frame on the UI thread and uploads a full-size held still.**<br>• One 251 ms block, then a 131 ms block at 4K.<br>• Abort waits up to 0.25 s, and the window route stopped lit for 148 ms.<br>• With a view reference, the moved check's thumbnail runs on top of that. | **READ** on main: `capture-overlay-still.ts:6,27` uses `captureSourceFrame`, which goes to `decode-jpeg.ts:37-39`; `refresh-picture.ts:13,26` does the same. Refuter **REPRO** (`r-job.json`, key `…-altc`). | routed to the camera session, as one cluster with Z1-P2-1. Fix direction: capture through the picture worker, hold a worker-shrunk `ImageBitmap`, and run the thumbnail in the worker |

### P3s (2)

- **Z1-P3-1:** a picture worker that cannot load ends the timelapse silently, making a new worker and fetching a new 4K frame every 250 ms.
- **Z1-P3-2:** an EXIF-rotated JPEG is refused as the wrong size. The fix is to swap the header's width and height for orientations 5–8; `imageOrientation: 'none'` does not work in Chrome 156.

Proposed sweep: camera robustness, with Y4-P3-1 to Y4-P3-3, which are still open.

### KNOWN (6)

- Y4-P1-1 and Y4-P2-1 are **fixed and hold** (#1695).
- Y4-P1-2 is **partly fixed** (#1691): one upload per picture, but the shrink stays on the UI thread. That is Z1-P1-1.
- Y4-P3-1, Y4-P3-2 and Y4-P3-3 are still open.

### Not verified

- The ADR-354 worker streaming route with a real port.
- KerfDesk Desktop itself (only the bare Electron runtime).
- Real cameras and phones, and other CPUs and GPUs.
- Any soak.
