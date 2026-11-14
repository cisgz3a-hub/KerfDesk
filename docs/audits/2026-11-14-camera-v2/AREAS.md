# Camera audit v2 — areas

**Requested by** the maintainer on 2026-11-14. After CNC audit v3 closed ([result](../2026-11-13-cnc-v3/LEDGER.md#p3-sweep-2026-11-14)), they chose "New audit area", then "Camera, full feature set".

**Why.** On 2026-11-09 the maintainer asked for camera tests covering setup and calibration, the RTSP login probe, overlay placement accuracy, camera target engrave, job watch and timelapse, the rotary advice (#1641) and camera logins kept out of saved and shared files (#1649). The rounds since then measured camera threading and the job-watch picture path, not these features:
- [v11 W4](../2026-11-08-rolling-v11/W4-camera.md);
- [v13 Y4](../2026-11-10-rolling-v13/Y4-camera-job-watch.md);
- [v14 Z1](../2026-11-10-rolling-v14/Z1-camera-thread-verify.md).

## Loop

Each area runs once, one agent at a time:
1. an auditor;
2. a fresh refuter with its own method;
3. the coordinator re-checks every P1 and P2 in main's code;
4. a ledger in a docs pull request;
5. every confirmed P1 or P2 gets a fix, through the session that owns the code (or a new one).

Finding IDs are `K<area>-P<n>-<k>`. Severity follows [METHOD.md §3](../2026-10-21-rolling-v2/METHOD.md): P1 harms a job, loses work or exposes a secret, or lets such a defect reach `main` unchecked. There is no reach clause, and a visible result is not a warning. A test gap behind correct code is P2 at most.

**Never call a live camera.** Use local stub RTSP and MJPEG servers, recorded or synthetic frames, and the repo's camera fixtures (`src/core/camera/**/fixtures`, `*-fixtures.ts`, `src/__fixtures__/camera-audit-target.ts`, the Brown "truth camera" model).

## Areas (run in order)

| # | Area id | Scope | Method |
|---|---|---|---|
| K1 | `calibration-and-model` | lens calibration (Brown/fisheye fit, outliers, determined lens), the camera-to-bed model (homography, plane pose, height areas, head camera and stitch), drift, nudge, saved cameras | Synthetic images rendered from a known truth camera; recover the model and measure bed error in mm across the bed, at the edges, at different heights, with noise, blur, partial targets and bad detections; check the accuracy the app reports against the real error |
| K2 | `overlay-placement` | the live overlay (camera transform, view shift, view motion, moved check, refresh with Alt+C), bed image, extrapolation outside the calibrated area | Known artwork placed by the overlay against the truth camera: where it lands in machine mm, at the edges, after the camera moved, after a zoom or crop, and on the rotary (#1641 advice) |
| K3 | `target-trace-and-pieces` | camera target engrave, trace from the camera, pieces and fill blanks, fixture layout, print and cut marks | Each tool's output in machine coordinates against the truth position of the target, mark or piece; registration error, missed or extra pieces, and what the operator is told |
| K4 | `job-watch-and-timelapse` | job watch, timelapse capture and export, frame capture binding, picture quality | Stub MJPEG/RTSP sources with scripted frames, drops and stalls; check that frames are bound to the right job moment, the timelapse is complete and in order, and the job is never slowed or stopped by the camera |
| K5 | `camera-connect-and-privacy` | the address vault and login forms, the RTSP/MJPEG login probe, the Electron frame proxy and bridge routes, camera identity, and #1649 (logins kept out of saved and shared files) | Stub servers with Basic/Digest/form logins and bad TLS; grep saved projects, share bundles, logs, crash reports and phone/MCP payloads for credentials; proxy policy against SSRF-style addresses. **Security findings stay redacted until fixed** |

## Rules

- fresh `git archive` trees with a `node_modules` junction;
- agents report only;
- stub cameras and simulated controllers only;
- no pnpm, no building or packaging, no live services;
- memory gates: Vitest needs at least 1.5 GB free, a browser at least 2 GB;
- security findings stay redacted until fixed, with details only in the coordinator's scratchpad;
- fix PRs use auto-merge with the MERGE method, plus Auto-fix.

**Status:** started 2026-11-14. K1 and K2 ledgered ([LEDGER.md](LEDGER.md)); K3 next.
