# Rolling audit v11 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

Security findings are listed by class and severity only until their fix merges (AREAS.md, Security).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| W1 | Licensing and Free/Pro gating | origin/main @ 5f09e1110 (refuter 5f09e1110; Node only, memory under every gate) | [W1-licensing-pro-gating.md](W1-licensing-pro-gating.md) | 5 | 1 | 0 | 0 | 4 | 17 |
| W2 | Phone, remote control and MCP | origin/main @ 5f09e1110 (refuter 5f09e1110; Vitest with the real remote adapter and a simulated controller) | [W2-remote-mcp-phone.md](W2-remote-mcp-phone.md) | 5 | 0 | 1 (refuter) | 0 | 4 | 24 |
| **Total so far** | | | | **10** | **1** | **1** | **0** | **8** | **41** |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| W2-P2-1 (P1, refuter) | W2 | **A phone or MCP Resume of a paused CNC job gives none of the PC's spin-up warning.** For a FluidNC router at `$32=0` the PC says the bit is fed through the cut while the spindle is still speeding up and to prefer ABORT JOB; the phone/MCP status offers Resume with no reason or text, Resume sends `~`, the receipt says "Resumed." and the bit, stopped in the kerf, is fed along the cut at cutting speed while the spindle spins up from rest (stalled or broken bit, torn edge, possible lost steps). The Start review has no FluidNC `spinup_ms` line. P1 by effect (meta M3-P3-5) and by J3-P2-3: the only warning is on a PC screen the phone operator does not see; GRBL at `$32=1`/unknown (warned at Start) and GRBL `$32=0` (Pause lifts, firmware waits 4 s) stay P2. FluidNC `spinup_ms` default cited from earlier audits, not re-fetched | **READ** (main): `cncResumeAdvisoryNotice` (`cnc-pause-resume-policy.ts`) is used only by `JobRunControls.tsx` and `LiveMotionBar.tsx`; the remote path `machine-owned-operation.ts:30` (`resume_job`) → `machine-actions.ts`, `machine-execution.ts` never reads it. Refuter REPRO (Vitest, real remote adapter, registry and store, simulated FluidNC banner: `zz-w2r/resume.json`) | fix card proposed |
