# Machine Compatibility Rayforge Study

Date: 2026-06-16

Rayforge reference checkout: `references/rayforge-main`

Reference commit: `13f49ec3` (`1.8.0`)

## Purpose

This note records the Rayforge-inspired machine compatibility hardening for
LaserForge, focused on Neotronics 4040 / LT-4LDS-V2 and unknown GRBL
controllers. Rayforge was used as an architecture reference only. No Rayforge
code was copied into LaserForge, and LaserForge has no Rayforge runtime
dependency.

## Rayforge Patterns Studied

Files reviewed:

- `rayforge/machine/device/profile.py`
- `rayforge/resources/devices/generic-grbl/device.yaml`
- `rayforge/resources/devices/generic-grbl/dialect.yaml`
- `rayforge/resources/devices/creality-falcon-2-pro/device.yaml`
- `rayforge/resources/devices/creality-falcon-2-pro/dialect.yaml`
- `rayforge/resources/devices/grbl-mks-dlc32/device.yaml`
- `rayforge/resources/devices/grbl-mks-dlc32/dialect.yaml`
- `rayforge/machine/driver/grbl/grbl_serial.py`
- `rayforge/machine/driver/grbl/grbl_serial_simple.py`
- `rayforge/machine/driver/grbl/grbl_probe.py`
- `rayforge/machine/transport/grbl.py`
- `rayforge/machine/sanity/`

Useful architecture patterns:

- Device profile owns machine, driver, and dialect facts instead of scattering
  compatibility assumptions through UI code.
- Dialect templates decide preamble, postscript, travel moves, burn moves,
  homing/unlock/jog commands, coolant commands, modal feed behavior, and
  return-to-origin behavior.
- Rayforge keeps a fast char-counted GRBL stream and a simpler ping-pong GRBL
  stream as separate compatibility choices.
- Rayforge probing treats `$I`, `$$`, `$#`, `$G`, and status responses as
  evidence used to build a safer profile and warnings.
- Sanity checks are framed as machine/work-area/extent issues before output is
  streamed.

## Implemented In LaserForge

Profile compatibility fields were added to `DeviceProfile`:

- `controller.baudRate`
- `controller.rxBufferBytes`
- `controller.streamingMode`
- `controller.pollDuringJob`
- `controller.requiresHomingBeforeJob`
- `controller.supportsStatusBufferReport`
- `controller.supportsWcs`
- `controller.safeModeDefault`
- `gcodeDialect.dialectId`
- `gcodeDialect.returnToOriginOnEnd`
- `gcodeDialect.emitSOnTravel`
- `gcodeDialect.emitSOnEveryBurnMove`
- `gcodeDialect.modalFeedrate`
- `gcodeDialect.airAssistCommand`
- `gcodeDialect.laserModeCommand`

Default/Falcon-compatible behavior remains:

- `streamingMode: char-counted`
- `pollDuringJob: 4hz`
- `rxBufferBytes: 120`
- mixed M3/M4 vector/fill behavior
- S0 on travel moves
- modal feedrate and modal burn power after the first vector burn move
- return to `X0 Y0` at the end of the job

Neotronics safe profile now uses:

- `streamingMode: ping-pong`
- `pollDuringJob: off`
- `rxBufferBytes: 80`
- `requiresHomingBeforeJob: true`
- `safeModeDefault: true`
- `dialectId: neotronics-4040-safe`
- M4 zero-power arming
- S0 on travel moves
- repeated `F` and `S` on burn moves
- no automatic final return to `X0 Y0`

Output changes:

- `src/core/output/gcode-dialect.ts` resolves the active dialect from the
  device profile.
- `src/core/output/grbl-strategy.ts` now uses the resolved dialect for vector
  preamble, postamble, travel S0, burn F/S repetition, and M3/M4 mode choice.
- Raster output still uses its established M4 raster emitter. It was not
  rewritten in this slice.

Streaming changes:

- `src/core/controllers/grbl/streamer.ts` now supports `char-counted` and
  `ping-pong` modes.
- Ping-pong mode sends exactly one queued G-code line per acknowledgement.
- `startJob` accepts the active `DeviceProfile` and passes
  `rxBufferBytes`, `streamingMode`, and `pollDuringJob` into the streamer.
- `runStartJobFlow` passes `project.device` into `startJob`.
- The live status poll loop maps `pollDuringJob` to `off`, `1hz`, `2hz`, or
  `4hz` while a job is active.

Diagnostic changes:

- `runMachineDiagnostic` sends the read-only probe sequence `$I`, `$$`, `$#`,
  `$G`, and `?` through the guarded serial write path.
- The diagnostic `$$` probe reuses the existing settings collector, so the
  controller settings snapshot and settings table refresh from the same parsed
  evidence as the regular Read button.
- The Machine Settings panel now has "Run diagnostic" and "Export diagnostic"
  buttons.
- `createMachineDiagnosticBundle` exports a local JSON bundle with active
  profile/controller/dialect fields, parsed controller settings, last status
  report, cached WCO/origin state, streamer mode/buffer state, and the last 300
  transcript entries.
- Diagnostic bundles include a structured `profileSuggestion` with a proposed
  profile patch, confidence, evidence from `$I`/`$G`/status/WCO, hard blockers
  for unsafe mismatches, and warnings for review. The bundle does not
  automatically mutate the active profile.

Persistence changes:

- Older `.lf2` files missing `controller` and `gcodeDialect` are back-filled
  with default/Falcon-compatible compatibility settings during deserialization.

Reference checkout handling:

- `references/` is ignored in `.gitignore`.
- `references/rayforge-main` is a local reference clone only and is not tracked.

## Intentionally Not Copied

The implementation does not copy Rayforge classes, YAML templates, transport
code, probing code, or sanity-check code. LaserForge keeps its existing TypeScript
profile, output, streamer, and Zustand store architecture.

## Not Implemented Yet

Still pending from the Gmail instruction set:

- UI review/apply flow for the structured diagnostic profile suggestion.
- Platform metadata and generated G-code samples attached automatically to the
  diagnostic export.
- Parser hardening for corrupted bytes, replacement characters, very long lines,
  and unsolicited `ok`/`error` cases beyond the existing response classifier and
  streamer safety tests.
- Stronger preflight for `$32`, `$30`, `$20/$21/$22`, `$130/$131/$132`,
  WCS/G92 offsets, negative coordinates, return-origin risk, and
  profile/detected-controller mismatch.
- Hardware verification on a real Neotronics 4040 controller.

## Manual Neotronics Test Plan

1. Select the Neotronics 4040 Max / LT-4LDS-V2 profile.
2. Connect at 115200 baud.
3. Confirm generated vector G-code starts with `G21`, `G90`, `M4 S0`.
4. Confirm the final postamble does not auto-park to `G0 X0 Y0`.
5. Start a tiny test job and confirm only one G-code line is sent per `ok`.
6. Confirm no periodic `?` status polls are emitted while the job is active.
7. Run this tiny low-power motion/laser test only after verifying bed clearance:

```gcode
G21
G90
M5
G0 X10 Y10
M4 S100
G1 X30 Y10 F500
M5
G0 X10 Y10
```

8. Test Frame.
9. Test a simple rectangle.
10. Test a raster.
11. Test a multi-pass job.
12. If anything fails, export or capture the serial transcript immediately,
    including `$I`, `$$`, `$#`, `$G`, and the generated G-code sample.
