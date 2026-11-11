# Rolling audit v13: camera tests and rotary fix verification

**Requested by** the maintainer:
- On 2026-11-09 they asked to "add camera tests in the next loop".
- On 2026-11-10, when rolling v12 closed, they chose "Camera + rotary verify".

**Scope.** Two parts:
- **Camera.** The camera code as a whole: 229 non-test files in `src/core/camera`, `src/ui/camera`, `src/ui/state` and `electron`. It was last audited in v11 W4 and v5 J5. #1546 left 7 architecture items open. #1641 (rotary advice) and #1649 (camera logins never saved or shared, ADR-692) merged on 2026-11-09 and have not been re-audited.
- **Rotary.** The fixes v12 X8 asked for: the surface feed, the A/Z axis, taper warp and chuck raster banding. That area runs last, once the rotary PRs merge.

Finding IDs are `Y<area>-P<n>-<k>`.

**Cameras are always stubs.** No area may open a live camera or the maintainer's network:
- use local RTSP/MJPEG/HTTP stub servers, recorded frames, synthetic calibration targets and the repo's camera fixtures;
- never call ffmpeg against a real address;
- a phone camera is simulated through the same local stub.

## Method

[rolling-v2 METHOD.md](../2026-10-21-rolling-v2/METHOD.md) applies in full: §3 with its clarifications, and §4. Each area gets an auditor, then a fresh refuter, then the coordinator re-verifies every P1/P2 in main's code.

Lenses:
- **Camera areas:** L1–L7, plus L9 (entry-point parity).
- **Measurements:** placement accuracy is a measurement. Report the error in mm against a known target, not "looks right".
- **Rotary area:** L10 (fix verification) and L12 (untested merges).

## Areas (run order)

| # | Area id | What it covers | Lenses |
|---|---|---|---|
| Y1 | `camera-setup-calibration` | The setup wizard and the everyday panel (ADR-663); lens and perspective calibration, the accuracy map (ADR-441 Amd 1), several cameras per machine (ADR-446), the head camera (ADR-449) and the phone as the overhead camera (ADR-448); recalibration after a camera move (ADR-663 Amd 3) | L1, L2, L3, L6 |
| Y2 | `camera-connection-login` | USB, RTSP, MJPEG and HTTP sources, the RTSP login probe (#1546), ffmpeg by full path (ADR-551), the bridge and addresses (ADR-141 Amd 2); logins never reach a saved or shared file (ADR-692, #1649), on every save and share route | L5, L6, L9; security findings stay redacted until fixed |
| Y3 | `camera-placement-burn` | Overlay placement accuracy measured in mm on synthetic targets; camera target engrave; print and cut (ADR-443); start-from (ADR-228 Amd 1); camera rings (ADR-440 Amd 7); the camera-moved warning; camera on a rotary (ADR-228 Amd 2, #1641) | L1, L3, L4, L9 |
| Y4 | `camera-job-watch` | Watching a job (ADR-490), timelapse and recordings, storage limits, failure while a job runs (the camera drops, the disk fills), privacy of recordings | L2, L5, L6 |
| Y5 | `rotary-fix-verify` | The v12 X8 fix PRs once merged: the per-move surface feed (X8-P1-1), the A/Z axis and A1 Pro preset (X8-P2-1), chuck raster rows on the step grid (X8-P2-3), taper warp (X8-P2-2), presets, jog in degrees, and the X8 P3 wording; then a whole round-glass journey on simulated GRBL, grblHAL (A axis) and Marlin, including camera placement on the rotary | L10, L12, L3 |

Y2 runs right after Y1, because it is a trust boundary. Y5 waits until the rotary PRs from the sessions `rotary-speed`, `rotary-axis` and `rotary-taper` have merged.

## Overlap with other work

Treat these as KNOWN:
- the v12 findings, and its open fix work: #1664 and the three rotary sessions;
- open PRs #1623 and #1626, and another agent's pro-loop audits in `docs/audits/2026-11-08-pro-loop-v1` to `-v3`;
- the update-button feature session.

## Batching and rules

**Agents and repro trees**
- One audit agent at a time.
- Repros run on a scratchpad export of main whose `node_modules` is a junction. Never delete it recursively.
- Browser runs use a Vite alias for `fflate` and the cached Chrome for Testing build.
- Never run `pnpm`, and never download anything.

**Memory gates**
- Vitest needs 1.5 GB or more free.
- A browser needs 2 GB or more free, runs headless, uses one worker and runs one spec.

**Safety**
- Never operate hardware; use simulated controllers only.
- Never launch the installed KerfDesk.
- Never call a live external service.
- Never open a real camera.

**Findings and fixes**
- Security findings are redacted in committed text until fixed.
- Fix PRs use Auto-fix and auto-merge with the MERGE method.

**Status:** DONE 2026-11-10: 33 raised, 0 refuted, P1 12, P2 6, P3 15, 53 KNOWN. See the round result in [LEDGER.md](LEDGER.md).
