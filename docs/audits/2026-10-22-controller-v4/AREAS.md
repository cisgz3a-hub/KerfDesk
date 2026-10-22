# Controller audit v4: area map

Started 2026-10-22 when the user asked to "continue with loops" while controller audit v3 was finishing.
This round uses the rolling audit v2 method, [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md):

- Every finding needs an anchor.
- An independent refuter checks every finding.
- The coordinator re-checks every P1/P2 in the code.

## Why these areas

Controller v2 covered features such as resume, probing, homing, settings, Console, drivers, profiles and machine UI.

Controller v3 covered the machine besides the head: air, focus, rotary, spindle, zones, detection, the network link and scan offsets.

This round covers **what KerfDesk asks the controller to do with power and with whole programs**:

- the power numbers each dialect receives;
- the first-run setup that shapes every later job;
- the CNC routines KerfDesk generates itself;
- the programs it accepts from elsewhere;
- the test grids and time estimates the operator trusts.

Areas are ordered by physical risk. Two auditors run at a time.

| # | Area id | Risk | Why now |
|---|---|---|---|
| E1 | `ctl-power-mapping` | S | The S value each dialect receives decides the burn. Cases: `$30`/`$31`, M3 vs M4 dynamic power, Marlin inline vs fan PWM, Smoothieware's 0–1 scale, Falcon. Rolling-v2 03 and #1349 covered parts of this; the per-dialect end-to-end mapping was never audited as one table |
| E2 | `ctl-machine-setup-flow` | S | First-run setup decides origin, homing, bed size, dialect, and what is written to the controller. A wrong guess here is inherited by every job |
| E3 | `ctl-cnc-routines` | S | Programs KerfDesk generates for CNC: surfacing, tool-change labels and M6 handling, tiling. Each one runs on the machine as-is |
| E4 | `ctl-external-normalize` | S | Opened programs are normalised before streaming: units, modal baseline, unsupported codes, M30/M2, line length vs the RX buffer, and the controller block check. C6, D4 and D5 found single gaps on this path; this area audits the whole normaliser |
| E5 | `ctl-material-tests` | C | Material and interval test grids are how operators choose power and speed. The labels must match what is burned |
| E6 | `ctl-time-estimate` | C | The Run review's time estimate models the controller's planner (accel, junction deviation, arcs). A large error misleads job planning and recovery decisions |

## Scope

| # | Files |
|---|---|
| E1 | `src/core/output/grbl-power-modes.ts`, `laser-power-scale-version.ts`, `marlin-inline-transform.ts`, `marlin-fan-transform.ts`, `marlin-fan-raster.ts`, `smoothieware-strategy.ts`, `focus-test-power.ts`; `src/core/raster/controller-power-scale.ts`; `src/core/job/object-power-scale.ts`; `src/core/devices/smoothie-power-scale.ts` |
| E2 | `src/ui/laser/device-setup/**`, `src/ui/laser/connect-machine.ts`, `src/ui/app/machine-setup-banner-state.ts`, `src/ui/laser/machine-setup-fill-heat-risk.ts`, `NoHomingPosition*.tsx` |
| E3 | `src/ui/machine/{save-surfacing-program,surfacing-seed,surfacing-save-write}.ts`, `SurfacingPanel.tsx`, `src/core/output/tool-change-labels.ts`, `src/ui/state/tool-change-hold-entry.ts`, `src/ui/machine/CncTilingDisclosure.tsx` and the tiling code it describes |
| E4 | `src/core/external-program/**`, `src/ui/gcode-inspector/external-run.ts` (normalisation and the block check only; the `$32`/`$30` and lit-rapid gaps are D4/D5, fixed in #1390) |
| E5 | `src/core/job/{material-test-grid,material-test-axes,material-test-layout,interval-test-grid}.ts`, `src/ui/calibration/material-test-*.ts` and the dialogs |
| E6 | `src/core/gcode-time/**`, `src/core/motion-planner/**`, and where the estimate is shown (Run review, Job Review, recovery) |

Out of scope: Ruida, for the reasons given in v2 and v3.
