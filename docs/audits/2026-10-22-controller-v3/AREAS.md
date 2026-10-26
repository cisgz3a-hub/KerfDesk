# Controller audit v3 — area map

Started 2026-10-22 when the user asked to "continue loops" after controller audit v2 finished.
Method: the rolling audit v2 method, [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md).
Every finding needs an anchor and is checked by an independent refuter. The coordinator then
re-checks every P1/P2 in code.

## Why these areas

Earlier controller audits covered three layers:

- transport, streaming, acknowledgement, reconnect and reset (2026-10-16 to 2026-10-20);
- the controller features in [controller v2](../2026-10-22-controller-v2/AREAS.md): resume, probing, homing and jog, settings, Console, the other drivers, device profiles and the machine panel.

This round covers what the machine does **besides moving the head**, and the calibration that
shapes every job: accessories, focus, rotary, spindle, no-go zones, controller identification, the
network link and scan offsets. Areas are ordered by physical risk.

Two auditors run at a time, because the PC froze under heavy parallel load on 2026-10-21.

## Areas

| # | Area id | Risk | Why now |
|---|---|---|---|
| D1 | `ctl-air-accessories` | S | Air off during a burn is a fire risk, and air left on wastes compressor time. Toggles are realtime bytes on some firmware and M-codes on others |
| D2 | `ctl-focus-z` | S | A wrong Z or Auto-focus move crashes the lens or the nozzle into the material |
| D3 | `ctl-rotary` | S+C | A wrong steps-per-rotation or axis swap gives a wrong-size wrap. A rotary job run on a flat bed (or the reverse) is a crash or a ruined part |
| D4 | `ctl-spindle-hours` | S | The bit plunges before the spindle is up to speed. RPM mapping vs `$30`/`$31`. Run-time counters that drive maintenance prompts |
| D5 | `ctl-zones-laser-off-motion` | S | No-go zones are the only guard for clamps and fixtures; the laser-off motion policy decides when the beam may be lit while moving |
| D6 | `ctl-detect-identify` | S | Choosing the wrong driver or dialect sends one firmware's commands to another. Readiness gates are what decide whether Start is allowed |
| D7 | `ctl-network-link` | S+C | A TCP link that drops mid-job, or a LAN bridge that other hosts can reach, can control a laser |
| D8 | `ctl-scan-offsets` | C | Bidirectional raster offsets set the edge quality of every image burn. The calibration pattern and the measurement entry need to match each other |

## Scope

| # | Files |
|---|---|
| D1 | `src/core/output/air-assist-hold.ts`, `src/core/preflight/m7-air-assist-readiness.ts`, `src/core/devices/preset-air-assist.ts`, `src/ui/laser/{AccessoryResetControls,JogPadAirAssist,PresetAirAssistOffer}.tsx`, `src/ui/laser/job-review/air-assist-*-warnings.ts`, per-layer air in every strategy, realtime `0xA0`/`0xA1`, Smoothieware switch modules |
| D2 | `src/core/devices/autofocus-command.ts`, `src/ui/state/{autofocus-action,autofocus-fresh-idle,laser-autofocus-actions}.ts`, `src/core/preflight/focus-contribution.ts`, `src/ui/laser/frame-focus-contribution.ts`, layer Z offset / Z step per pass / material thickness emission, `FocusJogControls.tsx`, `src/ui/calibration/FocusTestDialog.tsx` |
| D3 | `src/core/devices/rotary*.ts`, `src/core/job/rotary-*.ts`, `laser-lead-rotary.ts`, `src/ui/laser/Rotary*.tsx`, `rotary-*.ts`, `device-setup/DeviceSetupRotaryFields.tsx`, `job-review/rotary-raster-qualification-warnings.ts`, `src/ui/commands/rotary-command-family.ts` |
| D4 | `src/core/cnc/spindle-transition.ts`, `src/ui/machine/{SpindleScaleChoice.tsx,use-spindle-scale-choice.ts}`, CNC M3/M4/M5 and dwell emission, `src/ui/state/machine-hours*.ts`, `src/ui/app/use-machine-hours-tracking.ts`, `src/ui/laser/MachineHoursSection.tsx` |
| D5 | `src/core/preflight/{no-go-zones,laser-off-motion-policy,relative-motion-envelope}.ts`, `src/ui/workspace/draw-no-go-zones.ts`, `src/ui/laser/MachineSetupSafetyZones.tsx` |
| D6 | `src/core/controllers/{detect-controller,select-controller-driver,controller-firmware-report,controller-capabilities}.ts`, `src/core/preflight/{controller-readiness,controller-readiness-messages,laser-module-readiness}.ts`, the connect handshake in `src/ui/state/**` |
| D7 | `electron/machine-network-{bridge,protocol,routes,session,telnet}.ts`, `src/platform/electron/desktop-machine-network*.ts`, `src/ui/laser/{MachineNetworkConnect.tsx,machine-network-profile.ts}`, `electron/falcon-pointer.ts`, `src/ui/app/use-falcon-pointer-link.ts` |
| D8 | `src/core/devices/scan-offset-*.ts`, `src/core/job/scan-offset*.ts`, `src/core/preflight/scan-offset-policy.ts`, `src/io/project/project-scan-offset-validator.ts`, `src/ui/laser/{ScanOffsetOverrideNotice,MachineSetupRasterDiagnostics}.tsx`, `machine-setup-raster-diagnostic-checks.ts` |

Ruida stays out of scope: it is file-only, and it was covered by the 2026-09-25 RU track and rolling-v2 area 21.
