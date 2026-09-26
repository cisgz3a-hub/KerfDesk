# Track OR — output dialects, machine profiles, resume and recovery (final)

Status: final, 2026-09-25 (second session; continues `OR-partial.md`, which is left in place).
Brief: `../method.md`. Upstream root this session: session scratchpad `upstream/` at the brief's
revisions (GRBL 1.1h `bfb67f0c`, grbl wiki `b81e2de0`, grblHAL core `d7aaee3d`, FluidNC v4.0.3
`25ae119b` and main `fdc17a2c`, Marlin 2.1.2.8 `1cd56c4c`, Smoothieware edge `38e2cc08`).
No hardware. Evidence is code traces, the repository's firmware models, and upstream source.

Reproductions: `src/__audit_repro__/OR/` — 4 files, 11 tests, all FAIL on current code (each
failure is the defect). Run: `cd /home/user/KerfDesk && pnpm vitest run src/__audit_repro__/OR/`.
The files lint, typecheck and pass `prettier --check`.

| id | severity | verdict | status | title |
|---|---|---|---|---|
| OR-1 | high | CONFIRMED | new | Constant-power (M3) output stops the machine with the beam lit |
| OR-2 | medium | CONFIRMED | new | CNC pass recovery marks passes "proven complete" that may still have been queued |
| OR-3 | medium | CONFIRMED | incomplete fix of ADR-362 item 8 | Automatic laser restart skips moves a stop discarded when no usable `Bf` backlog exists |
| OR-4 | medium if true | PLAUSIBLE | new | xTool D1 Pro profiles drive `$J=` jog and Frame although xTool's device file turns `$J` off |
| OR-5 | low | CONFIRMED | new | LightBurn `.lbdev` import cannot read real (JSON) device files |
| OR-6 | low | CONFIRMED (trace) | new | `$32`/`$30` advice is not actionable on FluidNC, where those settings are read-only |

---

## OR-1 — Constant-power (M3) output stops the machine with the beam lit

- **severity:** high. On stock GRBL 1.1h settings (`$1=25`) every listed stop leaves a stationary
  full-power exposure of 25 ms at the stop point (a burn dot at every pass seam of a multi-pass
  cut). Where an air on-delay is configured (grblHAL `$673`, 0.5-20 s; FluidNC `coolant/delay_ms`,
  up to 10 s) an air change after an M3 layer holds the lit, stationary beam for the whole delay:
  burn-through and fire risk. On grblHAL/FluidNC without a delay the effect is a full stop at
  constant power (the scorch GRBL's own laser guide warns about), without a stationary dwell.
- **verdict:** CONFIRMED (repro against the repository's port of GRBL `gcode.c` laser power, plus
  source trace in GRBL 1.1h, grblHAL and FluidNC).
- **status:** new.
- **who gets M3 output:** the Neotronics 4040 profile cuts in M3 by default
  (`neotronics-4040-safe`), the `grbl-compatible` dialect uses M3 for cut, fill and raster, and any
  layer set to "Constant (M3)". The default `grbl-dynamic` (M4) output is not affected (see
  "Checked and correct").
- **failure scenario:** the emitter writes a line that makes the controller drain its planner
  directly after an M3 burn, while the last S is still applied:
  1. the between-pass re-arm of every multi-pass constant-power cut
     (4040, two passes: `G1 X10.000 Y10.000 F1200 S800` → `; pass 2 of 2` → `M3 S0`);
  2. an air change between layers (`G1 X10.000 Y10.000` → `M8`, or `M9`) after an M3 layer;
  3. a power-mode change after an M3 layer: `M5` + `M4 S0` before an M4 layer, and the image
     layer's own opening `M5` (`G1 X40.000 Y30.000 F1200 S800` → `; image layer R …` → `M5`);
  4. a laser-off seek to the point where the last burn ended (the next pass of a single closed
     contour, or the next operation starting where the last one stopped), and any burn or seek
     shorter than one motor step (GRBL 1.1h and grblHAL only);
  5. in M3 raster (`grbl-compatible`) with overscan 0, the zero-length row close
     `G1 X13.000 F3000 S500` → `G1 X13.000 S0` at the end of every row (GRBL 1.1h and grblHAL);
  6. the job end (`M9`/`M5` right after the last burn) — inherent to M3, listed for completeness.
- **how long the beam dwells lit and stationary** (verified per firmware):

  | firmware | S-change or spindle drain (`M3 S0`, `M5`, raster `M5`, coincident move) | air drain (`M7`/`M8`/`M9`) |
  |---|---|---|
  | GRBL 1.1h | head stops at full power; the stepper ISR then blocks for `$1` ms (default 25; none with `$1=255`) before the parser can switch the beam off | the same `$1` dwell, then the beam stays lit until the next queued move's first segment loads or a later spindle sync (GRBL auto-starts the next motion only when its serial buffer runs dry or the planner fills) |
  | grblHAL | head stops at full power; off right after the drain (the idle lock is a deferred task, no dwell) | lit until the next move starts; with `$673` set, the whole on-delay is added when air turns on |
  | FluidNC v4.0.3 | as grblHAL (no coincident-move sync at all) | lit until the next move starts; with `coolant/delay_ms` set, the whole delay is added when air turns on |

- **kerfdesk evidence:**
  - `src/core/output/grbl-strategy.ts:195` — `` if (p > 0) chunks.push(`${vectorPowerWord(group, dialect)} S0`); ``
    (re-arm every pass although the mode never changes inside a group).
  - `grbl-strategy.ts:172` — `return [laserOffSeekLine(first.x, first.y, context.device, context.dialect)];`
    every segment gets its seek, with no head-position check (the burn loop has one, `:142`
    `if (targetX === headX && targetY === headY) continue;`).
  - `grbl-strategy.ts:477-491` — the mode flip (`parts.push('M3 S0' + LINE_END)` at `:479`,
    `parts.push((mode === 'M3' ? 'M5' + LINE_END : '') + 'M4 S0' + LINE_END)` at `:486`) and
    `parts.push(coolantTransition(coolant, nextCoolant))` at `:490` are written immediately after
    the previous group's last burn; `:495` `parts.push(coolantTransition(coolant, 'off'))` and
    `:101` `const lines = laserAlreadyOff ? [] : ['M5'];` at the end.
  - `src/core/raster/emit-raster.ts:113-116` — `// M5 first so we don't get stuck in M3 from a
    preceding cut group.` `` yield `M5${LINE_END}`; ``; `:301-307` — with overscan 0 the row close
    `formatLaserOffG1(endX + rowShiftX, …)` is a zero-length move, deliberately so
    (`:338-340` "Its X word is written even when the head already sits there, so the line stays a
    motion block that darkens the beam").
  - `src/core/devices/gcode-dialects.ts:115-117` (`grbl-compatible`: cut, fill, raster
    `'constant'`), `:145` (`neotronics-4040-safe` `cutPowerMode: 'constant'`);
    `src/core/devices/device-profile.ts:390`; `src/ui/layers/CutPowerModeField.tsx:40`
    (`Constant (M3)` per layer).
  - Marlin inline (same emitter line): `src/core/output/marlin-inline-transform.ts:14-18` turns
    each re-arm into `M5 I` + `M3 I S0`; Marlin's M5 synchronizes before it zeroes power and
    continuous inline power is not blanked at an empty planner (upstream below), so there too the
    re-arm is a full stop at constant power (no stationary dwell beyond loop latency).
- **upstream evidence:**
  - GRBL 1.1h `grbl/gcode.c:917-923`
    `if ((gc_state.spindle_speed != gc_block.values.s) || bit_istrue(gc_parser_flags,GC_PARSER_LASER_FORCE_SYNC)) {`
    … `} else { spindle_sync(gc_state.modal.spindle, gc_block.values.s); }` —
    https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L916-L930 ;
    `:946` `spindle_sync(gc_block.modal.spindle, pl_data->spindle_speed);` (#L942-L948);
    `:955` `coolant_sync(gc_block.modal.coolant);` (#L951-L957).
  - GRBL `grbl/spindle_control.c:280` `protocol_buffer_synchronize(); // Empty planner buffer to ensure spindle is set when programmed.`
    (#L274-L282); `grbl/coolant_control.c:124` `protocol_buffer_synchronize(); // Ensure coolant turns on when specified in program.`
    (#L119-L126); `grbl/protocol.c:176` `} while (plan_get_current_block() || (sys.state == STATE_CYCLE));` (#L169-L177).
  - GRBL `grbl/motion_control.c:70-73` `// Correctly set spindle state, if there is a coincident position passed. Forces a buffer`
    `// sync while in M3 laser mode only.` … `spindle_sync(PL_COND_FLAG_SPINDLE_CW, pl_data->spindle_speed);`
    (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L67-L76);
    `grbl/planner.c:381` `if (block->step_event_count == 0) { return(PLAN_EMPTY_BLOCK); }`.
  - GRBL `grbl/stepper.c:394-397` `st_go_idle();` … `if (st.exec_block->is_pwm_rate_adjusted) { spindle_set_speed(SPINDLE_PWM_OFF_VALUE); }`
    (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/stepper.c#L392-L398);
    `:262` `delay_ms(settings.stepper_idle_lock_time);` inside `st_go_idle()` (#L250-L268);
    `:389` `spindle_set_speed(st.exec_segment->spindle_pwm);` (PWM changes only when a segment loads);
    `grbl/defaults.h:49` `#define DEFAULT_STEPPER_IDLE_LOCK_TIME 25 // msec (0-254, 255 keeps steppers enabled)`;
    `grbl/protocol.c:154-157` (auto cycle start only once the serial buffer is empty) and
    `grbl/motion_control.c:63` (`if ( plan_check_full_buffer() ) { protocol_auto_cycle_start(); }`).
  - grblHAL `gcode.c:4121-4125` `if(sspindle->rpm != gc_block.values.s || gc_parser_flags.spindle_force_sync) {`
    `if(sspindle->state.on && !gc_parser_flags.laser_is_motion) {` … `protocol_buffer_synchronize();` —
    https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/gcode.c#L4121-L4128 ;
    `:4411` `if(coolant_set_state_synced(gc_block.modal.coolant))`;
    `coolant_control.c:62` `if((ok = protocol_buffer_synchronize())) // Ensure coolant changes state when specified in program.`;
    `coolant_control.c:49-50` `if(mode.value && settings.coolant.on_delay)` `delay_sec((float)settings.coolant.on_delay / 1000.0f, DelayMode_Dwell);`
    (https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/coolant_control.c#L45-L67);
    `settings.c:2505` `{ Setting_CoolantOnDelay, Group_Coolant, "Coolant on delay", "s", Format_Decimal, "#0.0", "0.5", "20", …`,
    `settings.h:457` `Setting_CoolantOnDelay = 673,`, `config.h:1128` `#define DEFAULT_COOLANT_ON_DELAY 0`;
    `nuts_bolts.c:324-340` (the dwell loop only runs realtime checks and `hal.delay_ms`);
    `stepper.c:570` `if(st.exec_block && st.exec_block->dynamic_rpm && st.exec_block->spindle->cap.laser) {`
    (https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/stepper.c#L566-L573),
    `gcode.c:4080` `gc_state.is_rpm_rate_adjusted = sspindle->state.ccw && !gc_parser_flags.laser_disable;`;
    `motion_control.c:183-190` coincident target in M3: `protocol_buffer_synchronize())` then `set_state(…)`;
    `stepper.c:273-274` idle lock is `task_add_delayed(st_deenergize, …)` (no blocking dwell).
  - FluidNC v4.0.3 `FluidNC/src/GCode.cpp:1640-1643` `if ((gc_state.spindle_speed != gc_block.values.s) || syncLaser) {`
    … `protocol_buffer_synchronize();` (https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/GCode.cpp#L1639-L1647);
    `:1703` (spindle change), `:1731-1732` `protocol_buffer_synchronize();` `config->_coolant->set_state(gc_state.modal.coolant);`;
    `FluidNC/src/CoolantControl.cpp:78-79` `if (state.Mist || state.Flood)  // ignore delay on turn off` `dwell_ms(_delay_ms, DwellMode::SysSuspend);`,
    `:90` `handler.item("delay_ms", _delay_ms, 0, 10000);`
    (https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/CoolantControl.cpp#L72-L91);
    `FluidNC/src/Stepper.cpp:238-239` `if (st.exec_block != NULL && st.exec_block->is_pwm_rate_adjusted) {` `spindle->setSpeedfromISR(0);`
    (https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Stepper.cpp#L233-L241);
    `Planner.cpp:342-345` (a zero-length block is dropped, no sync). FluidNC main `fdc17a2c`
    is the same (`CoolantControl.cpp:79`, `:108`; `Stepper.cpp:240`).
  - Marlin 2.1.2.8 `Marlin/src/gcode/control/M3-M5.cpp:142-145` `void GcodeSuite::M5() {` `planner.synchronize();`
    `cutter.power = 0;` `cutter.apply_power(0);` (https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/control/M3-M5.cpp#L142-L154);
    `Marlin/src/module/stepper.cpp:2341-2344` `else { // !current_block` … `if (cutter.cutter_mode == CUTTER_MODE_DYNAMIC)` `cutter.apply_power(0);`
    (only dynamic mode is blanked when the planner is empty).
  - GRBL wiki "Grbl v1.1 Laser Mode" (https://github.com/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode):
    "Constant laser power mode simply keeps the laser power as programmed, regardless if the
    machine is moving, accelerating, or stopped." and "When using `M3` constant laser power mode,
    try to avoid force-sync conditions during a job whenever possible."
- **reproduction:** `src/__audit_repro__/OR/m3-lit-planner-drain.test.ts` — 5 tests, all FAIL:
  `line 13 "M3 S0" drains with M3 S800 lit` (4040 two-pass); `line 14 "M9" …`, `line 17 "G0 X10.000 Y10.000 S0" …`
  (air on → off); `line 13 "M8" …`, `line 16 "G0 X10.000 Y10.000 S0" …` (air off → on);
  `line 13 "G1 X33.000 S0" drains with M3 S500 lit` (`grbl-compatible` raster, overscan 0);
  `line 16 "M5" drains with M3 S800 lit` (constant cut, then image layer). The checker's
  coincident-move rule models GRBL 1.1h/grblHAL (FluidNC has none); the other rules hold on all three.
- **fix:**
  1. *local:* do not re-arm between passes of one group (`grbl-strategy.ts:195`): the mode cannot
     change inside a group and every positioning move already carries `S0` — the reasoning
     ADR-341 Amendment 1 §2 already applied to derived output. This also removes the per-pass
     `M5 I`/`M3 I S0` (Marlin) and `M400`/`M221` (Smoothieware) pairs derived from it.
  2. *local:* skip a laser-off seek whose formatted target equals the head position (mirror
     `:142`), and do not write the raster row close when it has zero length (the next line is
     already an `S0` move or the trailing `M5`). Consider a minimum move length for sub-step moves.
  3. *needs decision:* write inter-layer mode and air changes (`grbl-strategy.ts:477-491`, the
     raster header `emit-raster.ts:115-116`) after the next layer's first non-zero laser-off move,
     so the drain happens dark and the air is on before the first burn. Where the next layer starts
     exactly where the last burn ended, and at the job end, no dark move exists: accepting the stop,
     adding a short laser-off move, or (at the end) running the park move before `M5`/`M9` is a
     product choice. The change alters the 4040's byte stream, which `gcode-dialects.ts:152-154`
     keeps "exactly as qualified"; the maintainer should confirm.
  (The first session's "emit `M5` before `M9` at the job end" does not help: either order drains
  with the beam lit. Dropped.)

## OR-2 — CNC pass recovery marks passes "proven complete" that may still have been queued

- **severity:** medium (the default re-entry can plunge a later, deeper pass into stock that the
  skipped passes never cleared; the final confirmation still says omitted passes must be complete).
- **verdict:** CONFIRMED (repro + firmware setting ranges). **status:** new.
- **failure scenario:** CNC job on grblHAL with `$398` planner blocks above 256 (valid 30-1000; a
  maintainer's grblHAL-family Falcon A1 Pro reported `Bf:512,65535`, recorded as informal in
  `src/core/devices/falcon-profiles.ts:19-20`) or FluidNC with
  `planner_blocks` above 64 (valid 10-120) is stopped. Recovery subtracts a fixed 256/64 lines from
  the acknowledged count, marks the earlier passes ✓ "proven-complete", preselects a later pass as
  the "computed safe boundary", and the late-pick warning claims "Controller acknowledgements only
  prove execution up to operation …". Those passes may never have run.
- **kerfdesk evidence:** `src/core/recovery/cnc-resume-point.ts:40-41` `grblhal: 256,` `fluidnc: 64,`;
  `:82-83` `const reserve = CNC_RESUME_PLANNER_RESERVE_LINES[args.controllerKind];` `const proven = Math.max(0, acked - reserve, …)`;
  `:93` `provenCompletePassCount: spans.filter((span) => span.lastRawLine < firstUnprovenRawLine).length,`;
  `src/ui/laser/cnc-pass-recovery-model.ts:151` `if (isBefore(pass, resumePoint)) return 'proven-complete';`;
  `src/ui/laser/CncPassRecoveryWizard.tsx:219` `if (status === 'proven-complete') return '✓';`;
  `src/ui/laser/cnc-pass-recovery-review.ts:103` `Controller acknowledgements only prove execution up to operation …`.
  The resolver's own comment (`cnc-resume-point.ts:34-36`) calls the operator's "everything before
  the boundary is complete" confirmation "the load-bearing check on such rigs", but the checklist
  (`CncPassRecoveryChecklist.tsx:22-41`) has no such item and the wizard asks for one only for a
  boundary later than the default (`CncPassRecoveryWizard.tsx:200-205`). The measured planner size
  is not used: `cncPassRecoveryDefaultPoint` (`cnc-pass-recovery-model.ts:46-59`) passes no planner
  evidence, although idle `Bf` capacity is recorded for lasers (`laser-rx-capacity-evidence.ts:89-103`)
  and `$I` planner blocks are parsed (`src/core/controllers/grbl/build-info.ts:95-104`).
- **upstream evidence:** grblHAL `settings.c:2485`
  `{ Setting_PlannerBlocks, Group_General, "Planner buffer blocks", NULL, Format_Int16, "####0", "30", "1000", …`
  (https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2485),
  `config.h:906` `#define DEFAULT_PLANNER_BUFFER_BLOCKS 100`, `planner.c:230`
  `block_buffer.size = settings.planner_buffer_blocks;`. FluidNC v4.0.3
  `Machine/MachineConfig.cpp:89` `handler.item("planner_blocks", _planner_blocks, 10, 120);`
  (https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Machine/MachineConfig.cpp#L89),
  `Planner.cpp:445` `return (config->_planner_blocks - 1) - (block_buffer_head - block_buffer_tail);`.
  A line is acknowledged after it is queued: GRBL `motion_control.c:60-68` waits for planner room,
  then `plan_buffer_line`; `protocol.c:104` `report_status_message(gc_execute_line(line));`.
- **reproduction:** `src/__audit_repro__/OR/cnc-resume-planner-reserve.test.ts` — 2 tests FAIL:
  grblHAL 400 blocks → `pass 3 (raw 100-142)`, `pass 4 (raw 143-185)`, `pass 5 (raw 186-228)`
  marked proven though they may not have run; FluidNC 120 → `pass 10 (raw 401-443)`.
- **fix (local):** bound the rewind by the controller's measured planner (idle `Bf`, `$I`, FluidNC
  `planner_blocks` from `$CD`) recorded with the run, else by the firmware maximum (grblHAL 1000,
  FluidNC 119 usable) plus its segment buffer; label passes "proven" only below that bound.

## OR-3 — Automatic laser restart skips moves a stop discarded when no usable `Bf` backlog exists

- **severity:** medium (up to 15 acknowledged moves on stock GRBL or FluidNC, up to about 32 on
  Smoothieware, restart after the point where the burn really stopped; the picker's hint only says
  progress "can be ahead").
- **verdict:** CONFIRMED (repro). **status:** incomplete fix of ADR-362 item 8.
- **failure scenario:** a laser job stopped by Abort, an auto-abort after a rejected line, or a
  reboot. The reset discards every acknowledged, unexecuted move. ADR-362 steps the automatic
  restart back only by the backlog read from a `Bf:` status field, so:
  1. stock GRBL 1.1h and stock FluidNC report no `Bf` (both default `$10=1`) → no step back;
  2. Smoothieware never reports a buffer field; KerfDesk's Abort sends `^X`, Smoothie halts and
     flushes its 32-block queue → no step back;
  3. with `Bf`, a last report that happened to show an empty planner (for example, answered right
     after a planner drain) is treated as "no backlog", so every move acknowledged after that
     report is skipped.
- **kerfdesk evidence:** `src/ui/state/laser-rx-capacity-evidence.ts:144-145` "The planner size comes
  from this session's idle `Bf`. Without it the backlog is unknown and no snapshot is taken",
  `:165-166` `const capacity = currentPlannerCapacityEvidence(state)?.plannerBlocksFree;` `if (capacity === undefined) return {};`;
  `src/ui/app/checkpoint-interruption.ts:62` `if (snapshot.queuedBlocks === 0) return undefined;`;
  `src/core/recovery/automatic-restart-line.ts:75-76` `const backlog = interruption?.plannerBacklog;` `if (backlog === undefined) return restart;`;
  `src/core/controllers/smoothieware/driver.ts:59` `softReset: RT_SOFT_RESET,` (Abort writes it:
  `src/ui/state/laser-job-actions.ts:309` `const resetWrite = safeWrite(softReset, 'stop');`);
  `$10=1` is accepted as normal (`src/core/controllers/grbl/machine-envelope.ts:57`) and is the
  simulator default (`src/__fixtures__/controllers/grbl-sim-settings.ts:12` `[10, '1'], // status report mask: MPos`).
  The `$I` planner size is parsed (`build-info.ts:95-104`) but unused here.
- **upstream evidence:**
  - GRBL `grbl/defaults.h:50` `#define DEFAULT_STATUS_REPORT_MASK 1 // MPos enabled`;
    `grbl/report.c:531-535` `if (bit_istrue(settings.status_report_mask,BITFLAG_RT_STATUS_BUFFER_STATE)) {` `printPgmString(PSTR("|Bf:"));`
    (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c#L529-L538);
    `grbl/planner.h:31` `#define BLOCK_BUFFER_SIZE 16`, `planner.c:500` (15 usable);
    `grbl/main.c:94` `plan_reset(); // Clear block buffer and planner variables`. Wiki
    Grbl-v1.1-Configuration: "the default report with machine position and no buffer data reports
    setting is `$10=1`" (https://github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration).
  - FluidNC v4.0.3 `FluidNC/src/SettingsDefinitions.cpp:101`
    `status_mask = new IntSetting("What to include in status report", GRBL, WG, "10", "Report/Status", 1, 0, 3);`
    (https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/SettingsDefinitions.cpp#L101),
    `Report.cpp:512-513` `if (bits_are_true(status_mask->get(), RtStatus::Buffer)) {` `msg << "|Bf:" …`,
    `Machine/MachineConfig.h:98` `int32_t _planner_blocks = 16;`.
  - Smoothieware `src/libs/Kernel.cpp:177-334` (status string: MPos, WPos, F, L, S; no buffer field);
    `src/modules/communication/GcodeDispatch.cpp:383` `THEKERNEL->call_event(ON_GCODE_RECEIVED, gcode );`
    then `ok` at `:414-418`; `src/modules/robot/Conveyor.cpp:161` `while (queue.is_full() && !THEKERNEL->is_halted()) {`
    (a G1 returns only once queued), `:77` `…->by_default(32)->as_number();`, `:89-93` `void Conveyor::on_halt(void* argument)` … `flush_queue();`
    (https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Conveyor.cpp#L77-L96);
    `src/libs/USBDevice/USBSerial/USBSerial.cpp:204-206` `if(b == 'X' - 'A' + 1) { // ^X` … `halt_flag = true;`,
    `:304-306` `THEKERNEL->call_event(ON_HALT, nullptr);`.
  - grblHAL is not affected by default: `config.h:627-628` `#define DEFAULT_REPORT_BUFFER_STATE On`.
- **reproduction:** `src/__audit_repro__/OR/abort-restart-without-bf.test.ts` — 3 tests FAIL:
  stock GRBL report without `Bf` → restart line 36, expected ≤ 21; empty-planner report at 20
  acknowledged lines, Abort at 35 → 36, expected ≤ 21; Smoothieware report → 43, expected ≤ 11.
- **fix (local):** for a planner-discarding stop without a non-zero `Bf` backlog, step back by the
  controller's planner size: `$I` blocks where reported, else a per-family default (GRBL 15,
  FluidNC 15 default, Smoothieware 32 default) — as CNC recovery already does with its reserve.
  Treat an empty-planner report as "frontier = lines acknowledged at that report", not as no
  information. Optionally add the segment-buffer lag (GRBL `SEGMENT_BUFFER_SIZE 6`, `stepper.h:26`).

## OR-4 — xTool D1 Pro profiles drive `$J=` jog and Frame although xTool's device file turns `$J` off

- **severity:** medium if the firmware rejects `$J=` (every Frame is built from `$J=` lines, so no
  Frame completes and Start never unlocks; jog fails too; nothing moves). **verdict:** PLAUSIBLE —
  the xTool firmware is closed and no public source settles whether it accepts `$J=`.
  **status:** new.
- **kerfdesk evidence:** `src/core/devices/brand-laser-profiles.ts:65-69` records xTool's LightBurn
  file (`"EnableGrblJCommand": false`), and `:83` tells the operator "disables $J jogging; confirm
  jogging on your firmware", but the profile has no command-set override, so
  `src/core/controllers/select-controller-driver.ts:26-29` returns `grblDriver`, whose
  `src/core/controllers/grbl/driver.ts:85-86` are `buildJog: buildJogCommand,`
  `buildFrameLines: buildGrblFrameJogLines,`. The Falcon profile honours the same vendor field
  through `src/core/controllers/falcon-command-contract.ts:5-21` (`jog: 'gcode-relative'`,
  `buildFrameLines: buildFalconFrame` at `:35`).
- **upstream/public evidence:**
  - xTool's `xTool-D1ProV3.lbdev` (https://xtool.zendesk.com/hc/article_attachments/7316804567447/xTool-D1ProV3.lbdev):
    `"EnableGrblJCommand": false`, `"BaudRate": 230400`, `"S_Scale": 1000`, `"MirrorY": true` — read
    by the first session (sha256 `d03e3021…`, recorded in `OR-partial.md`) and by the catalog
    authors (the source comment above). Not re-fetchable this session (egress blocked).
  - A community D1 Pro device file, fetched this session from
    https://raw.githubusercontent.com/1RandomDev/xTool-Connect/940df33985b3336472b74fec152976538793aaf5/xTool-D1-Pro.lbdev
    (sha256 `22cf5a7c39680fa4b344ef3aab6b840bbc8a855a7fca1822e6708edf8afd91a3`), line 74:
    `"EnableGrblJCommand": false,` — a derivative of xTool's template, so it repeats the setting
    rather than proving firmware behaviour. Its protocol notes
    (`XTOOL_PROTOCOL.md` at the same commit) cover the Wi-Fi API and do not mention `$J`.
  - GitHub issue search for xTool `$J` jog errors: no results. xtool.zendesk.com,
    support.xtool.com, www.xtool.com, forum.lightburnsoftware.com (threads "Can't Jog Xtool D1",
    "Enable $J Jogging") and docs.lightburnsoftware.com were blocked by this session's egress
    proxy, so no forum statement could be read or quoted.
- **reproduction:** traced only.
- **fix (needs decision):** give the xTool profiles the relative-`G1` jog/Frame contract the Falcon
  uses (a second command set), or keep `$J=` and state in Machine Setup that Frame depends on it;
  settle it with one hardware check.

## OR-5 — LightBurn `.lbdev` import cannot read real (JSON) device files

- **severity:** low (fails closed, with a wrong reason). **verdict:** CONFIRMED (repro). **status:** new.
- **failure scenario:** importing a vendor LightBurn device file in Machine Setup ("Import
  LightBurn .lbdev") returns "missing bed width or height"; real files are JSON
  (`{"DeviceList":[{… "Width": 430, "Height": 400, "MirrorY": true, "Settings": {"S_Scale": 1000, "BaudRate": 230400, …}}]}`),
  and the importer only matches XML tags, several of them invented (`<SMax>`, `<Origin>`).
- **kerfdesk evidence:** `src/io/lightburn/lbdev-import.ts:74-81` (`extractFirst(text, ['Width', …])` →
  `return { kind: 'invalid', reason: 'missing bed width or height' };`), `:228`
  `` new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i') ``; the tests use an invented XML
  sample (`lbdev-import.test.ts:4-16`); reachable from `src/ui/laser/MachineSetupImportExport.tsx:70-79`.
- **upstream evidence:** the community D1 Pro file above (JSON, fetched this session:
  `"DeviceList"`, `"Width": 430`, `"Height": 400`, `"MirrorY": true`, `"S_Scale": 1000`,
  `"BaudRate": 230400`); xTool's official file (first session); Creality's Falcon bundle keys in
  `docs/audits/2026-09-19-machine-compatibility-fixes/falcon-vendor-configuration.json:9-16`
  (`"Width": 358`, `"Height": 268`, `"BaudRate": 115200`, `"S_Scale": 1000`, `"EnableGrblJCommand": false`).
- **reproduction:** `src/__audit_repro__/OR/lbdev-json-import.test.ts` — FAILS
  (`expected 'invalid' to be 'review'`).
- **fix (local):** parse the JSON `DeviceList[]` form (Width, Height, `Settings.S_Scale`,
  `Settings.BaudRate`, MirrorX/MirrorY → origin, `Settings.AirAssistM7`, `EnableGrblJCommand`),
  keep the review step, and replace the invented XML fixture with a real file's shape.

## OR-6 — `$32`/`$30` advice is not actionable on FluidNC, where those settings are read-only

- **severity:** low (the job fails closed at the preamble's `M4 S0`, before motion; the advice
  sends the operator the wrong way). **verdict:** CONFIRMED (trace). **status:** new.
- **failure scenario:** FluidNC with a `PWM` spindle (no direction pin, not `Laser`) reports
  `$32=0`. Job Review says "Enable GRBL laser mode ($32=1)", but FluidNC's `$32` is a read-only
  proxy of the spindle type, and the default `grbl-dynamic` preamble's `M4 S0` is rejected with
  `error:20`, so the stream stops at line 5. The real remedies (a `Laser` spindle in the YAML, or a
  constant-power dialect) are not named. The CNC twins are equally unactionable there: "Set $32=0
  for spindle work" and "Set $30=… (or update the machine profile)" (FluidNC `$30` is the spindle
  `speed_map` maximum; only the profile half of that advice works). The driver itself knows this
  (`src/core/controllers/fluidnc/driver.ts:1-5`: "numeric `$N=value` writes are legacy-mapped or
  ignored by FluidNC"). Cosmetic, same file: `controller-readiness.ts:121-122` says Start "treats
  this reported contradiction as a refusal", but `src/ui/laser/start-job-controller-policy.ts:26-30`
  turns every readiness error into a Job Review advisory.
- **kerfdesk evidence:** `src/core/preflight/controller-readiness.ts:231-236`
  (`'Controller reports $32=0. Enable GRBL laser mode ($32=1) before starting from KerfDesk.'`),
  `:178-183`, `:156-160`; `src/core/output/grbl-strategy.ts:86` (preamble `M4 S0` for the default dialect).
- **upstream evidence:** FluidNC v4.0.3 `FluidNC/src/SettingsDefinitions.cpp:146`
  `INT_PROXY("32", "Grbl/LaserMode", spindle->isRateAdjusted())`, `:148`
  `INT_PROXY("30", "Grbl/MaxSpindleSpeed", spindle->maxSpeed())`
  (https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/SettingsDefinitions.cpp#L146-L148);
  `Settings.h:229` `Error setStringValue(std::string_view value) override { return Error::ReadOnlySetting; }`;
  `GCode.cpp:654-658` `case 4:  // Supported if the spindle can be reversed or laser mode is on.`
  `if (spindle->is_reversable || spindle->isRateAdjusted()) {` … `return Error::GcodeUnsupportedCommand;`
  (https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/GCode.cpp#L654-L659);
  `Spindles/PWMSpindle.cpp:20` `is_reversable = _direction_pin.defined();`;
  `Spindles/LaserSpindle.cpp:16-17` `bool Laser::isRateAdjusted() {` `return true;`;
  `Error.h:33` `GcodeUnsupportedCommand = 20,`. (grblHAL `gcode.c:2640-2641` rejects `M4` without
  direction or laser capability too, but there `$32=1` is a writable setting and the advice fits.)
- **reproduction:** traced only.
- **fix (local):** FluidNC-specific wording (configure a `Laser` spindle, or choose a
  constant-power dialect; set `speed_map` rather than `$30`), and correct the comment.

---

## Checked and correct

- **The default `grbl-dynamic` (M4) output is not exposed to OR-1.** GRBL computes the M4 PWM from
  the segment's end speed (`stepper.c:962` `if (st_prep_block->is_pwm_rate_adjusted) { rpm *= (prep.current_speed * prep.inv_rate); }`),
  which is 0 at a stop, and switches it off at an empty buffer (`stepper.c:397`); grblHAL
  `stepper.c:570`, FluidNC `Stepper.cpp:238`. The coincident-move sync applies to M3 only (GRBL
  `motion_control.c:72` `if (pl_data->condition & PL_COND_FLAG_SPINDLE_CW)`). Note: the per-pass
  `M4 S0` re-arm still drains the planner (GRBL `gcode.c:917-923` syncs any enabled spindle, despite
  the wiki's "`M4` does not stop for anything but a spindle state change"), but the beam is dark at
  that stop, so it costs time only.
- **Catalog output, re-run this session:** every GRBL-family catalog profile's program (cut with
  air, two passes, plus an image layer at full S) uses only G0, G1, G21, G54, G90, G94, M3, M4, M5,
  M8, M9; the longest executable line is 31 characters (GRBL `protocol.h:32` `#define LINE_BUFFER_SIZE 80`);
  the largest S equals the profile's S maximum; every G0 carries `S0`, and the 4040 uses no G0
  (controlled `G1 … F800 S0` seeks).
- **GRBL-family resume preamble drains dark:** `M5` precedes the air words and the re-entry move
  (`src/core/controllers/grbl/resume-program.ts:253-263`), so the `[7]`/`[8]` syncs it causes
  (GRBL `gcode.c:946`, `:955`) happen with the beam off, and the air on-delay of grblHAL/FluidNC
  runs dark; the re-arm follows `G0 X Y S0`.
- **Resume tail after the `G0` re-entry:** transform 2+ names the program's motion mode on the first
  line that relies on it (`laser-resume-reentry.ts:62-101`), so a compact raster tail is not run as
  G0 (GRBL motion mode is modal, `gcode.c:1048`).
- **Marlin Abort does not discard the planner** (queued `M5 I`/`M107` behind accepted motion,
  `src/ui/state/laser-job-actions.ts:314-327`; no realtime reset), so its restart at the first
  unacknowledged line is right for recovery purposes (whether that stop stops is the MA track's).
- **grblHAL reports `Bf` by default** (`config.h:627-628`), so OR-3 does not affect stock grblHAL;
  with a non-zero backlog the step-back is correct up to the segment-buffer lag (GRBL
  `planner.c:500`, grblHAL `planner.c:697-702`).
- **CNC dwell units:** `G4 P` is seconds on GRBL (`motion_control.c:195` `void mc_dwell(float seconds)`),
  grblHAL (`motion_control.c:853` `void mc_dwell (float seconds)`) and FluidNC
  (`GCode.cpp:1804` `mc_dwell(int32_t(gc_block.values.p * 1000.0f));`), matching the CNC emitter's
  `G4 P<seconds>` (`src/core/output/cnc-grbl-transitions.ts:128`).
- **CNC reserve for stock GRBL** (32 lines, `cnc-resume-point.ts:39`) covers 15 planner blocks
  (`planner.h:31`, `planner.c:500`) plus the 6-segment buffer (`stepper.h:26`).
- **No new CNC GRBL emitter defects** beyond the 2026-09-24 CNC audit: modal restatement after M0,
  spindle start after a safe-Z retract, coolant after spin-up, `G17` for arcs and `G4` units hold
  on GRBL, grblHAL and FluidNC.
- **Profile values** (first session, not re-fetched): Ortur LM3 (400x400 / 400x380, S0-1000,
  115200) and Sculpfun S30 (380x385, M8) match vendor pages; Falcon A1 Pro matches the recorded
  Creality bundle; FluidNC default S255 (`LaserSpindle.cpp`) and `$30`/`$32` proxies
  (`SettingsDefinitions.cpp:146-148`); Marlin `CUTTER_POWER_UNIT PWM255` (`Configuration_adv.h:3372`)
  and `BAUDRATE 250000` (`Configuration.h:117`), both re-read this session.

## Not covered

- Hardware: no air cut or burn; the 4040's `$1`, steps/mm and the xTool firmware's `$J=` handling
  are unknown.
- Vendor and LightBurn web pages (xtool.zendesk.com, support.xtool.com, www.xtool.com,
  forum.lightburnsoftware.com, docs.lightburnsoftware.com, web.archive.org) were blocked by the
  session's egress proxy; only GitHub was reachable.
- How often real artwork produces sub-step or coincident moves (the first session's "2 of 572"
  sample was not re-run and is not relied on).
- The live time estimate: `WORKFLOW.md:1448-1449` says redundant `M3`/`M4`/`M7`/`M8`/`M9` re-arms
  "do not invent another stop", but an `M3 S0` after an `S800` burn is a planner drain on GRBL;
  the estimator code was not checked (out of this track).
- Marlin and Smoothieware power semantics beyond the OR-1 re-arm note (MA and SM tracks).
- `REJECTED_LINE_SEARCH_WINDOW = 256` (`automatic-restart-line.ts:18`) with a 4096-byte window
  and very short compact lines was traced only; no concrete failure was built.
- FYI for the lead: `tsc --noEmit` reports two errors in the MA track's repro files
  (`src/__audit_repro__/MA/ma-11-simulator-fidelity.test.ts:43`, `ma-7-abort-keeps-burning.test.ts:136`);
  the OR files are clean.

## Changes from `OR-partial.md`

- OR-1: the `$1` stationary dwell is GRBL 1.1h only (grblHAL defers its idle lock, FluidNC polls
  it); the coincident-move sync does not exist on FluidNC v4.0.3; two more emitted-line classes
  added and reproduced (the image layer's opening `M5`, the zero-length raster row close); the
  checker now counts M4 burns and passes lint; the job-end "`M5` before `M9`" fix dropped.
- OR-3: broadened from stock GRBL to stock FluidNC and Smoothieware, plus the empty-planner report
  case; two tests added.
- OR-4: severity raised from low to "medium if true" (the Frame, hence Start, would be blocked);
  still PLAUSIBLE.
- OR-6: extended to the CNC `$30` wording.
