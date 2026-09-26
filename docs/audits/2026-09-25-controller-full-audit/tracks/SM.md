# Track SM (Smoothieware) — final report

This report finishes the track that `SM-partial.md` began. That file is left as it was.

## How this was checked

- **Firmware source.** Smoothieware edge at 38e2cc083db0e4f768535a9bf2d32cdf104ea980. Citations
  use `https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/FILE#Lnn`.
- **Firmware history.** A blobless clone of the edge branch (`git log -S`). Commit ids are given in
  full where they matter.
- **Shipped binary (SM-7 only).** `FirmwareBin/firmware.bin` at the pinned revision (md5
  `ded5f86a99235c483e7f7bcc683dcf84`, last rebuilt by 620e1622, 2026-04-17). I disassembled it
  with `arm-none-eabi-objdump` (raw Thumb, base 0x4000).
- **Compiler check (SM-7 only).** The planner line compiled with Ubuntu `gcc-arm-none-eabi` 13.2.1
  and the build's own flags (`-O2 -mcpu=cortex-m3 -mthumb -mthumb-interwork -std=gnu++11`:
  `build/common.mk` L193-L200, `build/lpc1768.mk` L25-L26).
- **Official docs.** The sandbox proxy blocks smoothieware.org, so I read the site's source,
  `Smoothieware/smoothieware-website-v1` at ab8f6dc196603dd9dfd28e4e2e1af11d7c22e1bb.
- **KerfDesk.** Checkout at e2e323b (branch `claude/focused-tesla-kb5if0`). The code is unchanged
  at b44410a, which added only a docs file.
- **Reproductions.** Tests in `src/__audit_repro__/SM/`, run with
  `pnpm vitest run src/__audit_repro__/SM/<file>`. Each test that demonstrates a defect fails on
  current code.
- **Hardware.** None was available.

## Summary

| id | severity | verdict | status | title |
|---|---|---|---|---|
| SM-1 | high | CONFIRMED (repro) | new; overlaps CG-1 | Absolute jobs run displaced by a G92 origin Smoothieware still holds |
| SM-7 | medium | CONFIRMED (repro + source + shipped binary) | new; ADR-322 §3 rule wrong for S ≥ 2 | Any Full-power S of 2 or more is silently mangled by the firmware's 12-bit S field |
| SM-6 | medium | CONFIRMED (repro) | new | Home is confirmed on a board whose `$H` homed nothing |
| SM-3 | medium | CONFIRMED (repro, 2 tests) | new | `fire off` is never answered without the Laser module: Jog, Frame, Home and Start wedge |
| SM-2 | medium | CONFIRMED (upstream history; traced only) | new; gap in ADR-322 §3 | Constant-power layers run speed-proportional on Smoothieware built before 2021-06-15 |
| SM-5 | low | CONFIRMED (repro, 2 tests) | incomplete fix of ADR-361 item 6 | A stopped Frame leaves its framing feed as the G0 seek rate |
| SM-8 | low | CONFIRMED (repro) | new | Unsolicited `ALARM:` lines are booked as a rejection of an innocent line |
| SM-9 | low | CONFIRMED (traced) | new | The Laser window status row misreads the Smoothieware report |
| SM-4 | low | CONFIRMED (comparison) | new | The Smoothieware simulator is more forgiving than the firmware and hides SM-1/3/6/7/8 and CG-3 |

Nothing was dropped. The partial is corrected in three places:

- **SM-5 is broader than "Abort or halt".** An ordinary Stop (Ctrl/Cmd+.) during a Frame also
  leaks the framing feed.
- **SM-3 is broader than "after a jog".** Home by itself times out after 120 s.
- **SM-1 had wrong line numbers.** The corrected ones are in its evidence below.

---

## Findings (most severe first)

### SM-1 — Absolute jobs run displaced by a G92 origin Smoothieware still holds

- **severity:** high. This is wrong physical output. The bounds preflight uses a zero offset, so
  the job can run past the travel envelope.
- **verdict:** CONFIRMED (repro fails on current code).
- **status:** new.
  - Same root cause as CG-1: KerfDesk takes a work offset only from `WCO:`. CG-1's third bullet is
    this Smoothieware Absolute case.
  - CG's "Fix order" section already pairs CG-1 + SM-1 as one local fix. Detail here is the
    Smoothieware paths that make KerfDesk forget the origin.
- **failure scenario:**
  1. The board holds a G92 origin. Either:
     - the operator used Set origin here (`G92 X0 Y0`) at machine X110 Y60; or
     - the board booted with one (`set_g92` in config, or `save_g92` plus an earlier `M500`).
  2. Then any of these happens:
     - reconnect (page reload, cable replug, app restart), or connect for the first time;
     - Abort, kill or limit halt, followed by Unlock (M999);
     - Unlock followed by Home.
  3. Smoothieware still applies the G92. Every `?` report shows WPos = MPos − (110, 60). KerfDesk
     believes there is no origin.
  4. Absolute placement resolves `{ ok: true }` with no offset. Absolute is the default for a
     homing profile (`src/ui/job-placement.ts:37`).
  5. The Frame and the job are emitted in bed coordinates, and the board adds the stale G92.
     Everything lands 110/60 mm away.
  6. The canvas head and the Frame proof use WPos, so every on-screen position looks right. The
     only physical cue is the Frame tracing in the wrong place.
- **kerfdesk evidence:**
  - `src/ui/state/laser-status-position.ts:51-53` learns an offset only from `WCO:`:
    `if (report.wco === null) {` / `return { statusReport: report, ...ovPatch, ...accessoryPatch, ...airPatch };`
  - `src/ui/state/laser-status-line.ts:319-343` `originUnknownAfterControllerReset`. The comment
    reads "After an alarm or reset the controller has dropped G92". A `'g92'` origin becomes
    `workOriginActive: false, workOriginSource: 'none'` (L337-L342). It is applied:
    - on every Alarm or Sleep report (L279);
    - by Abort (`src/ui/state/laser-job-actions.ts:339`).
  - `src/ui/state/laser-console-completion.ts:78-89` `controllerUnlockedPatch` sets
    `workOriginActive: persistentOrUnknown, workOriginSource: persistentOrUnknown ? 'unknown' : 'none'`.
    Unlock (M999) applies it (`src/ui/state/laser-autofocus-actions.ts:44`
    `set(controllerUnlockedPatch);`).
  - `src/ui/state/laser-connection-actions.ts:236-237`: every connect starts with
    `workOriginActive: false, workOriginSource: 'none',`.
  - `src/ui/state/laser-home-action.ts:110-114`: Home keeps only an origin KerfDesk still knows.
  - `src/ui/job-placement.ts:208-219` `resolveAbsolute`:
    `const wco = knownWco(machine); if (wco !== null) return { ok: true, preflightMotionOffset: xyOffset(wco) }; if (!customOriginIsActive(machine)) return { ok: true };`
    `trustedMotionOffsetForPreflight` (L154-L172) then has no offset.
  - `src/ui/state/canvas-motion-plan.ts:367`: the canvas head is WPos.
    `if (report.wPos !== null) return normalized(report.wPos, reportInches);`
- **upstream evidence:**
  - **Only a G92 command changes the offset.** `src/modules/robot/Robot.cpp#L624-L661`: G92.1,
    G92.2 or a bare `G92` do `g92_offset = wcs_t(0, 0, 0);`, and `G92 X Y` sets
    `g92_offset = wcs_t(x, y, z);`.
    https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L624-L661
  - **Robot has no halt handler.** Robot registers only `this->register_for_event(ON_GCODE_RECEIVED);`
    (`Robot.cpp#L131-L133`). So Ctrl-X, kill, limits, M999 and `$X` never touch g92_offset.
    `Kernel::call_event(ON_HALT)` only re-syncs positions:
    `this->robot->reset_position_from_current_actuator_position();`
    (`src/libs/Kernel.cpp#L358-L380`).
  - **Homing resets positions, not offsets.**
    `THEROBOT->reset_axis_position(p.homing_position + p.home_offset, p.axis_index);`
    (`src/modules/tools/endstops/Endstops.cpp#L962-L971`).
  - **A USB re-attach does not reset the board.** It only prints `puts("Smoothie\r\nok\r\n");`
    (`src/libs/USBDevice/USBSerial/USBSerial.cpp#L328-L333`).
  - **The board can boot holding a G92.**
    - `string g92 = THEKERNEL->config->value(set_g92_checksum)…`, then
      `g92_offset = wcs_t(t[0], t[1], t[2]);` (`Robot.cpp#L199-L205`).
    - With `save_g92`, M500 writes `G92.3 X%f Y%f Z%f` (`Robot.cpp#L985-L991`).
  - **Reports carry MPos and WPos, never WCO.** `str.append("|MPos:")` and
    `Robot::wcs_t pos = robot->mcs2wcs(mpos);` … `str.append("|WPos:")`, both taken from the same
    sample (`src/libs/Kernel.cpp#L207-L234` running, `#L262-L288` idle).
  - `mcs2wcs` subtracts the WCS offset, adds g92_offset and subtracts the tool offset (`Robot.cpp#L448-L456`).
- **reproduction:** `src/__audit_repro__/SM/sm-1-retained-g92-absolute.test.ts`. Both tests fail
  with `{"ok":true}: expected undefined to deeply equal { x: 110, y: 60 }`:
  - reconnect to a board that reports MPos 110/60 and WPos 0/0;
  - Set origin, halt, Unlock, Home, then the real post-home report.
- **fix:** local.
  - For a driver whose report has MPos and WPos but no WCO (Smoothieware), derive the work
    offset as MPos − WPos from the same report in `statusPositionPatch`. Feed `wcoCache` and
    `workOriginActive` exactly as a GRBL `WCO:` frame does. That value is the WCS offset minus
    g92_offset plus the tool offset: the same meaning as GRBL's WCO.
  - This re-learns the offset one poll after any reconnect, Alarm, Unlock or Home. That makes the
    `'g92'` → `'none'` resets harmless.
  - It also closes CG-1's Smoothieware half and the SM-9 origin row.

### SM-7 — Any Full-power S of 2 or more is silently mangled by the firmware's 12-bit S field

- **severity:** medium. The job is ruined but the failure is dark:
  - Every burn at a requested power ≥ 2/M fires far below it, and never above it. M is
    `laser_module_maximum_s_value`, which equals the profile's Full-power S.
  - It needs a non-default Full-power S. The setup wizard and the catalog both default to 1.
  - Smoothieware's own documentation recommends 100 or 255, and KerfDesk tells the operator to
    "match" the board.
- **verdict:** CONFIRMED. Upstream source, the shipped firmware binary, and a repro that models the
  firmware arithmetic all agree.
- **status:** new. ADR-322 §3 (`DECISIONS.md:20243-20245`, "The profile must match
  `laser_module_maximum_s_value`") is wrong for every value ≥ 2.
- **failure scenario:**
  1. A Smoothieware board is configured as the official docs suggest:
     `laser_module_maximum_s_value 255` ("S0-S255 range (common in laser software)") or 100.
  2. The operator follows KerfDesk's guide ("Match laser_module_maximum_s_value to the profile")
     and sets the profile's Full-power S to 255.
  3. The Smoothieware strategy emits S up to 255.
  4. The planner keeps S×2048 in 12 bits: `stored = round(S·2048) mod 4096`.
  5. The laser fires at `stored / 2048 / M`, which is below 2/M: at most 0.78 % at M=255, 2 % at
     M=100. Examples:
     - M=255, 50 % → `S127.5` fires at 0.59 %;
     - M=255, 100 % → `S255` fires at 0.39 %;
     - M=100, 50 % → `S50` fires at 0 %;
     - M=100, 75 % → `S75` fires at 1 %.
  6. KerfDesk's output, Job Review and Smoothieware's own `|S:` field (the modal float S) all show
     the requested value.
  7. Values of S below 2 are exact, so the default fractional profile (`maxPowerS: 1`) is correct.
- **kerfdesk evidence:**
  - `src/core/output/smoothieware-strategy.ts:36`
    `` return `S${formatPower((virtual / SMOOTHIE_VIRTUAL_MAX_POWER) * maxPowerS)}`; `` Every burn S
    is a fraction of the profile's `maxPowerS`.
  - `src/ui/laser/DeviceProfilePowerFields.tsx:37-41` `min={1}` `max={MAX_POWER_S}` (100000)
    `onCommit={(v) => update({ maxPowerS: Math.floor(v) })}`. Only integers ≥ 1 can be entered, so
    1 is the only representable Smoothieware value.
  - `src/core/devices/profile-catalog.ts:250` `requirePositive(profile.maxPowerS, 'maxPowerS', errors);`
    There is no Smoothieware bound. `controllerCompatibleProfile` does not touch `maxPowerS`
    either, so imported or saved profiles keep any value.
  - `src/ui/laser/device-setup/machine-setup-controller-guide.ts:99`
    `'Match laser_module_maximum_s_value to the profile and set laser_module_minimum_power to 0 …'`
    `src/core/devices/profile-catalog.ts:137` reads "match laser_module_maximum_s_value (default
    1.0) … Source checked 2026-09-19: https://smoothieware.org/laser.html".
  - The defaults are safe: `src/ui/laser/device-setup/device-setup-controller-selection.ts:31`
    `if (controllerKind === 'smoothieware') return 1;` and `profile-catalog.ts:130` `maxPowerS: 1,`.
  - The test oracle cannot see the defect. `src/__fixtures__/controllers/smoothie-laser-power-model.ts:10`
    says a "G1/G2/G3 block fires at s_value / laser_module_maximum_s_value x scale". There is no
    12-bit storage.
- **upstream evidence:**
  - **The field.** `src/modules/robot/Block.h#L81`
    `uint16_t s_value:12;                 // for laser 1.11 Fixed point`
    https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Block.h#L81
  - **The store.** `src/modules/robot/Planner.cpp#L81`
    `block->s_value = roundf(s_value*(1<<11)); // 1.11 fixed point`
    https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Planner.cpp#L81
  - **The raw G-code S reaches the planner.**
    - `Robot.cpp#L1034` `if(gcode->has_letter('S')) s_value = gcode->get_value('S');`
    - `Robot.cpp#L1466` `append_block( …, acceleration, s_value, is_g123)`
    - Nothing normalises S first. `laser_module_maximum_s_value` is read only at `Laser.cpp#L109`
      and used only at `#L246`.
  - **The read.** `src/modules/tools/laser/Laser.cpp#L246`
    `float requested_power = ((float)block->s_value / (1 << 11)) / this->laser_maximum_s_value; // s_value is 1.11 Fixed point`
    `set_laser_power` then clamps with `power = confine(power, 0.0F, 1.0F);` (`#L292`).
    https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp#L246
  - **The conversion in the shipped build (Cortex-M3, no FPU).** `FirmwareBin/firmware.bin` stores
    the field at 0x113e0-0x11408:
    - `mov.w r1, #1157627904 @ 0x45000000` (2048.0f)
    - `bl 0x49c40` (float multiply)
    - `bl 0x4acc0` (roundf)
    - `bl 0x4a044`, byte-for-byte libgcc 13.2's `__aeabi_f2uiz` (`fixunssfsi`)
    - `bfi r2, r1, #4, #1` (is_g123)
    - `bfi r3, r0, #0, #12` (s_value)
    - `strh.w r3, [r4, #82]`

    `__aeabi_f2uiz` returns 0 below 1.0, `0xffffffff` at or above 2^32, and an exact truncation in
    between. `bfi … #0, #12` keeps the low 12 bits. So on the shipped build
    `stored = round(S·2048) mod 4096` for 0 ≤ S < 2^21. The same C++ compiled with the build's
    flags gives the same `__aeabi_fmul` / `roundf` / `__aeabi_f2uiz` / `bfi #0, #12` sequence.
    In ISO C++ the float → uint16_t conversion is undefined for S ≥ 32, so no other compiler even
    has to wrap.
  - **The read in the shipped build.** `Laser::get_laser_power` at 0x23c80:
    - `ldrh.w r0, [r5, #82]`
    - `ubfx r0, r0, #0, #12`
    - `bl 0x49b90` (unsigned int to float)
    - `mov.w r1, #973078528 @ 0x3a000000` (1/2048)
    - `bl 0x49c40` (multiply)
    - `ldr r1, [r6, #20]` (laser_maximum_s_value), then `bl 0x49da8` (divide)
  - **History.**
    - 15ddf50f3217d25f847727101cfc652463866ccc (2016-02-29) "New laser module parameter
      laser_module_maximum_s_value sets range for PWM power control - S0 to Snnn". It divided the
      float G-code S at execution.
    - 5c749b4a3a053555dec50ec53487e4561dbaf14c (2016-07-31) "make s_value 1.11 fixed pointto use no
      extra memory in Block". It replaced `float s_value;` with the 12-bit field.

    Every build since August 2016 is affected.
    https://github.com/Smoothieware/Smoothieware/commit/5c749b4a3a053555dec50ec53487e4561dbaf14c
  - **The docs contradict the firmware.** `docs/modules/laser/laser-options-for-include.md` L83-L94
    in smoothieware-website-v1 at ab8f6dc1. The `/laser` page includes it
    (`laser-for-include.md` L165). It says:
    - "<raw>`255.0`</raw>: S0-S255 range (common in laser software)"
    - "The S-value is scaled to the 0-1 range internally based on this maximum."

    https://github.com/Smoothieware/smoothieware-website-v1/blob/ab8f6dc196603dd9dfd28e4e2e1af11d7c22e1bb/docs/modules/laser/laser-options-for-include.md#L83-L94
  - **SmoothieV2 (outside the pinned scope).** It carries the same `uint16_t s_value: 12;` and
    `roundf(s_value*(1<<11))` in `Firmware/src/robot/Block.h` and `Planner.cpp` (commit 2a21c010).
- **reproduction:** `src/__audit_repro__/SM/sm-7-smoothie-s-above-two.test.ts`. It uses the real
  Smoothieware strategy and models the store and read exactly as above.
  - maxPowerS=100 fails: `S50: expected +0 to be close to 0.5`.
  - maxPowerS=255 fails: `S127.5: expected 0.0058823529411764705 to be close to 0.5`.
  - The control, maxPowerS=1, passes.
- **fix:** local.
  1. Change the guide text, the profile note and ADR-322 §3: tell the operator to set
     `laser_module_maximum_s_value 1.0`, because Smoothieware stores S in 1.11 fixed point and any
     value ≥ 2 cannot work. Drop the instruction to "match the profile".
  2. For controllerKind `smoothieware`, keep Full-power S at 1. Either lock the field or have profile
     validation reject values ≥ 2 with that reason. This is a profile correction, not a Start
     guard.
  3. For saved profiles that already hold ≥ 2, show a Job Review warning. Whether to migrate them
     is a product decision: ADR-322 §6 says saved values are not migrated silently.
  4. Teach `smoothie-laser-power-model.ts` the 12-bit storage.

### SM-6 — Home is confirmed on a board whose `$H` homed nothing

- **severity:** medium. This is "wrong machine state accepted as proof", which the brief's scale
  would put at high. I rate it medium for two reasons:
  - it needs a board whose homing is not configured while the profile says homing is enabled;
  - the Frame traces the real position before Start.

  Rate it high if the proof matters more than the narrow setup.
- **verdict:** CONFIRMED (repro).
- **status:** new.
- **failure scenario:**
  1. The profile has homing enabled; the Home button exists only then
     (`src/ui/laser/JobSetupControls.tsx:68-79`).
  2. The Smoothieware board cannot home X and Y. Either:
     - the Endstops module is absent (no endstop pins configured, so the module deletes itself); or
     - it loaded without a homing pin for X or Y (limit-only pins, or one axis wired).
  3. Home sends `M400`, the tool-off lines and `$H`.
  4. SimpleShell dispatches G28 (or G28.2 in grbl mode). Nothing homes: either silence, or
     `WARNING: Nothing to home`, or only the axis that has a pin homes.
  5. SimpleShell then prints `ok`. The `M400` marker returns `ok` and the next report is Idle.
  6. KerfDesk logs "Homing confirmed after fresh Idle." and stores a session homing proof. Then:
     - the camera overlay says "Machine position is trusted from Home.";
     - jog bounds and no-go comparisons are switched off;
     - Absolute, the default for a homing profile, runs relative to wherever the head was at
       power-on.

  GRBL refuses `$H` with `error:5` when homing is disabled (gnea/grbl `grbl/system.c#L179-L180`
  `if (bit_isfalse(settings.flags,BITFLAG_HOMING_ENABLE)) {return(STATUS_SETTING_DISABLED); }`).
  KerfDesk treats that as a refused Home. Smoothieware gives no such answer.
- **kerfdesk evidence:**
  - `src/core/controllers/smoothieware/driver.ts:67`
    `home: ['M400', ...SMOOTHIE_FRAME_TOOL_OFF_LINES, SMOOTHIE_CMD_HOME].join('\n'),`
    and `commands.ts:18` `export const SMOOTHIE_CMD_HOME = '$H';`.
  - `src/ui/state/laser-home-action.ts:150-176`:
    - each line waits for its ack;
    - then the `settleDwell` marker (M400);
    - then `waitForFreshIdle(refs, { kind: 'home', requiredReports: 1 })`.

    Nothing asks the firmware whether it homed. `:187-198` `confirmHome`:
    `homingState: 'confirmed',` … `'[lf2] Homing confirmed after fresh Idle.'`.
  - `src/core/controllers/smoothieware/response.ts:48`: `WARNING: Nothing to home` is `unknown`, not a refusal.
  - What the false proof changes:
    - `src/ui/state/laser-jog-warnings.ts:62`
      `return state.homingState === 'confirmed' ? null : path;` turns off the jog bounds and no-go
      comparison. A never-homed machine keeps the power-on convention and is compared.
    - `src/ui/camera/use-camera-placement-controls.ts:53-55` with
      `src/ui/camera/OverlayControls.tsx:195` shows `'Machine position is trusted from Home.'`.
    - `src/ui/job-placement.ts:37` `startFrom: device.homing.enabled ? 'absolute' : 'user-origin',`
- **upstream evidence:**
  - **`$H` always answers `ok`.** `src/modules/utils/simpleshell/SimpleShell.cpp#L241-L252`:
    `case 'H':` … `Gcode gcode("G28", new_message.stream); THEKERNEL->call_event(ON_GCODE_RECEIVED, &gcode);`
    … `new_message.stream->printf("ok\n");`. The `ok` is unconditional.
    https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/utils/simpleshell/SimpleShell.cpp#L241-L252
  - **Without pins the module is gone.** `src/modules/tools/endstops/Endstops.cpp#L114-L129`:
    `if(!load_config()) { delete this; return; }`. Both loaders `return false` when
    `endstops.empty()` (`#L206`, `#L339`).
  - **Without a homing pin, nothing homes.** `Endstops.cpp#L849-L852`
    `if(haxis.none()) { THEKERNEL->streams->printf("WARNING: Nothing to home\n"); return; }`
  - **Only Endstops handles G28.** `Endstops.cpp#L1046` `if ( gcode->has_g && gcode->g == 28) {`.
    GcodeDispatch's `case 28` is M28 upload; Player only clears a suspend.
  - **`?` shows `Home` only while Endstops is homing.** `src/libs/Kernel.cpp#L181-L196`
    `bool ok = PublicData::get_value(endstops_checksum, get_homing_status_checksum, 0, &homing); if(!ok) homing = false;`
  - **The firmware can report homed axes.** G28.6
    `gcode->stream->printf("%c:%d ", p.axis, p.homed);`, one entry per axis that has a homing pin
    (`Endstops.cpp#L1114-L1120`). It was added in fdfa00d2bb063e73e47a04b60688fe919e78a943
    (2016-10-01). The homed flag "stays set once set until H/W reset or unhomed" (`#L957-L958`),
    and a failed cycle clears it (`#L902`).
- **reproduction:** `src/__audit_repro__/SM/sm-6-home-without-endstops-module.test.ts`. In the
  simulator `$H` is answered `ok` at once and nothing moves (no Endstops module). The test fails:
  `expected 'confirmed' not to be 'confirmed'`, with the head still at the jogged X40 Y25.
- **fix:** local.
  - After `$H` and its marker, send `G28.6`. Confirm Home only if the reply lists `X:1` and `Y:1`.
  - An empty reply means no Endstops module; a missing letter means no homing pin on that axis.
    In either case, fail Home with that reason.
  - Treat `WARNING: Nothing to home` as a refusal.
  - Builds older than 2016-10-01 answer `G28.6` without a report, so they fail safe.

### SM-3 — `fire off` is never answered without the Laser module: Jog, Frame, Home and Start wedge

- **severity:** medium. The controller wedges, but only in a narrower configuration.
- **verdict:** CONFIRMED (two repro tests fail).
- **status:** new. The same class as CG-9 (an auto-focus shell command) and GP-3: a line whose
  terminal reply never comes.
- **failure scenario:**
  1. The Laser module is not loaded. Either `laser_module_enable` is not true (the default is
     false), or the laser pin is not a hardware-PWM pin (the module prints an error at boot and
     deletes itself).
  2. KerfDesk leads every jog, Frame tool-off prefix, Home and job with `fire off`. Each owes one
     terminal line. Nothing prints anything for it.
  3. **Jog.** The eleven-line jog payload gets ten answers. One ack is owed forever, so Jog, Frame,
     Home and Start refuse on an Idle machine: "Home is blocked until the previous controller write
     and terminal acknowledgement settle."
  4. **Home alone.** Its lines go one at a time. It stalls on `fire off`, so `$H` is never sent.
     Home fails with "home timed out." after 120 s and leaves the ack owed.
  5. **Frame.** Its prefix is dispatched one line per ack, so it stalls the same way.
  6. **Job.** Line 1 is `fire off`, so the stream stalls until the stall watchdog.
  7. **Console.** `fire off` typed in the Console strands an ack too (`console-command.ts:44-49`).
  8. **Escape.** ABORT (Ctrl-X) halts the board. Its Alarm report zeroes the ledger
     (`src/ui/state/laser-status-line.ts:289` `pendingUntrackedAcks: 0,`). Unlock follows. The next
     Jog, Frame or Home strands another ack. So the machine is unusable for motion until the board
     config is fixed, and nothing tells the operator why.
- **kerfdesk evidence:**
  - `src/core/controllers/smoothieware/commands.ts:35-43`: `SMOOTHIE_CMD_FIRE_OFF = 'fire off'`
    comes first in `SMOOTHIE_FRAME_TOOL_OFF_LINES`. `:66-73`: every jog starts with those lines.
    `driver.ts:67` is Home. `src/core/output/smoothieware-strategy.ts:28`
    `` return `${SMOOTHIE_CMD_FIRE_OFF}\n${…}` `` is the job.
  - `src/core/controllers/smoothieware/response.ts:27`: the only completion is the exact Laser.cpp
    text. `if (trimmed === SMOOTHIE_FIRE_OFF_COMPLETE) return { kind: 'ok' };`
  - `src/ui/state/laser-safe-write.ts:294-299`: one owed ack per newline. Nothing expires it.
  - `src/ui/state/laser-home-action.ts:50` `const HOME_COMMAND_TIMEOUT_MS = 120_000;`
- **upstream evidence:**
  - **The module deletes itself.**
    - `src/modules/tools/laser/Laser.cpp#L53-L57`
      `if( !THEKERNEL->config->value( laser_module_enable_checksum )->by_default(false)->as_bool() ) { … delete this; return; }`
    - `#L69-L74` `printf("Error: Laser cannot use P%d.%d … Laser module disabled.\n", …); … delete this;`

    https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp#L51-L74
  - **Only the Laser module answers `fire`.**
    - `SimpleShell.cpp#L286-L288` `} else if (cmd == "fire") { // these are handled by Laser module`
      prints nothing.
    - `GcodeDispatch.cpp#L79-L82` `}else if(islower(first_char)) { // ignore all lowercase as they are simpleshell commands return; }`
    - The other console handlers (Player, FilamentDetector, panel) do not answer `fire` either.

    https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/utils/simpleshell/SimpleShell.cpp#L283-L295
- **reproduction:** `src/__audit_repro__/SM/sm-3-fire-off-without-laser-module.test.ts` (the
  simulator, with nothing answering `fire off`). Both tests fail:
  - after a jog: `expected { owed: 1, … } to deeply equal { owed: +0, home: 'homed' }`. Home is
    refused with the "previous controller write" message.
  - Home alone: `{ outcome: 'home timed out.', homingCycles: 0, owed: 1 }` instead of
    `{ outcome: 'homed', homingCycles: 1, owed: 0 }`.
- **fix:** local.
  - Probe `M221` with no arguments once per connection. The Laser module prints `Laser power: …`
    (builds from 971eb8cf onward) or `Laser power scale at …` (older builds) before GcodeDispatch's
    `ok`. With no module, only `ok` arrives. The same probe answers SM-2.
  - Send `fire off` only when the module answered. Without it there is no manual fire to cancel.
  - Surface "Laser module not loaded" as a connection or Job Review warning, since S words do
    nothing without it.
  - Refusing live laser output instead would be a product decision.

### SM-2 — Constant-power layers run speed-proportional on Smoothieware built before 2021-06-15

- **severity:** medium. Output is wrong only in narrower conditions: less power at corners and on
  short segments.
- **verdict:** CONFIRMED (upstream history); traced only.
- **status:** new. ADR-322 §3 and MC-11 introduced the M221 P modes pinned to 38e2cc08 with no
  minimum build.
- **failure scenario:**
  1. A constant-power layer is emitted. That happens with the `grbl-compatible` dialect or a
     per-layer constant-power override.
  2. The Smoothieware strategy maps its `M3` to `M400` + `M221 S100 P1`.
  3. Builds before 971eb8cf ignore P (`M221` handled only S). Their `get_laser_power` always
     multiplied by `current_speed_ratio(block)`.
  4. The config key `laser_module_proportional_power` did not exist either: it arrived in 0565b132
     on 2021-06-19. So an old build has no way to run constant power at all.
  5. The default `grbl-dynamic` dialect (M4, so `P0`) matches old firmware; only constant-power
     output is affected.
  6. KerfDesk neither reads the build (`version` is only a Console quick command) nor states a
     minimum build.
- **kerfdesk evidence:**
  - `src/core/output/smoothieware-strategy.ts:53-55`
    ``if (/^M[34]\b/.test(line)) { return ['M400', `M221 S100 P${line.startsWith('M3') ? 1 : 0}`]; }``
  - `src/core/devices/gcode-dialects.ts:109-116`: `grbl-compatible` has
    `cutPowerMode: 'constant'` etc.
  - `src/core/devices/profile-catalog.ts:137` says "Power mode uses M221 P, not GRBL M3/M4." It
    gives no minimum build.
- **upstream evidence:**
  - **Current code.** `Laser.cpp#L206-L208`
    `if(gcode->has_letter('P')) { this->disable_auto_power= gcode->get_uint('P') > 0; }` and
    `#L248-L250` `if(!disable_auto_power) { // true to disable auto power ratio= current_speed_ratio(block); }`
    https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp#L198-L257
  - **History.**
    - 971eb8cf281c978cd31f2f9563a7992effb5e5e9 (2021-06-15, "finish up changimg PWM frequency for
      laser") added `disable_auto_power` and the P and R words. It replaced
      `} else { gcode->stream->printf("Laser power scale at %6.2f %%\n", …` with the new
      `Laser power: … disable auto power: %d, PWM frequency: %f Hz` report. It replaced
      `float ratio = current_speed_ratio(block);` with the conditional.
      https://github.com/Smoothieware/Smoothieware/commit/971eb8cf281c978cd31f2f9563a7992effb5e5e9
    - 0565b1321115e33694625f2931e66dd477246e37 (2021-06-19) added `laser_module_proportional_power`.
- **reproduction:** traced only (firmware history). The simulator models only the current firmware.
- **fix:** local.
  - Use SM-3's `M221` probe. `Laser power: …, disable auto power: …` means P is supported;
    `Laser power scale at …` means an old build.
  - On an old build, show a Job Review warning for constant-power layers.
  - Name the minimum build (edge 971eb8cf, 2021-06-15) in the profile evidence.

### SM-5 — A stopped Frame leaves its framing feed as the G0 seek rate

- **severity:** low. Travel speed changes; there is no wrong burn:
  - Job travel is `G0`, and a `G0` never fires (`Laser.cpp#L245`).
  - The job's `G0` travel then runs at the framing feed until the board is rebooted, instead of the
    configured `default_seek_rate`. For example the 6000 mm/min default `framingFeedMmPerMin`
    against the config sample's 4000, or a slow framing feed that makes every travel slow.
  - A framing feed above a deliberately lower seek rate can exceed what the operator chose for
    travel.
- **verdict:** CONFIRMED (two repro tests fail).
- **status:** incomplete fix of ADR-361 item 6 ("Jog feed no longer changes the G0 seek rate").
  That fix wraps jog and Frame in M120 … M121, but a stopped Frame never sends the M121.
- **failure scenario:**
  1. KerfDesk sends a Smoothieware Frame one line per completed leg: tool-off lines, `M120`,
     `G21`, `G90`, five `G0 X Y F<frame>` legs, then `M121`. So `M121` goes out only after the
     last leg.
  2. Any of these stops dispatch before it:
     - Stop motion (Ctrl/Cmd+., which calls `cancelJog`);
     - ABORT MOTION (Ctrl-X), then Unlock (M999);
     - a kill, limit or soft-endstop halt;
     - a rejected leg.
  3. The Frame's `G0 … F` already set Robot's seek_rate at parse time, and Robot never pops or
     resets its state on a halt.
  4. The next job's bare `G0` travel runs at the framing feed.
  5. Jogs are affected only when a halt is raised while planning the jog's `G0` (a soft-endstop
     halt). The whole jog payload, M121 included, is one write the firmware runs as soon as the G0
     is planned. In that case `G90` and `M121` are refused while halted, so the board also stays in
     G91 until the next job's `G90`.
- **kerfdesk evidence:**
  - `src/core/controllers/smoothieware/commands.ts:52-62` (the M120/M121 rationale) and `:75-81`
    `buildSmoothieFrameLines`.
  - `src/core/controllers/relative-jog-commands.ts:45`
    `` ...corners.map((c) => `G0 X${fmt(c.x)} Y${fmt(c.y)} F${f}\n`) ``
  - `src/ui/state/laser-frame-motion-plan.ts:25-40`: the lines are
    `[...toolOffLines, ...perimeter]`, and the optional return line is itself a wrapped jog.
  - `src/ui/state/laser-frame-status.ts:43-49` dispatches the next line only after the previous leg
    is observed complete (`laser-motion-operation.ts:198-212`).
  - `laser-motion-operation.ts:272-277`
    `if (operation === null || operation.cancelRequested === true) { return null; }`. A stopped
    Frame sends nothing more, including `M121`.
  - `src/ui/laser/use-job-shortcuts.ts:66`
    `if (laser.motionOperation !== null) return { label: 'Stop motion', run: () => laser.cancelJog() };`
  - Job travel carries no F. The Smoothieware emitter writes, for example, `G0 X5.000 Y389.500 S0`.
- **upstream evidence:**
  - **F becomes the seek rate at parse time.** `Robot.cpp#L1144-L1149`
    `if( gcode->has_letter('F') ) { if( motion_mode == SEEK ) this->seek_rate = this->to_millimeters( gcode->get_value('F') ); else this->feed_rate = …; }`
  - **M120/M121 push and pop the state.** `Robot.cpp#L777-L783` `case 120: // push state push_state(); … case 121: // pop state pop_state();`,
    and `#L340-L352` `pop_state` restores feed_rate, seek_rate, absolute and inch modes and the
    current WCS.
  - **Nothing on a halt restores it.** Robot registers only `ON_GCODE_RECEIVED`
    (`Robot.cpp#L131-L133`), so no Ctrl-X, halt, M999 or `$X` path touches it.

  https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L1144-L1149
- **reproduction:** `src/__audit_repro__/SM/sm-5-stopped-frame-keeps-frame-seek-rate.test.ts`. The
  simulator models the seek/feed split and M120/M121. Both tests fail:
  - Ctrl/Cmd+. (`cancelJog`) during the first leg, then a two-travel job:
    `expected [ 1500, 1500 ] to deeply equal [ 4000, 4000 ]`.
  - ABORT MOTION (`stopJob`, Ctrl-X) then Unlock: `expected 1500 to be 4000`.
- **fix:** needs decision. Options:
  - Write an explicit travel `F` on job `G0`s for Smoothieware. KerfDesk does not know
    `default_seek_rate`, so it must choose a value.
  - Send `M121` once after a stopped Frame. This is fragile if another `M120` intervened.
  - Frame with `G1 … S0`. It needs `laser_module_minimum_power 0`, because `G1` blocks fire at the
    minimum power (`Laser.cpp#L279`). A leaked G1 `F` is harmless because every job's first `G1`
    carries F.

### SM-8 — Unsolicited `ALARM:` lines are booked as a rejection of an innocent line

This answers the partial's question about unsolicited `ALARM:` and `Error:` lines.

- **severity:** low. The text is misleading; the ledger recovers.
- **verdict:** CONFIRMED (repro).
- **status:** new. ADR-362 §5 made GRBL's "`ALARM:N` acknowledges no line"
  (`docs/decisions/ADR-362-controller-audit-follow-up.md:42`). The Smoothieware classifier was not
  changed.
- **what happens:**
  - Every `/^ALARM/i`, `/^error:/i` (including `Error:` and `ERROR:`) and `!!` line becomes a
    terminal `error`.
  - `settleUntrackedAck` treats it as the terminal reply of whichever line is owed. With no
    untracked ack owed, it goes to the job stream's in-flight line.
  - Every Smoothieware `ALARM:` line is either unsolicited, printed from an idle loop when the
    machine halts, or followed by the command's own `ok`. None is a terminal reply.
  - During a job, a hard limit therefore produces: "The controller rejected a command
    (unrecognized controller error response: ALARM: Hard limit +X) during the job … Rejected line:
    G1 X30 Y1 F600 S0.5". The G1 named was not executed.
  - The soft-endstop `Error:` line is also misattributed: a G1's `ok` precedes it, so it lands on
    the next line.
- **effect on the ledger:** I traced every Smoothieware source and found no case where a later
  command is settled early:
  - the command's real reply (the `ok` after `ALARM: Homing fail`, or the in-flight line's `!!`)
    arrives next as an orphan;
  - an orphan is dropped when nothing is owed (owner `stream`, no active stream);
  - the Alarm report that follows every halt zeroes the ledger (`laser-status-line.ts:289`);
  - `handleErrorLine` writes only Ctrl-X synchronously, which owes nothing. The reset cleanup waits
    500 ms.

  Stopping the job on these lines is correct in effect. Only the attribution is wrong.
- **kerfdesk evidence:**
  - `src/core/controllers/smoothieware/response.ts:16` `const ALARM_TEXT_RE = /^ALARM/i;` and
    `:33-35` `if (HALT_RE.test(trimmed) || ALARM_TEXT_RE.test(trimmed) || ERROR_RE.test(trimmed)) { return { kind: 'error', code: null, raw: trimmed }; }`
  - `src/ui/state/laser-stream-ack.ts:56` `const isTerminalAck = clsKind === 'ok' || clsKind === 'error';`
  - `src/ui/state/laser-error-line.ts:28-31` `ackSettlement.owner === 'stream' ? state.streamer?.inFlight[0]?.line.trim()`;
    `:43` builds the notice; `:47-48` auto-stop and `advanceStream(…, 'error')`.
  - `src/ui/state/laser-safety-notice.ts:215-221` builds the message text.
- **upstream evidence:**
  - **Hard limit.** `Endstops.cpp#L420-L430` `on_idle`:
    `THEKERNEL->streams->printf("ALARM: Hard limit %c%c\n", d, a);` then ON_HALT.
    https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/endstops/Endstops.cpp#L420-L430
  - **Kill button.** `src/modules/utils/killbutton/KillButton.cpp#L53-L64`
    `THEKERNEL->streams->printf("ALARM: Kill button pressed - reset, $X or M999 to clear HALT\n");`
  - **Ctrl-X.** `USBSerial.cpp#L302-L314` `puts("ALARM: Abort during cycle\r\n");` in grbl mode.
  - **Homing fail.** `Endstops.cpp#L895-L902` `ALARM: Homing fail` (grbl mode) or
    `ERROR: Homing cycle failed - check the max_travel settings`, followed by SimpleShell's `ok`
    (`SimpleShell.cpp#L251`).
  - **Probe fail.** `ZProbe.cpp#L492-L496` `ALARM: Probe fail` then ON_HALT. GcodeDispatch still
    sends `ok`.
  - **Soft endstop.** `Robot.cpp#L1304-L1326` `Error: Soft Endstop %c was exceeded …`.
  - **A G1's ok comes first.** `GcodeDispatch.cpp#L212-L217`
    `// optimize G1 to send ok immediately (one per line) before it is planned`.
- **reproduction:** `src/__audit_repro__/SM/sm-8-unsolicited-alarm-books-a-line.test.ts`. A
  ping-pong job runs on the simulator, then `ALARM: Hard limit +X` arrives and the board halts. The
  test fails with `expected { rejectedLine: 'G1 X30 Y1 F600 S0.5' } to deeply equal { rejectedLine: undefined }`.
- **fix:** local.
  - Classify Smoothieware `ALARM:` lines as a non-terminal alarm event. That needs a code-less
    variant of the `alarm` event, which today requires a number: `controller-event.ts:12`.
  - The event should stop the stream and record the raw text without consuming an ack, as
    GRBL's `ALARM:N` does.
  - Keep `!!`, `error:Alarm lock` and GcodeDispatch's `error:`/`Error:` replies terminal; those are
    real replies.
  - The soft-endstop `Error:` misattribution is residual. It cannot be told apart from
    GcodeDispatch's terminal `Error:` by its text.

### SM-9 — The Laser window status row misreads the Smoothieware report

This answers the partial's question about the status `F:` idle value.

- **severity:** low (misleading display).
- **verdict:** CONFIRMED (traced).
- **status:** new.
- **what happens:**
  - KerfDesk takes the first `F:` component as the live feed.
  - On an Idle Smoothieware report that component is the requested, modal feed. The Laser window
    therefore shows `F: 4000 mm/min` on a standing machine, where GRBL shows 0.
  - `S:` always shows 0. KerfDesk reads spindle only from `FS:` and ignores Smoothieware's
    `|L:<power%>|S:<s>` Run fields.
  - With a G92 origin set, the Origin row shows "machine 0,0" in the red custom-origin style,
    because there is no WCO (SM-1's root cause).
  - No control logic reads `report.feed`. The live-canvas badge shows it only while running, when
    Smoothieware's first component is the actual current feed. The idle value is used as a live
    feed on the display only.
- **kerfdesk evidence:**
  - `src/core/controllers/grbl/status-parser.ts:173` `feed: pickFsValue(fields, 0),` and
    `:319-331`, where index 1 is null unless `FS:`.
  - `src/ui/laser/StatusDisplay.tsx:26` `const feedMmPerMin = reportedFeedMmPerMin(report, reportInches);`
    and `:48-51` `<strong>F:</strong> {feedMmPerMin} mm/min <strong>S:</strong> {report.spindle ?? 0}`.
  - `:42-46` shows `'machine 0,0'` when `wcoMm` is null.
  - The badge uses the feed only while running: `src/ui/workspace/canvas-motion-badge.tsx:163`
    `if (run.lifecycle !== 'running' || run.reportedFeedMmPerMin === null) return '';`
- **upstream evidence:** `src/libs/Kernel.cpp#L236-L253`:
  - the Run form is `|F:%1.1f,%1.1f,%1.1f` (current, requested, override), then `|L:%1.4f` and
    `|S:%1.4f`;
  - `#L289-L293` is the Idle form: `float fr= robot->from_millimeters(robot->get_feed_rate());` …
    `"|F:%1.1f,%1.1f"` (requested feed and override).
- **reproduction:** traced only. A parse of
  `<Idle|…|F:4000.0,100.0>` gives `feed: 4000, spindle: null`.
- **fix:** local.
  - For Smoothieware, hide the F row at Idle or label it "requested".
  - Parse `L:` or `S:` from Run reports for the S cell.
  - The Origin row is fixed by SM-1's derived offset.

### SM-4 — The Smoothieware simulator is more forgiving than the firmware

- **severity:** low (test fidelity).
- **verdict:** CONFIRMED by comparison of `src/__fixtures__/controllers/smoothie-simulator.ts` with
  the firmware.
- **status:** new. CG dropped its CG-6 as a duplicate of this.
- **gaps:**
  1. **Ctrl-X.** The simulator emits `Smoothie`, which KerfDesk treats as a reboot banner, and
     halts only when moving (`smoothie-simulator.ts:157-164`). The firmware always halts, prints
     `ALARM: Abort during cycle` (grbl mode) or `HALTED, M999 or $X to exit HALT state`, and
     flushes its receive buffer (`USBSerial.cpp#L302-L314`). This hides CG-3 and changes how SM-1
     and SM-8 play out.
  2. **G92.** `G92 X0 Y0` runs as a move to X0 Y0 (`handleMotion` via `parseMotionWords`), and
     WPos always equals MPos (`:132`). This hides SM-1 and CG-1.
  3. **Halted replies.** While halted, the simulator answers `!!` to every G-code except M999
     (`:294-298`). The firmware runs M2, M5, M9, M30, M105, M114, M115, M119, M80, M81, M911,
     M503, M106 and M107 (`GcodeDispatch.cpp#L34`).
  4. **`fire off`.** It is always answered (`:307-310`); there is no mode without the Laser module.
     This hides SM-3.
  5. **`$H`.** It always runs a homing cycle (`:276-279`); there is no mode without Endstops or
     without a homing pin. This hides SM-6.
  6. **Reports.** Every report is `…|F:4000.0,100.0>` (`:132`). There is no Run form
     (`F:cur,req,ovr|L:|S:`) and no temperature or `SD:` fields (`Kernel.cpp#L236-L330`).
  7. **Power model.** `smoothie-laser-power-model.ts` divides the float S by maximumS. The firmware
     keeps a 12-bit 1.11 field. This hides SM-7.
  8. **Unsolicited lines.** The simulator never prints the unsolicited `ALARM:` lines (hard limit,
     kill button). This hides SM-8.
  9. **Open banner.** It is `Smoothie command shell` without `ok` (`:337`). That is the telnet
     shell's greeting (`src/libs/Network/uip/telnetd/shell.cpp#L236`). USB attach prints
     `Smoothie` then `ok` (`USBSerial.cpp#L332`).
- **fix:** local, fixture only. Model the items above behind options, as `grblMode` already is.

---

## Answers to the partial's "still to check" list

- **SM-3 repro.** Done. Both tests fail. Home alone was added.
- **Home confirmed when `$H` runs no cycle.** Yes. See SM-6 (repro fails).
- **Unsolicited `ALARM:`/`Error:` lines classified as terminal acks.** Yes. The effect is SM-8:
  misattributed text. The ledger re-converges, and I found no case where a later command is
  settled early.
- **Status `F:` idle value used as a live feed.** Only on the Laser window display; no logic reads
  it. See SM-9.
- **Checked-and-correct summary.** See below.

## Refutation attempts (what I looked for before keeping each finding)

- **SM-1.**
  - I looked for anything in the job or Frame preamble that clears the G92: nothing. `clearOrigin`
    (`G92.1`) is sent only by Reset origin (`laser-origin-actions.ts:383`).
  - I looked for any MPos − WPos inference: none (`laser-status-position.ts:51-53`).
  - No capability flag routes Smoothieware through a WCO query (`offsetsQuery: null`,
    `driver.ts:73`).
- **SM-7.**
  - Nothing normalises S before `Planner::append_block`: `Robot.cpp#L1034` and `#L1466`, and
    `laser_maximum_s_value` is used only at `Laser.cpp#L246`.
  - No config key rescales S.
  - The conversion was confirmed in the shipped binary, not just by the language rules.
  - KerfDesk's only guard is the wizard default of 1. The editor, validation, import and the
    controller-kind switch all allow ≥ 2.
  - The docs actively recommend 100 and 255.
- **SM-6.**
  - No `Home` status is ever reported without Endstops (`Kernel.cpp#L181-L182`).
  - The `$H` `ok` is unconditional.
  - No KerfDesk check of homed axes exists.
  - The Home button requires profile homing, which is the narrowing condition.
- **SM-3.**
  - No other module answers `fire`.
  - No expiry releases an owed ack.
  - In-session escape: Stop → Alarm → Unlock clears the ledger only until the next Jog, Frame or
    Home.
- **SM-2.** No config route existed before 0565b132 (2021-06-19) either.
- **SM-5.**
  - No KerfDesk path sends `M121` after a stop.
  - A clean Frame's return line is itself push/pop-wrapped, so a completed Frame does not leak.
    The existing test `laser-lifecycle-smoothie-protocol.simulator.test.ts:207-216` passes.
- **SM-8.** An ALARM line's classification cannot wedge the ledger (see "effect on the ledger"),
  so SM-8 stays low.

## Checked and correct

- **`ok` variants classify as acks.** `ok`, `ok - Invalid G53`, `ok <text>` (M114 `ok C: …`) and
  `ok Emergency Stop Requested …` all match `/^ok\b/i`. GcodeDispatch answers an empty line `ok`
  (`GcodeDispatch.cpp#L65-L67`) and prints `ok %s` for trailing text (`#L410-L418`).
- **Halted replies.** `!!` (non-grbl) and `error:Alarm lock` (grbl) are the terminal replies while
  halted, and both classify as error (`GcodeDispatch.cpp#L158-L180`). M999 clears the halt and
  answers `ok` (`#L160-L166`).
- **Unlock.** `$X` answers only while halted (`SimpleShell.cpp#L229-L234`), so the Console refuses
  it (`console-command.ts:33-34, 93`). Unlock uses M999.
- **`$G` and `$#`** print `ok` (`SimpleShell.cpp#L218-L222, L236-L239`). Unknown shell commands
  get `error:Unsupported command - %s` (`#L293-L294`). The Console's shell allow-list is
  conservative and consistent with that.
- **Home dialects.** `$H` homes in both dialects and prints `ok` after the blocking cycle
  (`SimpleShell.cpp#L241-L252`). `G28` parks in grbl mode and `G28.2` parks otherwise
  (`Endstops.cpp#L1046-L1071`). KerfDesk uses `$H` (ADR-361 item 6).
- **Home refused while halted.** Home's leading `M400` is refused while halted, because 400 is not
  in `allowed_mcodes` (`GcodeDispatch.cpp#L34`). So `$H` never unlocks a halted board behind the
  operator's back (driver.ts:63-67).
- **`fire off` completion.** The text is exactly `turning laser off and returning to auto mode`
  with no `ok` (`Laser.cpp#L152-L154`), and it is matched exactly (`response.ts:27`). The Laser
  module ignores `fire` while halted (`Laser.cpp#L126`), and KerfDesk never needs it then.
- **`version` completion.** `Build version: …` is the first line, with no `ok`
  (`SimpleShell.cpp#L661-L677`). It is used as the completion (`response.ts:32`).
- **`M115`.** It prints `FIRMWARE_NAME:Smoothieware…` then `ok` (`GcodeDispatch.cpp#L269-L291`).
  It is a `message`, not a reboot banner (`response.ts:46`).
- **Reboot banners.** The boot banner `Smoothie Running @%ldMHz` (`src/main.cpp#L103`) and USB
  attach `Smoothie` (`USBSerial.cpp#L332`) are the only `^Smoothie` lines, and both are welcome
  banners. The `ok` after attach reaches a ledger the banner just zeroed
  (`laser-line-handler.ts:362`). The handshake awaits a line and then settles
  (`laser-controller-handshake.ts:86-99`), so that `ok` is dropped harmlessly.
- **Realtime bytes.** `?` is serviced at any time, including during M400 and homing
  (`USBSerial.cpp#L215-L218`, answered in `on_idle` `#L316-L319`). `!` and `~` work only with
  feed hold enabled (`#L220-L230`), so the driver correctly claims neither (`driver.ts:52-58`).
  Ctrl-X sets the halt flag (`#L204-L206`).
- **After a halt.** `Laser::on_halt` turns the beam off and ends manual fire (`Laser.cpp#L308-L314`).
  The Abort cleanup M5/M9 is flushed by its 500 ms fallback (`laser-reset-cleanup.ts:47-49`), since
  Ctrl-X prints no banner. Both lines are allowed while halted (`GcodeDispatch.cpp#L34`).
- **Status grammar.**
  - The pipe grammar parses with the extra `|L:`, `|S:`, temperature (`|T:…`, `|B:…`) and `|SD:`
    fields ignored.
  - The `F:` second component is not read as spindle (`status-parser.ts:319-331`, audit F7).
  - The comma grammar `<Idle,MPos:…,WPos:…>` regroups correctly (`comma-status-report.ts`).
  - All three were checked with the real classifier against `Kernel.cpp#L178-L330`.
- **Completed jog or Frame.** A completed jog or Frame leaves the seek rate alone:
  - M120/M121 push and pop seek_rate, feed_rate, the absolute and inch modes and the WCS
    (`Robot.cpp#L777-L783, L330-L352`);
  - the jog payload is a single write, so its M121 is always processed;
  - see SM-5 for the stopped-Frame gap.
- **M221 power modes.** M221 applies at once (`Laser.cpp#L196-L213`), so the `M400` in front of
  every `M221` is required. `M221 S` is a percentage and is never rescaled: the S rescale runs
  before `nativePowerModes` adds the M221 lines (`smoothieware-strategy.ts:28`). P>0 disables
  proportional power on current builds (`Laser.cpp#L206-L208`); see SM-2 for old builds.
- **Default power scale.** The default fractional scale is exact: S ≤ 1 fits the 1.11 field
  (`S1` gives 2048, below 4096). The SM-7 control test passes.
- **S is modal.** S is modal on G0-G3 (`Robot.cpp#L1034`). A `G0` block never fires
  (`Laser.cpp#L245` `block->is_g123`).
- **Settle marker.** `M400` waits for the queue to empty before its `ok`
  (`Robot.cpp#L920-L922` `THEKERNEL->conveyor->wait_for_idle();`).
- **Origin commands.** `G92 X0 Y0` makes the current WPos zero (`Robot.cpp#L645-L661`), and
  `G92.1` clears the offset (`#L624-L627`). A bare `G92` also clears it; KerfDesk never sends one.
- **Lowercase lines.** GcodeDispatch ignores them (`GcodeDispatch.cpp#L79-L82`), so the Console
  correctly refuses lowercase G-code (`console-command.ts:98`) and `config-set`/`config-load`
  (`:65-67`).

## Not covered

- Hardware behaviour of any kind.
- SmoothieV2, a separate firmware for Smoothieboard v2. I only noted that it has the same 12-bit
  S field.
- Network (telnet) transport. KerfDesk uses USB serial only.
- The inch-mode reports a Console `G20` would cause. Smoothieware then reports positions in
  inches, and M120/M121 restore G20 after each jog. KerfDesk has no report-units evidence for
  Smoothieware. Not traced.
- A reset cleanup pending when a real reboot banner arrives. The boot banner is followed by the
  `Build version:` line (`src/main.cpp#L103-L104`), which KerfDesk classifies as `ok`. If a Stop
  armed cleanup less than 500 ms before a UART-visible reboot, that line would settle the cleanup's
  M5 early. On USB a reboot drops the port, so KerfDesk never sees it. Not reproduced.
- The ADR-364 Smoothieware resume builder beyond the power oracle's missing 12-bit storage (SM-7,
  SM-4).
- The status grammar and `version` text of pre-2017 builds (the comma grammar's dates).
- M221's effect on a board that also has a selected Extruder module (M221 is also its flow rate,
  `Extruder.cpp#L314`).
- Auto-focus with shell-style commands. That is covered by CG-9.

## Files

Repro tests, all in `src/__audit_repro__/SM/`:

- `sm-1-retained-g92-absolute.test.ts`: 2 tests, both fail.
- `sm-3-fire-off-without-laser-module.test.ts`: 2 tests, both fail. The Home-alone test was added
  in this session.
- `sm-5-stopped-frame-keeps-frame-seek-rate.test.ts`: new, 2 tests, both fail.
- `sm-6-home-without-endstops-module.test.ts`: 1 test, fails.
- `sm-7-smoothie-s-above-two.test.ts`: 3 tests. Two fail; the maxPowerS=1 control passes. The
  header now cites the binary evidence.
- `sm-8-unsolicited-alarm-books-a-line.test.ts`: new, 1 test, fails.

`zz-explore-*.test.ts` are scratch files from the earlier session.
