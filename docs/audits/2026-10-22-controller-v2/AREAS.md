# Controller audit v2 — area map

Started 2026-10-22 at the user's request ("a similar audit in different areas of my controller").
Method: the rolling audit v2 method, [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md)
(anchors, lenses L1–L7, severity, evidence bar, auditor → independent refuter → coordinator
re-verification of every P1/P2).

## Why these areas

Five controller audits ran between 2026-10-16 and 2026-10-20 (pipeline, reconnect, behaviour,
design, protocol), plus the 2026-09-25 full audit and rolling-v2 area 17. They covered transport,
streaming, acknowledgement, reconnect and reset behaviour. They did not go deep into the
controller **features** built on top of that: what KerfDesk asks the machine to do and how it reads
the answers. This audit covers those, ordered by physical risk.

Runs two auditors at a time (the PC froze under heavy parallel load on 2026-10-21).

| # | Area id | Scope | Risk | Why now |
|---|---|---|---|---|
| C1 | `ctl-native-resume` | `src/core/controllers/grbl/native-laser-resume*.ts`, `laser-resume-dialect.ts`, `laser-resume-reentry.ts`, `resume-program.ts`, `resume-travel*.ts`, `resume-head-stop-block.ts`, `focus-resume-issue.ts` and their callers | S | Generated resume G-code: laser-off travel, modal restore, Z re-entry, mid-arc resume. Rolling-v2 05/18 audited the store and line maths, not the emitted resume program |
| C2 | `ctl-probing` | `probe.ts`, `corner-probe-geometry.ts`, `surface-grid-probe.ts`, `work-offset-readback.ts`, probe UI | S | Probe moves (G38.x) can crash a bit; offsets written with G10/G92 decide every later cut |
| C3 | `ctl-homing-envelope-jog` | `grbl-homing-duration.ts`, `machine-envelope.ts`, `jog-travel-limits.ts`, `frame-lines.ts`, jog/home UI | S | Homing-mask → origin mapping, soft limits, pull-off, `$J=` limits, Frame motion |
| C4 | `ctl-settings-eeprom` | `grbl-setting-*.ts`, `eeprom-write-line.ts`, `compare-settings-snapshots.ts`, `parse-settings.ts`, settings backup/restore UI | D+S | Wrong EEPROM writes persist across power cycles; backup/restore fidelity |
| C5 | `ctl-console-responses` | `console-command.ts`, `response*.ts`, `error-codes.ts`, `grblhal-error-codes.ts`, `alarm-codes.ts`, `build-info.ts`, `grbl-machine-mode.ts`, `line-buffer-limit.ts`, `sendable-line-scan.ts`, user macros (ADR-293), super console UI | S+C | Command classification and confirmation; error/alarm text vs firmware tables |
| C6 | `ctl-other-drivers` | `src/core/controllers/{grblhal,fluidnc,marlin,smoothieware}/**` | S | Per-dialect frame/jog/home/probe/abort/air/laser commands and status parsing vs each firmware's docs |
| C7 | `ctl-device-profiles` | `src/core/devices/**`, Falcon profiles, machine-setup data | S+C | Vendor bed sizes, origin, `$30`, dialect, homing, air, Auto-focus defaults vs vendor specs |
| C8 | `ctl-machine-ui` | `src/ui/machine/**` and the DRO/status/override UI | C+S | Status display truth (WPos/MPos/WCO/inches), overrides (realtime 0x90–0x9D), jog pad safety |

Ruida stays out: it is file-only, was covered by the 2026-09-25 RU track, and was re-checked in rolling-v2 area 21.
