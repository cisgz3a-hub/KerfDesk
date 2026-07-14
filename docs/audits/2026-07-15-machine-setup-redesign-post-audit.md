# Machine Setup redesign: post-implementation audit

**Date:** 2026-07-15
**Branch:** `codex/machine-setup-redesign`
**Pre-audit:** `docs/audits/2026-07-15-machine-setup-redesign-audit-plan.md`
**Scope boundary:** software behavior is verified here. Physical motion, switch direction, relay
wiring, beam/spindle behavior, interlocks, clearances, and calibration still require the operator's
hardware commissioning check.

## Verdict

The pre-audit requirements are implemented with no known blocking software defect. Machine Setup is
now one controller-first, seven-step workflow for both Laser and CNC. It edits one local
`DeviceProfile` + `MachineConfig` draft, commits the software configuration atomically, and treats
controller firmware changes as separately queued, guarded operations that run only after final
Save. The UI ends with an explicit hardware handoff and never claims that the physical machine is
ready to cut.

The audit found and corrected seven integration defects during implementation:

1. CNC presets initially appeared after the work-area step. They now seed bed size and spindle
   ceiling on step 1, before the operator reviews coordinates.
2. Replacing a CNC setup could lose app-level custom tools, and saving Laser could lose the hidden
   CNC draft. The atomic store action now merges custom tools and retains the CNC cache in both
   directions, with regression tests.
3. Ruida initially inherited irrelevant serial fields. File-only controllers now hide baud,
   dialect, and streaming controls and never offer Connect or firmware sync.
4. A first version wrote a confirmed GRBL setting on the firmware step, which made Cancel
   misleading. Firmware selections are now draft-only; Cancel sends no command, and final Save
   performs software commit -> guarded single write -> settings re-read -> numeric equality check.
5. An intermediate implementation let detected controller identity repair the draft automatically.
   Current `main` correctly made the user-selected profile authoritative, so the final reducer keeps
   identity/readback separate, surfaces mismatch, and changes controller or copies numeric values
   only after an explicit operator action. Accepted CNC `$30` updates spindle RPM, not laser power.
6. A queued write could outlive a later draft edit and silently reuse an old confirmation for a new
   value. Any profile, machine, preset, detected-readback, or controller change now invalidates the
   backup attestation and clears the queue.
7. The full repository accessibility contract found 25 new raw controls without hover
   explanations. Every input, selector, and expandable section now has a stable explanatory title;
   the contract passes.

## Requirement audit

| Requirement | Implementation evidence | Result |
| --- | --- | --- |
| One beginner-facing surface | `DeviceSetupControls.tsx` opens `DeviceSetupWizard`; the legacy `MachineSetupDialog` is a compatibility wrapper around the same wizard | Pass |
| Controller before connection | Step 1 selects machine kind, controller, transport fields, catalog/import data, and CNC preset; step 2 opens the selected driver and baud | Pass |
| User-selected profile authority | Detected identity/readback remains observational until explicit controller selection or **Use detected values**; catalog/import profiles are applied exactly | Pass |
| Honest controller vocabulary | `machine-setup-controller-guide.ts` defines transport, identity/read, status, home, configuration surface, streaming, CNC support, and write policy for all six families | Pass |
| Laser/CNC relevance | `DeviceSetupMachineStep.tsx` routes to laser power/air/Fire or CNC Safe Z/spindle/dwell/coolant/park; laser-only optional features are hidden from CNC | Pass |
| Complete atomic save | `replaceMachineSetup` updates profile, workspace, machine config, job placement, CNC cache, spindle-ceiling effects, undo/redo, and dirty state in one store update | Pass |
| Cancel semantics | All software edits and firmware selections live in reducer state until Save; Cancel is disabled only while Save/write verification is active and otherwise sends no command | Pass |
| Firmware safety | GRBL/grblHAL permit only individually confirmed `common` settings after read + backup attestation; `$130/$131` are review-only; all other families route to native tools | Pass |
| Exact post-write verification | `writeGrblSetting` rechecks Connected/Idle/no active operation, writes one value, re-reads the settings dump, and accepts only the same numeric value | Pass |
| Responsive beginner navigation | A named stepper, step count, Back/Next, specific validation, and a 640px responsive layout keep the whole flow navigable without hidden steps | Pass |
| Honest completion boundary | Review says software is internally consistent, lists every queued command, and provides a separate Laser/CNC hardware checklist | Pass |

## Controller command and configuration audit

| Family | In-app read contract | Configuration/write contract | Result |
| --- | --- | --- | --- |
| GRBL 1.1 | `$I`, `$$`; driver-provided status and `$H` | Guarded single common `$` setting only; backup, confirmation, Idle, no operation, re-read required | Pass |
| grblHAL | `$I`, `$$`; driver-provided status and `$H` | Same guarded common-setting path; plugin/board-specific configuration remains external | Pass |
| FluidNC | `$I`, `$CD`, `$$` for reference | `config.yaml` / WebUI; no numeric setup writes from Machine Setup | Pass |
| Marlin | `M115`, `M503`, `M114`, `M400` | Read-only in KerfDesk; use Marlin configuration/EEPROM workflow | Pass |
| Smoothieware | `version`, `M114` | SD-card configuration file; no GRBL settings editor | Pass |
| Ruida | None in this build | File export plus controller panel/vendor software; no serial UI | Pass |

The controller guide is checked against each real `ControllerDriver`, so displayed home, status,
transport, default baud, buffered/ack-fenced streaming behavior, and CNC capability cannot silently
diverge from runtime selection.

## Settings-to-consumer audit

| Setup value | Verified consumers |
| --- | --- |
| Controller + baud | connection options, active driver, capability gates, read commands, console and motion controls |
| Dialect + streaming/RX window | emitter strategy, laser-off behavior, stream pacing and receive-window safety |
| Bed + origin + homing | workspace/canvas, import/bounds/frame checks, coordinate transform, job placement and Home availability |
| Max/frame feed | layer/feed limits, jog/frame speed, planning and duration estimates |
| Laser power/laser mode | S conversion, start readiness, raster diagnostics, guarded `$30/$31/$32` comparison |
| Air/coolant | manual accessory behavior and job preamble/cleanup |
| No-go zones | start, frame, export, resume and known-position motion guards |
| Z/probe metadata | Z affordances and supervised probe setup |
| CNC Safe Z/spindle/dwell/park | CNC emitter, preflight, tool-change, framing and spindle-ceiling clamp |
| Scan/autofocus/rotary/camera | raster compensation, focus controls, rotary output and camera placement status |

## Verification evidence

- Static: `pnpm typecheck`, `pnpm typecheck:e2e`, and `pnpm lint` pass.
- Focused unit/integration: 12 files, 70 tests pass. Coverage includes reducer transitions,
  controller contracts, laser/CNC rendering and save, atomic store behavior, and retirement of the
  fixed GRBL batch.
- Browser E2E: 9/9 tests pass in a clean single-worker run. The Machine Setup journeys cover Laser,
  CNC, 640px navigation, reconnect/read behavior, draft persistence, and reopening saved values.
- Controller fixture E2E proves `$I` and `$$` are sent before edits, `$30=900` is absent while merely
  queued, and final Save sends `$30=900`, re-reads `$$`, verifies the returned value, then reopens
  with the saved profile.
- Manual UI audit: all seven steps were reviewed at 1024px and 640px; the hardware handoff remained
  reachable and no browser console warning or error was present.
- Repository gate: `pnpm release:check` passed in 571 seconds on the implementation rebased onto
  current `origin/main`. The gate covered the full test suite, formatting, static analysis, both
  linters, licenses, dependency audit with no known vulnerabilities, file-size policy, public-export
  ratchet, and both web and Electron builds.

One first full-browser launch returned Windows `spawn UNKNOWN`, and one subsequent worker process
exited before its first test. No assertion had run. The failed test passed by itself, and the next
complete single-worker suite passed 9/9; this is recorded as host process instability rather than a
product failure.

## Retired and retained surfaces

- The fixed `$32=1`, `$30=1000`, `$130=400`, `$131=400` batch has no executable UI. Its compatibility
  store action is intentionally inert and tested to reject without transmitting any bytes.
- `GrblLaserSetupPanel` is a non-interactive compatibility notice directing the operator to Machine
  Setup.
- Existing `.lf2` and `.lfmachine.json` inputs remain loadable. The redesign changes workflow and
  state coordination, not persisted schema.
- Material, stock dimensions, and bit selection remain job-specific in Material & Bit rather than
  becoming misleading machine defaults.

## Hardware acceptance still required

The operator must keep a physical E-stop or disconnect accessible and verify, on the real machine:

1. axis labels, positive direction, and measured travel;
2. limit switches, homing direction, and safe abort behavior;
3. origin orientation and a beam-off/pen/air frame clear of clamps and fixtures;
4. laser S scale and beam-off travel, or spindle direction/RPM/spin-up;
5. air-assist or coolant relay mapping and off cleanup;
6. Safe Z, probe polarity, plate thickness, and plate removal where fitted;
7. no-go zones against real clamps/fixtures; and
8. one deliberately low-risk scrap/air test before production.

Software Save does not home, jog, probe, energize a laser/spindle/relay, or prove any item above.

## Research references

- GRBL settings and command behavior: <https://github.com/gnea/grbl/blob/master/doc/markdown/settings.md>
- GRBL system commands: <https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md>
- FluidNC commands and YAML ownership: <https://github.com/bdring/FluidNC/wiki/FluidNC-Commands-and-Settings>
- Marlin G-code and configuration/EEPROM model: <https://marlinfw.org/meta/gcode/>,
  <https://marlinfw.org/docs/configuration/configuration.html>,
  <https://marlinfw.org/docs/features/eeprom.html>
- Smoothieware configuration and command mapping: <https://smoothieware.org/basics.html>,
  <https://smoothieware.org/from-grbl>
- grblHAL core/controller model: <https://github.com/grblHAL/core>
- LightBurn manual setup/origin/Ruida guidance: <https://docs.lightburnsoftware.com/legacy/CreateManually>,
  <https://docs.lightburnsoftware.com/2.0/GetStarted/CoordinatesOriginBeginner/>,
  <https://docs.lightburnsoftware.com/legacy/ConfiguringRuida>
- Inventables physical commissioning sequence: <https://x-carve-instructions.inventables.com/xcarve2015/step17/>
