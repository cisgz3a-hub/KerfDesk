# Track OR (output dialects, device profiles, recovery/resume) — partial findings

Status: in progress (2026-09-25). Upstream root: session scratchpad `upstream/` (revisions per AUDIT-BRIEF).
Repro tests live in `src/__audit_repro__/OR/`; each fails on current code.

## OR-1 — M3 (constant-power) output stops the machine with the beam still lit

- severity: high (typical case: tens-of-ms full-power dwell = burn dot at a cut end / pass seam; critical
  where a coolant on-delay is configured: grblHAL `$673` (0.5-20 s) or FluidNC `coolant/delay_ms` (0-10 s)
  runs inside that drain with the beam lit = burn-through/fire risk)
- verdict: CONFIRMED (repro against the repo's gcode.c port + traced in GRBL/grblHAL/FluidNC source)
- status: new
- failure scenario: any M3 vector group (Neotronics 4040 profile cuts by default; `grbl-compatible` dialect;
  any layer set to Constant power) ends its last powered `G1` and the next line forces a GRBL planner sync:
  the between-pass re-arm `M3 S0` (4040, every multi-pass cut), an inter-layer `M8`/`M9` air change, `M5`
  before an M4/raster group. GRBL drains the planner; in M3 the PWM stays at the last S while stopped,
  for `$1` ms (default 25) inside the stepper ISR plus, for coolant, until the next motion block starts.
- kerfdesk evidence: `src/core/output/grbl-strategy.ts:191-195` (`if (p > 0) chunks.push(\`${vectorPowerWord(group, dialect)} S0\`)`),
  `:489-492` (coolant transition emitted right after the previous group's last burn), `:495-498` (`M9` before
  postamble `M5`); `src/core/devices/gcode-dialects.ts:142-155` (4040 cut = constant); emitted bytes:
  `G1 X10.000 Y10.000 F1200 S800` then `M3 S0` (4040 two-pass), `... S800` then `M9`/`M8` (M8 profile).
- upstream evidence: GRBL 1.1h gcode.c:916-926 (S change without axis motion -> `spindle_sync`), :946, :955
  (`coolant_sync`); coolant_control.c:121-126 and protocol.c:169-177 (`protocol_buffer_synchronize`);
  stepper.c:392-398 (`if (st.exec_block->is_pwm_rate_adjusted) { spindle_set_speed(SPINDLE_PWM_OFF_VALUE); }`
  = only M4 goes dark at an empty buffer), stepper.c:259-262 (`delay_ms(settings.stepper_idle_lock_time)`),
  defaults.h:49 (`$1` 25 ms). grblHAL d7aaee3d gcode.c:4121-4126, :4411, coolant_control.c:45-53 (`$673`
  on-delay dwell after coolant on), settings.c:2505 ("0.5".."20" s), nuts_bolts.c:324-340 (dwell loop touches
  no spindle), stepper.c:566-573. FluidNC v4.0.3 Stepper.cpp:234-240, GCode.cpp:1716-1733 (sync then
  `set_state`), CoolantControl.cpp:72-79 (`dwell_ms(_delay_ms, ...)` after coolant on), :90 (`delay_ms` 0-10000). Wiki Grbl-v1.1-Laser-Mode: "Constant laser power mode simply keeps the laser power as
  programmed, regardless if the machine is moving, accelerating, or stopped." and "When using `M3` constant
  laser power mode, try to avoid force-sync conditions during a job whenever possible."
  URLs: https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/stepper.c#L392-L398 ,
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L916-L926 ,
  https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/coolant_control.c#L45-L67 ,
  https://github.com/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode
- reproduction: `src/__audit_repro__/OR/m3-lit-planner-drain.test.ts` — 3 tests, all FAIL
  (`"M3 S0" drains with M3 S800 lit`, `"M9" drains ...`, `"M8" drains ...`).
- fix (local): drop the redundant between-pass re-arm and skip a laser-off seek to the current head position
  (see addendum); emit a group's coolant change after its first non-zero laser-off seek instead of right after
  the previous burn; at the job end emit `M5` before `M9`.

## OR-2 — CNC pass recovery marks passes "proven complete" that may still have been queued

- severity: medium
- verdict: CONFIRMED (repro + firmware setting ranges)
- status: new
- failure scenario: CNC job on grblHAL with `$398` planner blocks > 256 (valid 30..1000; a Falcon reported
  512) or FluidNC with `planner_blocks` > 64 (valid 10..120) is stopped; the recovery wizard subtracts a fixed
  256/64 lines from the ack count, marks earlier passes ✓ "proven-complete" and preselects a later pass as the
  "computed safe boundary". Those passes may never have run; recovery starts a deeper pass on uncut stock.
- kerfdesk evidence: `src/core/recovery/cnc-resume-point.ts:38-45` (`grblhal: 256`, `fluidnc: 64`),
  `:82-93`; `src/ui/laser/cnc-pass-recovery-model.ts:149-151`; wizard `CncPassRecoveryWizard.tsx:199-204,219`
  (confirmation asked only for a boundary LATER than the default). The live idle `Bf` capacity
  (`laser-rx-capacity-evidence.ts`) is not used for CNC.
- upstream evidence: grblHAL settings.c:2485 (`"Planner buffer blocks" ... "30", "1000"`), config.h:906
  (default 100), planner.c:230; FluidNC v4.0.3 MachineConfig.cpp:89 (`planner_blocks, 10, 120`); GRBL
  motion_control.c:57-62 (line queued before its `ok`).
- reproduction: `src/__audit_repro__/OR/cnc-resume-planner-reserve.test.ts` — FAILS (grblHAL 400 blocks:
  passes 3-5 marked proven; FluidNC 120: pass 10).
- fix (local): use max(fixed reserve, measured idle planner capacity from `Bf`/`$I`) recorded with the run,
  or raise the constants to the firmware maxima (grblHAL 1000, FluidNC 120).

## OR-3 — On stock GRBL (`$10=1`, no `Bf:`) the Abort restart never steps back over discarded moves

- severity: medium
- verdict: CONFIRMED (repro)
- status: incomplete fix of ADR-362 item 8
- failure scenario: stock GRBL 1.1h at its default `$10=1` reports no `Bf:`; KerfDesk never learns the planner
  size or backlog, so after Abort (soft reset -> `plan_reset()`), automatic recovery restarts at the first
  unacknowledged line and skips up to 15 acknowledged moves that never ran (hint text only says progress
  "can be ahead").
- kerfdesk evidence: `src/ui/state/laser-rx-capacity-evidence.ts:95,150-166` (no snapshot without `Bf`),
  `src/ui/app/checkpoint-interruption.ts:56-63`, `src/core/recovery/automatic-restart-line.ts:70-80`; simulator
  default `[10, '1']` (`src/__fixtures__/controllers/grbl-sim-settings.ts:12`). `$I` planner size is parsed
  (`build-info.ts:95-104`) and archived but unused.
- upstream evidence: defaults.h:50 (`DEFAULT_STATUS_REPORT_MASK 1`), report.c:531-537 (`|Bf:` only with mask
  bit 1), planner.h:31 + planner.c:500 (15 usable blocks), main.c:94 (`plan_reset()` after reset); wiki
  Grbl-v1.1-Configuration `$10`: "the default report with machine position and no buffer data reports setting
  is `$10=1`".
- reproduction: `src/__audit_repro__/OR/abort-restart-without-bf.test.ts` — FAILS (restart 36, expected <= 21).
- fix (local): without a `Bf` snapshot, step back the archived `$I` planner size (stock 15) or the per-family
  reserve CNC already uses.

## OR-4 — xTool D1 Pro profiles drive native `$J=` jog/Frame although the cited vendor file disables it

- severity: low
- verdict: PLAUSIBLE (xTool firmware is closed; KerfDesk side traced)
- status: new
- failure scenario: if the xTool firmware rejects `$J=` (as xTool's LightBurn device file assumes), every Frame
  (built from `$J=` lines) fails, so Start never unlocks; jog buttons fail too.
- kerfdesk evidence: `src/core/devices/brand-laser-profiles.ts:65-89` (note cites `"EnableGrblJCommand": false`
  but no `controllerCommandSet`), `src/core/controllers/grbl/driver.ts:86` (`buildFrameLines: buildGrblFrameJogLines`);
  the Falcon profile honours the same vendor field through `falcon-command-contract.ts:14-21`.
- upstream evidence: xTool-D1ProV3.lbdev (https://xtool.zendesk.com/hc/article_attachments/7316804567447/xTool-D1ProV3.lbdev,
  fetched 2026-09-25, sha256 d03e3021...): `"EnableGrblJCommand": false`, `"BaudRate": 230400`, `"S_Scale": 1000`,
  `"MirrorY": true`, `"Width": 430`, `"Height": 400`. xTool product page returned HTTP 403.
- reproduction: traced only.
- fix: needs decision (give the xTool profiles a relative-G1 jog/Frame contract like the Falcon's, or keep `$J`
  and say so in Machine Setup).

## OR-5 — LightBurn `.lbdev` import cannot read real LightBurn device files

- severity: low (fails closed with a wrong reason)
- verdict: CONFIRMED (repro)
- status: new
- failure scenario: importing xTool's official D1 Pro `.lbdev` (JSON) in Machine Setup returns "invalid: missing
  bed width or height"; the importer only matches invented XML tags (`<SMax>`, `<Origin>`), never `S_Scale`,
  `MirrorY`, `Settings.BaudRate`.
- kerfdesk evidence: `src/io/lightburn/lbdev-import.ts:66-100` (tag lists), `:226-231` (XML regex); tests use an
  invented XML sample (`lbdev-import.test.ts:4-16`).
- upstream evidence: the xTool file above; Falcon bundle keys recorded in
  `docs/audits/2026-09-19-machine-compatibility-fixes/falcon-vendor-configuration.json`.
- reproduction: `src/__audit_repro__/OR/lbdev-json-import.test.ts` — FAILS (`expected 'invalid' to be 'review'`).
- fix (local): parse the JSON `DeviceList[]` form (Width, Height, Settings.S_Scale, Settings.BaudRate,
  MirrorX/MirrorY -> origin, Settings.AirAssistM7), keep the review step.

## OR-6 — FluidNC `$32=0` advice is not actionable, and the default M4 output is rejected there

- severity: low (fails closed at the preamble's `M4 S0`, before motion)
- verdict: CONFIRMED (trace)
- status: new
- failure scenario: FluidNC with a `PWM` spindle (no direction pin, not `Laser`) reports `$32=0`; Job Review says
  "Enable GRBL laser mode ($32=1) before starting", but FluidNC's `$32` is a read-only proxy of the spindle type
  and the default `grbl-dynamic` preamble's `M4 S0` is rejected with error:20, so the job stops at line 5. The
  real remedies (a `Laser` spindle in the YAML, or a constant-power dialect) are not named. The CNC twin
  ("Set $32=0 for spindle work", `controller-readiness.ts:178-183`) is equally unactionable on FluidNC. Separately,
  `controller-readiness.ts:121-122` says Start refuses `max-power-mismatch`; Start demotes every readiness error
  to a Job Review warning (`start-job-controller-policy.ts:26-30`).
- kerfdesk evidence: `src/core/preflight/controller-readiness.ts:231-236`, `:121-122`; `src/core/output/grbl-strategy.ts:86`.
- upstream evidence: FluidNC v4.0.3 SettingsDefinitions.cpp:146 `INT_PROXY("32", "Grbl/LaserMode",
  spindle->isRateAdjusted())`; Settings.h:229 `setStringValue(...) override { return Error::ReadOnlySetting; }`;
  GCode.cpp:654-659 (`M4` "Supported if the spindle can be reversed or laser mode is on", else
  `Error::GcodeUnsupportedCommand`); Spindles/PWMSpindle.cpp:20 `is_reversable = _direction_pin.defined();`.
  (grblHAL gcode.c:2628-2641 rejects M4 likewise without direction or laser capability; there `$32=1` is the right advice.)
- reproduction: traced only.
- fix (local): FluidNC-specific wording (configure a `Laser` spindle or pick the constant-power dialect); fix the comment.

## OR-1 addendum

GRBL also syncs on a zero-length move under M3 (motion_control.c:67-73, "Forces a buffer sync while in M3 laser
mode only"). KerfDesk always emits each segment's laser-off seek, so pass 2 of a closed contour seeks to where
pass 1 ended; if only the re-arm is removed, that zero-length seek becomes the lit drain. The repro now includes
this rule, so the fix must also skip a seek to the current head position (or otherwise leave the beam dark).
Real-pipeline sample: 2 of 572 burn moves on 3 mm script text were below one 80 steps/mm step (M3 coincident).

## Checked so far (correct)

- Every catalog profile's emitted laser program uses only G21/G90/G54/G94/G0/G1/M3/M4/M5/M8/M9, max
  executable line 28 chars (GRBL LINE_BUFFER_SIZE 80), every G0 carries S0, max S = profile S max.
- Preamble restates G21 G90 G54 G94 + M3/M4 S0; postamble M5; no M2/M30/M6/T/G53/G28.
- GRBL resume preamble restates units, G90, WCS, G94, M5, air, `G0 X Y S0`, M3/M4 S0, F.
- Planner backlog math with `Bf`: idle `Bf` = BLOCK_BUFFER_SIZE-1 (planner.c:500) and grblHAL size (planner.c:697-702);
  arcs make it over-replay (safe), only zero-step moves (planner.c:381) can make it under-replay.
- Ortur LM3 (400x400 / 400x380, S0-1000, 115200) and Sculpfun S30 (380x385, M8) match vendor pages; Falcon
  A1 Pro matches the recorded vendor bundle; FluidNC default S255 (LaserSpindle.cpp) and `$30`/`$32` proxies
  (SettingsDefinitions.cpp:146-148); Marlin PWM255 / 250000 baud (Configuration_adv.h:3372, Configuration.h:117).

## Still to check

- Final pass over resume edge cases; CNC GRBL emitter items not in the 2026-09-24 CNC audit (so far none new).
