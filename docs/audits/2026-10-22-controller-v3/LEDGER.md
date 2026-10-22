# Controller audit v3 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| D1 | Air assist and accessories | 7cd526213 | [D1-ctl-air-accessories.md](D1-ctl-air-accessories.md) | 4 | 0 | 0 | 0 | 4 | 7 |
| D2 | Focus and Z | 7cd526213 | [D2-ctl-focus-z.md](D2-ctl-focus-z.md) | 5 | 0 | 0 | 1 (P3-3 raised) | 4 | 3 |
| D3 | Rotary | 7cd526213 | [D3-ctl-rotary.md](D3-ctl-rotary.md) | 7 | 0 | 0 | 1 | 6 (P2-2 lowered) | 2 |
| D4 | Spindle and machine hours | 7cd526213 | [D4-ctl-spindle-hours.md](D4-ctl-spindle-hours.md) | 8 | 0 | 0 | 2 | 6 | 7 |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| D2-P3-3 (P2) | focus-z | Auto-focus accepts a `G38.2`–`G38.5` probe with no F word and no feed cap (even `F100000` passes): GRBL reuses the last modal feed, so after a 6000 mm/min job the probe drives toward the bed at up to `$112` and overruns contact by ~3.5 mm (vs 0.14 mm at F100) | **READ**: `autofocus-command.ts:139-146` `probeIssue` makes F optional and only checks `F > 0`; KerfDesk's own probes always write F. **SOURCE**: gnea/grbl `gcode.c:418-421` (no F → last feed; `error:22` only if none since reset), `planner.c:389`, `probe.c:64`. Refuter REPRO (a fill job ends `F6000`, next probe inherits it) | fix card proposed |
| D3-P2-1 | rotary | A roller rotary with "Scale Y from the roller diameter" off (the default for every new roller) emits Y at scale 1, so a stock roller burns at the motor's travel, not the surface's (refuter: 40 mm/turn, 25 mm roller → a 20 mm design burns 39.27 mm); when Test rotation misses, it says "adjust the measurements", the operator tunes the object diameter (which a roller's scale ignores), the test then passes and the wrap preview and Job Review agree, hiding the wrong size | **READ**: `rotary.ts:60-67` `rotaryYScale` returns 1 when `rollerDiameterMm === undefined`; `RotaryTestRotationPanel.tsx:107` hint. **SOURCE**: LightBurn Rotary Mode G-code page (roller: object diameter "does not affect output"). Auditor + refuter REPRO | fix card proposed |
| D4-P2-1 | spindle-hours | A CNC-mode "Run G-code file" never checks `$32` (laser mode) or `$30`: a router left at `$32=1` runs a CAM post's `M3 S18000` / `G4` spin-up with the spindle off (GRBL laser mode zeroes S on G0) and starts every G1 plunge from rest; the only prompt is workholding, while project Start on the same state flags `laser-mode-enabled` and `spindle-scale-mismatch` | **READ**: `external-run.ts:218` calls `confirmLaserModeStartEvidence`, which returns `undefined` for any non-laser machine (`laser-mode-start-acknowledgement.ts:32`). **SOURCE**: GRBL v1.1 Laser Mode wiki, gnea `gcode.c`/`spindle_control.c`. Auditor + refuter store REPRO | open |
| D4-P2-2 | spindle-hours | On FluidNC a CNC Pause sends the safety-door byte `0x84` (spindle stops) with no Pause-and-lift (qualified for GRBL/grblHAL only), and Resume restores the spindle after only `spinup_ms`, default 0, so the bit restarts the cut while spinning up; the Resume advice promises "a fixed spin-up delay (4 s in stock GRBL)" | **READ**: `cnc-pause-resume-policy.ts:10-13` advisory text; Pause-and-lift qualification excludes FluidNC. **SOURCE**: FluidNC `Spindle.h` (`spinup_ms` default 0), `Parking.cpp` restore, `RealtimeCmd.cpp`. Refuter: a feed hold would keep the spindle on, but KerfDesk sends the door; a Modbus VFD with at-speed feedback is unaffected | open |
