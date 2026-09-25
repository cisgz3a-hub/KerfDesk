# Track OR (output dialects, device profiles, recovery/resume) — partial findings

Status: in progress (2026-09-25). Upstream root: session scratchpad `upstream/` (revisions per AUDIT-BRIEF).
Repro tests live in `src/__audit_repro__/OR/`; each fails on current code.

## OR-1 — M3 (constant-power) output stops the machine with the beam still lit

- severity: high (typical case: tens-of-ms full-power dwell = burn dot at a cut end / pass seam; on grblHAL
  with `$673` coolant on-delay set, the lit dwell lasts the whole 0.5-20 s delay = burn-through/fire risk)
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
  on-delay dwell after coolant on), settings.c:2505 ("0.5".."20" s), stepper.c:566-573. FluidNC v4.0.3
  Stepper.cpp:234-240. Wiki Grbl-v1.1-Laser-Mode: "Constant laser power mode simply keeps the laser power as
  programmed, regardless if the machine is moving, accelerating, or stopped." and "When using `M3` constant
  laser power mode, try to avoid force-sync conditions during a job whenever possible."
  URLs: https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/stepper.c#L392-L398 ,
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L916-L926 ,
  https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/coolant_control.c#L45-L67 ,
  https://github.com/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode
- reproduction: `src/__audit_repro__/OR/m3-lit-planner-drain.test.ts` — 3 tests, all FAIL
  (`"M3 S0" drains with M3 S800 lit`, `"M9" drains ...`, `"M8" drains ...`).
- fix (local): drop the redundant between-pass re-arm (mode never changes inside a group; the next pass's
  `G0 ... S0` darkens without a sync — also removes a stop per pass in M4); emit a group's coolant change
  after its first laser-off seek instead of right after the previous burn; order the job end as park/laser-off
  motion before `M9`/`M5` or at least `M5` before `M9`.

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

## Low / plausible (being verified)

- xTool D1 Pro profiles keep native `$J=` jog/Frame although the cited xTool LightBurn device file sets
  `"EnableGrblJCommand": false` (downloaded file sha256 d03e3021...; proprietary firmware — not verifiable).
- LightBurn `.lbdev` import reads XML tags only; xTool's official JSON `.lbdev` is rejected as "missing bed
  width or height"; real files use `S_Scale`, `MirrorY`, not `SMax`/`Origin` (fails closed).
- `controller-readiness.ts:121-122` comment says Start refuses `max-power-mismatch`; Start demotes it to a Job
  Review warning (`start-job-controller-policy.ts:26-30`).

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

- grbl-power-modes / dialect M3/M4 choices vs grblHAL/FluidNC nuances; `$32=0` path wording.
- Resume/replay edge cases (compact words, F restore) against the oracle; native resume consistency.
- CNC GRBL emitter items not in the 2026-09-24 CNC audit.
