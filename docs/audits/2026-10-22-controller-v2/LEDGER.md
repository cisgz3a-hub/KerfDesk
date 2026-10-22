# Controller audit v2 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| C1 | Native resume G-code | 99a2e64b7 | [C1-ctl-native-resume.md](C1-ctl-native-resume.md) | 5 | 0 | 0 | 0 | 5 | 5 |
| C2 | Probing and offsets | 99a2e64b7 | [C2-ctl-probing.md](C2-ctl-probing.md) | 5 | 0 (one P3 sub-claim) | 1 | 1 | 3 | 6 |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| C2-P1-1 | probing | During a CNC tool-change hold the XYZ corner probe still runs, sends `G92.1` + `G10 L20 P0 X Y Z`, and Continue resumes the rest of the job in the shifted XY frame with no warning (Set origin is likewise only blocked by its button, not in the store) | **READ**: `laser-probe-policy.ts` `probeStateBlockReason` has no tool-change-hold or probe-kind check; `toolChangeContinueBlockMessage` (`laser-store-helpers.ts`) checks Z evidence only. Auditor + refuter REPRO through the real store (`G1 X6 Y6` after the shift) | fix card proposed |
| C2-P2-1 | probing | Every probe sends `G54` but the store keeps the old active WCS (e.g. G55); the next Frame discards the fresh probe Work-Z, claims the controller "was using G55", and prompts Zero Z with the bit parked above the stock | refuter REPRO on the GRBL simulator; **SOURCE** GRBL `gcode.c`: G54 is modal and `G10 L20 P0` writes the active system | fix card proposed |
