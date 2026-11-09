# Rolling audit v12 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| X1 | Fix: job safety (#1615, #1616, #1620, #1628, #1612) | origin/main @ 743d37bc4 (refuter 743d37bc4; Vitest with the simulated GRBL, Node with the real main-process modules, Chrome 156 for V1-P1-1) | [X1-fix-job-safety.md](X1-fix-job-safety.md) | 3 | 0 | 1 | 1 | 1 | 1 |
| **Total so far** | | | | **3** | **0** | **1** | **1** | **1** | **1** |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| X1-P1-1 | X1 | **After a controller hard-reset, Frame still offers to restore the aborted job's origin, and the re-run burns off-position with no warning.** #1620's offer matches the stop request on the job counter only, so it survives a power cycle or a USB auto-reset that re-zeroes machine position on a machine without homing. In the refuter's repro the controller session went 4 → 7 and machine position jumped from (35, 15) to (0, 0) with no motion sent; no notice appeared; Frame said "The job you stopped ran from X 35, Y 15", OK wrote `G54 G21 G92 X-35.000 Y-15.000`, and the toasts "Origin restored" and "Frame complete" confirmed it; the re-run landed (+35, +15) mm off (auditor: (+20, +68) mm after a reconnect). The interrupted job's own Review already warns "home the machine if it was reset". Same class as V3-P2-2 (P1) | **READ** (main): `unrestored-abort-origin.ts:29-35` (`currentJobStopRequest` only), `job-stop-request.ts:32-38` (matches `streamerEpoch` only; `positionMayBeLost` not consulted; nothing clears the request on a reset). Auditor and refuter REPRO (Vitest, simulated GRBL: `zz-x1r/vt-powercycle.txt`) | routed to the #1620 session |
| X1-P2-1 | X1 | **If the renderer dies while KerfDesk is closing, main's network stop waits behind the close guard's blocking box until the operator answers.** #1628 meant the stop to go first; during a close the "App controls unavailable" box runs first and the reset waits (3,002 ms in the auditor's run against 13 ms without a close). The wait has no time limit, but the box opens within 1 ms, says Software Abort cannot be confirmed and names the E-stop (conditionally: "if the machine may be unsafe"), and one Enter ends it. P2 | Auditor and refuter REPRO (Node, real close guard and crash recovery in `main.ts` order: `zz-x1r/order-out.txt`) | routed to the #1628 session |
