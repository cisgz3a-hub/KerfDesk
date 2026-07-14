# Machine Setup redesign: pre-implementation audit and plan

**Date:** 2026-07-15
**Baseline:** `origin/main` at `ec39c6433735d817c1790063e906a1b7d445b611`
**Scope:** Machine-profile setup for Laser and CNC projects, including controller selection,
connection, detected settings, local profile state, controller writes, safety/accessory settings,
and verification. Physical motion, switch direction, relay wiring, beam/spindle behavior, and
machine calibration remain operator hardware checks.

## Outcome required

Replace the two competing setup experiences with one beginner-first, step-by-step Machine Setup
flow. The flow must edit a draft, explain what every decision controls, show only operations the
selected controller supports, commit the complete software configuration atomically, and end with
an honest software-verification report plus a separate hardware checklist.

## Current-state audit

### Entry points and ownership

- `DeviceSetupControls.tsx` exposes one **Machine Setup** button, but that button opens the
  seven-tab `MachineSetupDialog` first. A separate **Run guided setup** cross-link then closes it
  and opens `DeviceSetupWizard`.
- `MachineSetupDialog` mutates the live project immediately. `DeviceSetupWizard` edits a draft and
  commits on Finish. Cancel therefore has different meaning depending on which setup surface the
  operator used.
- The active `DeviceProfile` is embedded in the project. File -> New now carries it forward within
  the running session, but the setup-completion marker is a separate localStorage signature.
- CNC machine parameters live in `project.machine`, while the existing Device Setup draft contains
  only `project.device`. The wizard therefore cannot commit one internally consistent CNC setup.

### Beginner-flow defects

1. The flow starts with **Connect & read** before controller/profile selection. A first-time Marlin,
   Smoothieware, FluidNC, or Ruida user begins from the generic GRBL profile, so the first Connect
   can select the wrong driver and baud rate.
2. The copy says values came from `$$` even when disconnected, when no read completed, or when the
   selected controller has no GRBL `$$` settings surface.
3. The CNC path reuses laser-only editors for `$30/$31/$32`, air assist, scan offsets, and
   autofocus. Conversely, it does not draft/commit safe Z, spindle ceiling, spin-up delay,
   coolant, or park position from `CncMachineConfig`.
4. Controller kind, baud rate, output dialect, streaming mode, and RX window affect connection and
   output but have no direct beginner-visible review/edit step.
5. A controller detected after the wizard opens updates advisory state but does not necessarily
   repair the draft's controller/dialect/streaming combination before Finish.
6. The final message says "ready to cut" without a completed physical axis, homing, beam/spindle,
   air/coolant, interlock, or clearance check.

### Wiring and command defects

1. `configureGrblLaserSetup` sends a fixed Neotronics-like batch to any GRBL-dollar controller:
   `$32=1`, `$30=1000`, `$130=400`, `$131=400`, then `$$`. The values are not generated from the
   reviewed draft, and `$130/$131` are machine-critical travel settings.
2. The guarded per-setting path is stronger: it requires Connected + Idle + no active operation, a
   prior read/backup state, value validation, a single write, then a re-read and exact verification.
   Machine Setup should use that path and must not advertise the fixed batch as the way to resolve
   travel differences.
3. FluidNC inherits the GRBL wire protocol but stores real machine configuration in YAML; numeric
   legacy settings are not a safe general setup surface. Its setup must be read-only and direct the
   operator to FluidNC configuration tools.
4. Marlin has queued identity/position/settings commands (`M115`, `M114`, `M503`) and an
   ack-fenced motion settle command (`M400`), not GRBL realtime/status/settings behavior.
5. Smoothieware stores machine configuration on its SD-card configuration file. Its live control
   vocabulary includes `M114`, `M999`, and its own homing semantics; it has no GRBL `$$` editor.
6. Ruida is file-only in this build. A setup flow must never offer Connect, jog, firmware sync, or
   a serial console for it.

### Settings-to-consumer audit

The redesign must keep these relationships visible and tested:

| Setup value | Downstream consumers |
| --- | --- |
| Controller kind + baud | Driver selection, serial open, capabilities, console, home/jog/pause/stop |
| Output dialect | G-code/Ruida strategy and laser-off semantics |
| Streaming mode + RX bytes | Line pacing and controller buffer safety |
| Work area | Canvas, fit/import, bounds preflight, frame limits, CNC stock warnings |
| Origin corner | Coordinate transform, jog direction, placement/orientation |
| Homing choice | Home command availability and default job-placement policy |
| Max feed + frame feed | Layer caps, jog/frame speed, planner and duration estimate |
| Laser S range + laser mode | Power conversion, Start readiness, raster diagnostics |
| Air/coolant command | Manual accessory controls and emitted job preamble/cleanup |
| No-go zones | Start, frame, export, resume, and known-position jog guards |
| Z travel/probe metadata | Z controls and CNC probe/setup affordances |
| CNC safe Z/spindle/spin-up/park | CNC emitter, Start preflight, tool-change and frame behavior |
| Scan offsets/autofocus/rotary/camera | Raster compensation, focus action, rotary output, camera placement |

## Research baseline

- GRBL v1.1 documents `$30/$31/$32`, `$110-$132`, `$$`, `$H`, `$X`, and realtime bytes as
  firmware-specific commands. Machine-critical motion/homing values require hardware knowledge:
  <https://github.com/gnea/grbl/blob/master/doc/markdown/settings.md>
- FluidNC documents that machine configuration is primarily YAML, that only some legacy GRBL
  settings are supported, and that commands are idle-only:
  <https://github.com/bdring/FluidNC/wiki/FluidNC-Commands-and-Settings>
- Marlin documents `M115` firmware identity, `M114` position, `M503` settings report, `M400`
  motion settlement, and `G28` homing as separate capabilities:
  <https://marlinfw.org/meta/gcode/>
- Smoothieware documents configuration-file ownership and its GRBL-to-Smoothie command mapping:
  <https://smoothieware.org/from-grbl>
- LightBurn's manual device wizard chooses controller first, then name/work area, origin/homing,
  and review; it tells users not to enable homing without switches:
  <https://docs.lightburnsoftware.com/legacy/CreateManually>
- Inventables' machine setup separates configuration from physical tests of axis direction,
  spindle control, homing switches, and a calibration carve:
  <https://x-carve-instructions.inventables.com/xcarve2015/step17/>

## Implementation plan

### 1. One setup surface

- Make **Machine Setup** open the guided flow directly.
- Retire the seven-tab-first detour. Maintenance/diagnostic tools that remain relevant must be
  placed in a named step or clearly linked from the unified flow.
- Keep manual launch; never auto-open on application start or connect.

### 2. New step order

1. **Choose machine** — catalog/manual profile, controller family, connection type, baud, output
   dialect, and firmware-specific compatibility correction.
2. **Connect & identify** — use the draft's driver/baud; show detected-vs-selected identity and the
   exact supported read command. File-only profiles skip this step without a fake Connect action.
3. **Work area & movement** — name, bed, origin, homing intent, max feed, frame feed; distinguish
   detected values from manual/catalog values.
4. **Laser output & air** or **Router spindle & clearance** — machine-kind-specific fields only.
5. **Safety & accessories** — no-go zones, powered Z/probe metadata, and relevant optional features.
6. **Controller backup & sync** — read/export first; show a profile-vs-controller diff; allow only
   capability-supported, individually confirmed, verify-by-re-read writes.
7. **Review & save** — validate every software-critical relationship, show the command/output
   contract, commit DeviceProfile + CNC machine parameters together, then present the hardware
   checklist as still outstanding.

### 3. State and persistence rules

- The complete setup is a pure draft until **Save machine setup**.
- Cancel discards all local edits and sends no firmware command. Supported common settings are
  queued in the draft, then written and exactly re-read only after the software setup is saved.
- A save updates bed/workspace, job-placement policy, device profile, and CNC machine parameters in
  one undo entry.
- Existing `.lf2` and `.lfmachine.json` data remains loadable; no destructive schema migration.

### 4. Verification

- Pure reducer tests for machine-kind step order, explicit controller changes, detected-controller
  mismatch/acceptance without silent profile replacement, draft CNC changes, validation, and
  cancel/save semantics.
- Command-contract tests for all six controller families.
- Component tests for controller-first connection, offline/manual setup, file-only Ruida, GRBL
  read/backup/write verification, and machine-kind-specific fields.
- Browser end-to-end test using the real workbench plus serial fixture: choose profile -> connect ->
  inspect `$$` -> apply detected facts -> finish -> assert project-facing UI and emitted serial
  commands.
- Full `pnpm release:check`, E2E typecheck/test, and a post-implementation source/UI audit against
  this document.

## Hardware acceptance boundary

Software completion must not be called hardware-ready. The operator must still verify, on the real
machine and with an accessible physical E-stop/power cut:

1. axis directions and measured travel;
2. limit and homing switch behavior, including safe abort;
3. origin orientation and an air/pen/beam-off frame;
4. laser PWM scale and beam-off-on-travel, or spindle direction/RPM/spin-up;
5. air assist/coolant relay mapping and off cleanup;
6. Z clearance, probe polarity/plate thickness, and plate removal;
7. no-go-zone placement against real clamps/fixtures;
8. one deliberately low-risk test job before production.
