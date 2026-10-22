# Controller audit v4 — E1 Power mapping (`ctl-power-mapping`)

- **When:** 2026-10-22 22:15–23:10   **Tree:** origin/main @ `71ff820ce`. The worktree `src/` for
  every scope file is identical to `71ff820ce` (`git diff --stat 7cd526213 origin/main` touches no
  scope file; the device-profile changes on main are Ortur/Falcon catalogue entries, not power).
  `origin/main` moved to `1a25886ff` during the audit; its changes to the cited files
  (`parse-settings.ts` `$22` bit 3, `gcode-inspection-source.ts` timing) touch no power line, and
  every cited line number was re-checked on main.
- **Scope:** `src/core/output/{grbl-power-modes,laser-power-scale-version,marlin-inline-transform,marlin-fan-transform,marlin-fan-raster,smoothieware-strategy,focus-test-power,grbl-laser-lines,grbl-strategy,marlin-strategy,rescale-raster-job}.ts`,
  `src/core/raster/controller-power-scale.ts`, `src/core/raster/dither.ts` (S mapping only),
  `src/core/job/{object-power-scale,compile-job-raster,job-start-power,line-tabs}.ts`,
  `src/core/effective-output/effective-output.ts`, `src/core/devices/{smoothie-power-scale,gcode-dialects,falcon-profiles,profile-catalog}.ts`.
  Twins read: `src/ui/gcode-inspector/{gcode-inspection-source,use-current-gcode,burn-grid,use-laser-burn}.ts`,
  `src/core/gcode-view/{laser-render-state,laser-power-control}.ts`,
  `src/ui/workspace/{compiled-raster-preview,draw-raster-preview}.ts`,
  `src/ui/laser/{connected-laser-power-scale,DeviceProfilePowerFields}.ts(x)`,
  `src/ui/laser/job-review/{job-review-effective-operations,job-review-live-rows}.ts`,
  `src/core/preflight/controller-readiness.ts`, `src/ui/layers/{CutPowerModeField,LayerImageFields,CutSettingsImageFields}.tsx`.
- **Governing:** PROJECT.md non-negotiable 7 (power scale honest); ADR-567 and ADR-567
  Amendment 1; ADR-257 (M4 default); ADR-036 (fill power mode); ADR-095 (Marlin inline/fan);
  ADR-096 (Smoothieware fractional S); ADR-398 Amendment 1 (Marlin M4 runs continuous);
  ADR-630 Amendment 3 (Smoothieware power scale baseline).
- **Primary sources fetched:** gnea/grbl master `spindle_control.c`, `stepper.c`, `cpu_map.h`,
  GRBL v1.1 Laser Mode wiki; grblHAL core master `spindle_control.c` / `spindle_control.h`;
  FluidNC main and v4.0.3 `SpindleDatatypes.h`, `GCode.cpp`, `Planner.h`, `Stepper.cpp`,
  `Spindles/{Spindle,LaserSpindle}.cpp`, `SettingsDefinitions.cpp`; Marlin 2.1.2.5
  `gcode.cpp`, `M3-M5.cpp`, `M106_M107.cpp`, `spindle_laser.h`, `spindle_laser_types.h`,
  `Configuration_adv.h`; Smoothieware edge `Laser.cpp`; LightBurn docs (Shared Cut Settings,
  GRBL Configuration). Downloaded copies are in the session scratchpad (`e1-src/`).
- **Lenses run:** L1, L2, L3, L4, L7 as separate passes. L5 (no untrusted input enters this
  mapping beyond what 03-P1-1 and 13-P1-1 already covered) and L6 (the mapping has no failure
  path of its own) were skipped.
- **Counts:** 4 raised → 0 refuted (refuter: 4 confirmed, 0 plausible; no severity changes) → P1 0 / P2 1 / P3 3 (+ 9 KNOWN)

## Headline

Across the eleven dialect/scale combinations a 60% / min 10% layer reaches the firmware as the
intended 60%, and min power is used only for grayscale images, as in LightBurn. The one real
mapping gap is FluidNC: it stores S as an unsigned integer, so the fractional S words that
ADR-567 Amendment 1 now writes for a small `$30` are truncated, and at `$30=1` every power below
100% burns nothing. The G-code Inspector's burn shading divides by the saved profile's S max,
which is wrong whenever the program was scaled to the connected `$30`, or on Marlin fan wiring.
The `$31` advisory points the wrong way.

## End-to-end table

The layer is Line, Fill or Image (grayscale) at power 60% and min power 10%, with no object power
scale. The image row is luma 0 / 128 / 254 / 255. "Duty" is the firmware's PWM share at the
programmed feed, worked from the firmware source with default PWM limits. Emitted bytes come from
`emitGcode` and `prepareOutput` → `emitPreparedGcode` (repro below).

| Dialect and scale | Arm / mode words | Line and Fill S (min unused) | Image S (0/128/254/255) | Firmware duty at feed | Source for the firmware step | LightBurn for the same layer |
|---|---|---|---|---|---|---|
| GRBL 1.1, `grbl-dynamic`, `$30=1000`, `$31=0` | `M4 S0`; raster `M5`, `M4 S0` | `G1 … S600` (compact `G1X14Y388F1500S600` for fill) | `X11S600` `X12S349` `X13S102` `X18S0` | PWM `floor(S·254/1000)+1`: 153/89/26 of 255 = 60.0 / 34.9 / 10.2%; S0 off. M4 multiplies S by current/programmed speed, 0 at rest | `spindle_control.c` `spindle_compute_pwm_value`; `stepper.c` `rpm *= (prep.current_speed * prep.inv_rate)` | S-max 1000, Variable power (M4): S600; Min Power hidden for GCode vectors, shown for Grayscale |
| GRBL Constant (`grbl-compatible`, or a layer set to Constant) | `M3 S0` (from M4: `M3 S0`; back: `M5`, `M4 S0`) | `S600` | `S600/S349/S102/S0` | Same duty, held through accel and corners | GRBL laser wiki: M3 "keeps the laser power as programmed" | Constant Power Mode: M3 |
| GRBL `$30=255` | as above | `S153` | `S153/S89/S26/S0` | 153/89/26 of 255 = 60.0 / 34.9 / 10.2% | `spindle_compute_pwm_value` | S-max 255: same |
| GRBL `$30=1` (ADR-567 Amd 1 virtual range) | as above | `S0.6` | `S0.6/S0.349/S0.102/S0` | 60.0 / 34.9 / 10.2% (GRBL keeps S as float) | `gcode.c` float S; `spindle_compute_pwm_value(float rpm)` | not checked |
| GRBL `$30=1000`, `$31=100` | as above | `S600` | `S600/S349/S102/S0` | 142/71/1 of 255 = **55.7 / 27.8 / 0.4%**; any S ≤ 100 gives PWM 1 (0.4%) | `else if (rpm <= settings.rpm_min)` → `SPINDLE_PWM_MIN_VALUE` (1) | Same bytes (LightBurn does not compensate for `$31`) |
| grblHAL `$30=1000`, `$31=0`, `$35=0` | as GRBL | `S600` | as GRBL | `floor((rpm-rpm_min)·gradient)+min_value` → 60 / 34.9 / 10.2%; fractional S kept (`float rpm`) | grblHAL `spindle_control.c`, `spindle_control.h` | as GRBL |
| FluidNC Laser, default `speed_map 0=0% 255=100%` (`$30=255`; generic profile S max 255) | as GRBL | `S153` | `S153/S89/S26/S0` | `mapSpeed` linear: 60 / 34.9 / 10.2%; M4 rate-adjusted for Laser | `LaserSpindle.cpp` `linearSpeeds(255, 100.0f)`, `isRateAdjusted() { return true; }`; `SettingsDefinitions.cpp` `INT_PROXY("30", …, spindle->maxSpeed())` | not checked |
| FluidNC, `speed_map` top 1 (`$30=1`) | as GRBL | `S0.6` | `S0.6/S0.349/S0.102/S0` | **0 / 0 / 0%** (`(uint32_t)` truncation) — **P2-1** | `SpindleDatatypes.h` `typedef uint32_t SpindleSpeed`; `GCode.cpp` `pl_data->spindle_speed = gc_state.spindle_speed` | — |
| FluidNC, `speed_map` top 20 (`$30=20`) | as GRBL | `S12` | `S12/S6.98/S2.04/S0` | 60 / **30** / 10% (S6.98 → 6) — **P2-1** | as above | — |
| Creality Falcon A1 Pro (grblHAL, vendor command set, profile S1000, `$$` disabled) | as GRBL | `S600` | as GRBL | 60% if the firmware's S range is 1000 (Creality's LightBurn bundle: "S scale 1000"); KerfDesk cannot read `$30` here and Job Review says the range is the saved profile's | `falcon-profiles.ts` evidence note | Creality LightBurn bundle S 1000 |
| Marlin inline, `CUTTER_POWER_UNIT PWM255`, profile 255 | `M5 I`, `M3 I S0` for every M3 and M4 (continuous; ADR-398 Amd 1) | `S153` | `S153/S89/S26/S0` | OCR = S: 60 / 34.9 / 10.2%; no speed scaling unless the build has `LASER_POWER_TRAP` | `gcode.cpp` L229-241 (`power_to_range`, `upower_to_ocr`); `M3-M5.cpp` (`M4 I` = feedrate-derived, so not used) | not checked (byte form) |
| Marlin inline, `PERCENT`, profile 100 | as above | `S60` | `S60/S35/S10/S0` | `pct_to_ocr`: 153/89/25 → 60 / 34.9 / 9.8% | `spindle_laser.h` `pct_to_ocr`, `power_to_range` | — |
| Marlin inline, profile 255 on a `PERCENT` build | as above | `S153` | … | `constrain(153, 0, 100)` → 100% (config mismatch the catalogue note warns about) | `power_to_range` PERCENT branch | — |
| Marlin inline, profile 1000 on a `PWM255` build | as above | `S600` | `S600/S349/S102/S0` | S passes through `uint8_t cutter_power_t`: S600 → 88 (**34.5%**), S1000 → 232, S256 → 0 — **P3-3** | `spindle_laser_types.h` (`uint8_t` unless RPM and `SPEED_POWER_MAX > 255`) | — |
| Marlin fan (`marlin-fan`), any profile S max | `M107` for M3/M4/M5 and travel | `M106 S153` | `M106 S153`, `M106 S89`, `M106 S26`, `M107` | fan PWM 153/89/26 of 255 (before any `FAN_MIN_PWM`/`FAN_MAX_PWM` scaling) | `M106_M107.cpp` (S 0–255) | — |
| Smoothieware, S max 1, `laser_module_maximum_s_value 1.0` | `fire off`; `M400`, `M221 S100 P0` (M4) or `P1` (Constant); M5 → `M400`, `M221 S0` | `G1 … S0.600` | `S0.600/S0.349/S0.102/S0` | `power = S/1.0 × ratio × scale`; PWM = `min + (max−min)·power` → 60 / 34.9 / 10.2% with min 0, max 1 | `Laser.cpp` L239-285, M221 L198-212 | LightBurn sets power with S only (no M221), per the C6 report |

Twin check on the same layers: the canvas raster preview, Job Review ("60% power") and the
Inspector's raw S column all match the bytes above. The Inspector's burn shading does not match
when the scale comes from a connected `$30` or from Marlin fan wiring (P3-1).

## Findings

### P2-1 — FluidNC truncates the fractional S words of ADR-567 Amendment 1, so a small `$30` burns nothing or too little
- **Where:** `src/core/output/laser-power-scale-version.ts:22-26` and `:32-37` (the virtual range
  and version 3 also apply to `controllerKind: 'fluidnc'`); `src/core/output/grbl-laser-lines.ts:27-31`
  (`scaleS`); `src/core/raster/controller-power-scale.ts:24-31` (raster in the 0–1000 virtual
  range for `fluidnc`); `src/core/job/job-start-power.ts:24-31` (`vectorPowerReachesController`
  counts `0.6 > 0` as reaching the controller); `src/ui/laser/connected-laser-power-scale.ts:15-17`
  (FluidNC's `$30` is used as the execution range).
- **Anchor:** Ground truth + Contract. FluidNC `SpindleDatatypes.h`: `typedef uint32_t
  SpindleSpeed;` (main and v4.0.3). `GCode.cpp` copies the float S into it:
  `pl_data->spindle_speed = gc_state.spindle_speed;` (main L1877, v4.0.3 L1650), and M3 uses
  `spindle->setState(…, (uint32_t)gc_block.values.s)`. In `Stepper.cpp` the M4 product goes back
  into a `SpindleSpeed` too. So FluidNC truncates every S to a whole number. FluidNC's `$30` is the
  top of its `speed_map` (`INT_PROXY("30", "Grbl/MaxSpindleSpeed", spindle->maxSpeed())`).
  ADR-567 Amendment 1 gives "a whole-number GRBL-family S maximum below 100" the virtual range on
  the stated ground that GRBL "accepts decimal S words and maps them linearly". That holds for
  GRBL and grblHAL (`float rpm`), not FluidNC. NN7: 100% means the maximum S, and Job Review shows
  the set percentage.
- **Scenario:**
  - A FluidNC laser whose `speed_map` tops out below 100, for example `0=0% 1=100%` (`$30=1`).
    A 60% Line emits `G1 … S0.6`, and FluidNC plans it at S0, so nothing burns. Every power below
    100% does the same: `S0.999` → 0. The grayscale image emits `S0.6/S0.349/S0.102`, all 0.
  - At `speed_map` top 20, `S6.98` (34.9%) runs as 6 (30%) and `S6.6` (33%) as 6. Each value
    loses up to one whole step (5%), always downward.
  - Job Review shows "60% power". `hasJobStartPower` says the power reaches the controller, so
    no warning appears.
  - Before version 3 (Math.round to whole S) the same job burned 60% as S1, which was full power
    but at least lit.
- **Evidence:** REPRO + SOURCE.
  - Emission, temporary Vitest `src/io/gcode/zz-e1-power-table.test.ts` (copy in scratchpad
    `e1-repros/`), run with `node ../../../node_modules/vitest/vitest.mjs run …`:
    `fluidnc $30=1 / line: M4 S0 | G1 X14.000 Y390.000 F1500 S0.6 | M5`;
    `fluidnc $30=1 / image: … X11S0.6 | X12S0.349 | X13S0.102 | X18S0`;
    `fluidnc $30=20 / image: … X11S12 | X12S6.98 | X13S2.04`.
  - Firmware step from the FluidNC source (`e1-repros/firmware-pwm.mjs`):
    `FluidNC speed_map top 1: S0.6->0 (0.0% vs 60.0%) … S0.999->0`;
    `top 20: S6.98->6 (30.0% vs 34.9%)`.
  - Sources: https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/SpindleDatatypes.h ,
    https://github.com/bdring/FluidNC/blob/main/FluidNC/src/GCode.cpp ,
    https://github.com/bdring/FluidNC/blob/main/FluidNC/src/SettingsDefinitions.cpp .
- **L7:** `small-whole-number-power-range.test.ts` covers only the default GRBL profile. No test
  emits FluidNC power, and the repo has no FluidNC power model.
- **Refuter:** **CONFIRMED** (P2 kept). What would refute it: FluidNC keeping S as a float, or
  KerfDesk never giving FluidNC the virtual range. Neither holds.
  - Firmware, fetched independently (raw.githubusercontent.com, `bdring/FluidNC` main and tag
    `v4.0.3`). `SpindleDatatypes.h` is byte-identical on both: `typedef uint32_t SpindleSpeed;`.
    The parser keeps S as a float (`GCode.h` `float s;`, `float spindle_speed;`; `GCode.cpp`
    `case 'S'` `gc_block.values.s = value;`). But `plan_line_data_t::spindle_speed` and
    `plan_block_t::spindle_speed` are `SpindleSpeed` (`Planner.h` L57/L65), and the float is
    assigned without rounding: `pl_data->spindle_speed = gc_state.spindle_speed;` (main L1877,
    v4.0.3 L1650), so C++ float→integer conversion truncates toward zero. M3/M4 enable also
    truncates: `setState(…, (uint32_t)gc_block.values.s)` (main L1870, v4.0.3 L1643). M4 rate
    adjustment then starts from the already truncated block value (`Stepper.cpp`
    `float speed = pl_block->spindle_speed;`), and `mapSpeed(SpindleState, SpindleSpeed)` takes an
    integer. The S value is never kept as a float before `speed_map`.
  - `$30` on FluidNC is `INT_PROXY("30", "Grbl/MaxSpindleSpeed", spindle->maxSpeed())`, which is the
    last `speed_map` speed. `Configuration/Parser.cpp` `speedEntryValue` parses each speed with
    `from_decimal`, so any whole top from 1 up is legal YAML (for example `0=0% 1=100%`).
  - KerfDesk reaches the path. `powerScaleVersionForDevice` (`laser-power-scale-version.ts:32-37`),
    `rasterCompilationPowerScale` (`controller-power-scale.ts:24-31`) and `isGrblFamily`
    (`connected-laser-power-scale.ts:15-17`) all include `fluidnc`. The connected FluidNC `$30` is
    accepted as the execution range.
  - Repro (own temporary Vitest; real `resolveLaserPowerScale` → `laserPowerPreparationOptions` →
    `prepareOutput` → `emitPreparedGcode`; catalog `generic-fluidnc` profile, S255; connected
    `$30` injected):
    - `$30=1`: Line 60% `G1 … S0.6`; 33% `S0.33`; image `X11S0.6 | X12S0.349 | X13S0.102`. All
      truncate to S0.
    - `$30=20`: `S12`, `S6.6`, `X12S6.98` → 12 / 6 / 6.
    - `$30=99`: `S59.4`, `S34.551`. The loss is small but always downward.
    - `$30=100` and `$30=255`: whole S, unaffected.
    - Job Review's only power-scale text was `Output power uses the connected controller's $30=1: 100% means S1.`
    - `vectorPowerReachesController(60, fluidnc@S1)` returned `true`, so no zero-power warning
      fires.
  - Severity: P2 is kept as a broken contract with a clear failure. ADR-567 Amd 1's "accepts
    decimal S" premise is false for FluidNC, and NN7 is broken: Job Review says 60% while the job
    burns 0%, or 30% instead of 34.9%. This matches 03-P2-4's grading for the same small-`$30`
    class. Reach is narrow. LightBurn's common S maxima (100, 255, 1000, 10000) and FluidNC's
    Laser default (255) are unaffected, and only a hand-written `speed_map` top below 100 triggers
    it. At `$30=1` the failure is safe: nothing burns, and the operator sees no mark. The quiet
    case is the 1–5% under-burn at tops of 20 to 99.
- **Fix direction:** Keep whole-S output for `fluidnc` and say plainly in Job Review that a
  `speed_map` top below 100 cannot express each percentage. One way is to exclude FluidNC from
  `usesVirtualPowerRange` and `rasterCompilationPowerScale`, and make `vectorPowerReachesController`
  floor for FluidNC. Alternatively, warn that FluidNC rounds S down to whole numbers and suggest a
  `speed_map` top of 100 or more. Amend ADR-567 Amendment 1's firmware claim either way.

### P3-1 — The Inspector's burn shading divides by the saved profile S max, not the program's full-power value
- **Where:** `src/ui/gcode-inspector/gcode-inspection-source.ts:125` (`maxPowerS: device.maxPowerS`)
  via `projectInspectionContext(project)` (`:86`), used for the current canvas
  (`use-current-gcode.ts:264`, `gcode-command-actions.ts:51`); `src/ui/gcode-inspector/burn-grid.ts:199`
  (`movePower = segPower / laser.maxPowerS`); `src/core/gcode-view/laser-render-state.ts:60-62`
  (Marlin fan power is the `M106` value, 0–255).
- **Anchor:** Twin + Contract.
  - The current-canvas bytes come from `emitSaveGcode` with the connected `$30`
    (`save-gcode-emission.ts:60`, `laserPowerPreparationOptions`). The live-run Inspector uses the
    prepared execution device (`canvas-motion-plan.ts:182,198`), so the two Inspector views of
    the same job disagree.
  - Marlin fan output is always 0–255 whatever the profile S max (`marlin-strategy.ts`,
    `MARLIN_FAN_MAX_POWER`), but the Inspector divides by the profile value.
  - NN7 / ADR-567: 100% means the connected `$30`.
- **Scenario:**
  - Profile S1000, controller reports `$30=255`. A 60% Line is emitted as `S153` (correct), but
    the Inspector shades it at 15.3% and its energy (J/mm²) readout is about 4× too low.
  - Profile S255, controller `$30=1000`: `S600` shades as 100%.
  - A Marlin fan profile with S max 1000 shades `M106 S153` as 15.3%; with S max 100, as 100%.
  - The operator judging the burn from the Inspector sees the wrong darkness. The program itself
    is right.
- **Evidence:** REPRO. Temporary Vitest `src/ui/gcode-inspector/zz-e1-inspector-twin.test.ts`
  (copy in `e1-repros/`): `grbl profile S1000, connected $30=255: emitted … S153 | inspector maxPowerS 1000 | burn power shares 0.153`;
  `grbl profile S255, connected $30=1000: … S600 | inspector maxPowerS 255 | burn power shares 1`;
  `marlin-fan S1000: emitted M106 S153 | inspector maxPowerS 1000 | burn power shares 0.153`;
  `marlin-fan S100: … burn power shares 1`; controls `grbl S1000, no controller` 0.6,
  `marlin-fan S255` 0.6, `smoothieware S1` 0.6.
- **L7:** The burn-grid tests pin `LASER.maxPowerS = 1000`, and nothing ties the Inspector's
  divisor to the emitted program.
- **Refuter:** **CONFIRMED** (P3 kept). What would refute it: the current-canvas Inspector being
  fed the execution range. It is not.
  - `use-current-gcode.ts:264` builds the context with `projectInspectionContext(snapshot, placement)`.
    That calls `deviceInspectionLaser` → `maxPowerS: device.maxPowerS` (`gcode-inspection-source.ts:125`).
  - The bytes come from `save-gcode-emission.ts:60`, `laserPowerPreparationOptions(ctx.project, ctx.machine)`,
    which uses the connected `$30`.
  - `BurnLaser.maxPowerS` is documented as "the controller's $30" (`burn-grid.ts:33`), but it is
    given the profile value.
  - Own repro using real `prepareOutput` + `projectInspectionContext` + `movePower`, layer 60%:
    - GRBL profile S1000 with connected `$30=255`: burn S 153, inspector maxPowerS 1000,
      movePower 0.153.
    - `marlin-fan` profile S1000: `M106 S153`, movePower 0.153.
    - Control, offline S1000: S600, 0.600.
  - Reach is limited. A `$30` mismatch also raises the `max-power-mismatch` Job Review warning,
    which asks the operator to apply the detected value. A Marlin fan profile keeps S max 255
    unless the operator types another value, because Machine Setup resets it to 255. The program
    bytes are right, so this is display-only.
- **Fix direction:** Give the Inspector the full-power value the bytes were written for:
  `resolveLaserPowerScale(...).maxPowerS` for GRBL-family current-canvas compiles, and 255 for
  `marlin-fan`. The Job Review "S max $30" fact and the "max S …" readiness text for Marlin fan
  should say the fan range is 0–255.

### P3-2 — The `$31` advisory says low powers "may burn hotter", but stock GRBL burns every power below 100% cooler and turns S ≤ `$31` almost off
- **Where:** `src/core/preflight/controller-readiness.ts:294-298` (`min-power-nonzero`).
- **Anchor:** Ground truth. gnea/grbl `spindle_compute_pwm_value`: for `rpm_min < S < rpm_max`,
  `pwm_value = floor((rpm-settings.rpm_min)*pwm_gradient) + SPINDLE_PWM_MIN_VALUE`, with
  `pwm_gradient = SPINDLE_PWM_RANGE/(rpm_max-rpm_min)`. For `S ≤ rpm_min`, S > 0 gives
  `SPINDLE_PWM_MIN_VALUE`, which `cpu_map.h` defines as 1 of 255. grblHAL is the same when
  `$35` (PWM minimum) is 0: `min_value` falls back to `max_value * 0.004`.
- **Scenario:** The controller reports `$31=100`, `$30=1000`. KerfDesk emits the same S as at
  `$31=0` (LightBurn does too). GRBL then burns:
  - 60% at 55.7%;
  - the 34.9% grey at 27.8%;
  - the 10.2% grey, and every Line at 10% or less, at 0.4%.
  Job Review's only `$31` note says these values "may burn hotter than expected", so an operator
  who sees weak marks is told the opposite of what is happening. "Hotter" is true only on grblHAL
  with `$35` set above the share `$31` represents.
- **Evidence:** SOURCE + calculation from the GRBL formula (`e1-repros/firmware-pwm.mjs`):
  `$31=100 $30=1000: S600->142 (55.7%), S349->71 (27.8%), S102->1 (0.4%), S100->1 (0.4%)`.
  https://github.com/gnea/grbl/blob/master/grbl/spindle_control.c ,
  https://github.com/gnea/grbl/blob/master/grbl/cpu_map.h .
  Not KNOWN: 03-P2-5 and ADR-567 Amendment 1 replaced this text only for `$30 ≤ $31`.
- **Refuter:** **CONFIRMED** (P3 kept). What would refute it: GRBL holding a floor at `$31`
  that lifts low S. It does not, on a stock build.
  - gnea/grbl master `spindle_control.c`, fetched independently (non-piecewise branch L192-215):
    - `rpm <= settings.rpm_min` with S > 0 gives `SPINDLE_PWM_MIN_VALUE`;
    - otherwise `floor((rpm-settings.rpm_min)*pwm_gradient) + SPINDLE_PWM_MIN_VALUE`;
    - `pwm_gradient = SPINDLE_PWM_RANGE/(rpm_max-rpm_min)` (L45).
  - `cpu_map.h` L133 sets `SPINDLE_PWM_MIN_VALUE 1`. The `config.h` L350 override (`5`) is
    commented out by default.
  - Recomputed at `$31=100`, `$30=1000`:
    - S600 → 142 (55.7%);
    - S349 → 71 (27.8%);
    - S102 → 1 (0.4%).
  - Every S below `$30` maps lower than at `$31=0`. "Hotter" holds only for S ≤ 3 of 1000, and
    there the 0.4% PWM-1 floor applies even at `$31=0`.
  - grblHAL core master `spindle_control.c` independently agrees. L907 raises S > 0 to `rpm_min`,
    L1004 uses `floorf((rpm - rpm_min) * pwm_gradient) + min_value`, and L1071-1072 makes
    `min_value` `max_value*0.004` when `$35`=0. So the advice is backwards unless `$35`, or a
    custom `SPINDLE_PWM_MIN_VALUE`, raises the floor.
  - Not KNOWN: the 2026-10-21 ledger's 03-P2-5 covers only `$31 ≥ $30`.
- **Fix direction:** Reword per firmware. On stock GRBL, say that S is mapped from `$31` to `$30`,
  so every power below 100% burns weaker and S at or below `$31` barely fires; ask for `$31=0`. On
  grblHAL, mention `$35`. Keep it a warning (ADR-565).

### P3-3 — A Marlin profile S max above 255 wraps on stock laser builds, with no warning (Smoothieware's equivalent wrap has one)
- **Where:** `src/ui/laser/DeviceProfilePowerFields.tsx:47-48` (S max accepts any whole number for
  Marlin); `src/core/output/marlin-strategy.ts` / `marlin-inline-transform.ts` (S written as
  `scaleS` in the profile range, version 1). The twin guard
  `src/core/devices/smoothie-power-scale.ts:25` is wired only for Smoothieware
  (`machine-job-warnings.ts:79`).
- **Anchor:** Ground truth + Twin. Marlin 2.1.2.5 `spindle_laser_types.h`: `cutter_power_t` is
  `uint8_t` unless `CUTTER_UNIT_IS(RPM) && SPEED_POWER_MAX > 255`. `gcode.cpp` L237-240 passes the
  float S through `cutter.power_to_range(v)` (a `cutter_power_t` parameter) and, with
  `LASER_POWER_TRAP`, through `upower_to_ocr(u)`. The float → `uint8_t` conversion of a value
  above 255 is undefined in C++. GCC targets keep the low byte, so it wraps rather than clamps.
- **Scenario:** A Marlin inline profile keeps S max 1000, for example after switching an existing
  GRBL profile to Marlin. A 60% layer emits `S600`, which runs as 88/255 (34.5%); 100% (`S1000`)
  runs as 232; and an S of exactly 256 runs as 0. The PERCENT build with the 255 starter is the
  opposite case: every layer at 39.2% or more runs at 100%. The catalogue note
  (`profile-catalog.ts:119`) and the dialect description ask the operator to match
  `CUTTER_POWER_UNIT`, but Job Review says nothing. For Smoothieware's equivalent wrap, Job Review
  carries `smoothiePowerScaleWarning`.
- **Evidence:** SOURCE + READ. The uint8 low byte of 600/1000/256 is 88/232/0
  (`firmware-pwm.mjs`). Compiler behaviour on a real board was not run.
  https://github.com/MarlinFirmware/Marlin/blob/2.1.2.5/Marlin/src/feature/spindle_laser_types.h ,
  https://github.com/MarlinFirmware/Marlin/blob/2.1.2.5/Marlin/src/gcode/gcode.cpp .
  Note: the 2026-09-25 CN track says PWM255 "clamps S12000 to full output". That holds only for
  `uint16_t` builds (RPM unit, `SPEED_POWER_MAX > 255`); the refuter should settle which applies.
- **Refuter:** **CONFIRMED** (P3 kept; one scenario path corrected). What would refute it: a
  clamp before the narrowing conversion. There is none.
  - Marlin 2.1.2.5, fetched independently:
    - `spindle_laser_types.h`: `cutter_power_t` is `uint8_t` unless
      `CUTTER_UNIT_IS(RPM) && SPEED_POWER_MAX > 255`.
    - `Configuration_adv.h` L3372 defaults to `CUTTER_POWER_UNIT PWM255`, and L3413 sets the
      laser's `SPEED_POWER_MAX 100`.
    - `spindle_laser.h` L162 declares
      `power_to_range(const cutter_power_t pwr, …)`. The float S is narrowed to `uint8_t` at the
      call (`gcode.cpp` inline `G1 … S`: `cutter.power_to_range(v)`; `M3-M5.cpp` L94 the same).
      The `constrain` inside runs on the already narrowed byte, so it cannot clamp.
    - With `LASER_POWER_TRAP`, `upower_to_ocr(u)` narrows the same way.
  - Compiler evidence (Compiler Explorer, a Marlin-shaped `float → uint8_t power_to_range(uint8_t)` call):
    - ARM GCC 10.3, `-mcpu=cortex-m4 -mfloat-abi=hard`: `vcvt.u32.f32` then `ldrb` (low byte).
    - AVR GCC 10.3, `-mmcu=atmega2560`: `__fixunssfsi` then `mov r24,r22` (low byte).
    - x86 GCC 13.2, executed: S600/1000/256/12000/153 → `88 232 0 224 153`.
    - So the value wraps on every common Marlin target; it never clamps.
  - The 2026-09-25 CN-track note that PWM255 "clamps S12000 to full output" is wrong. PWM255
    makes `cutter_power_t` `uint8_t` whatever `SPEED_POWER_MAX` is, so S12000 runs as 224
    (87.8%). Only RPM-unit builds with `SPEED_POWER_MAX > 255` clamp.
  - Correction: the example "after switching an existing GRBL profile to Marlin" does not happen
    in Machine Setup. `controllerProfileForSelection` resets `maxPowerS` to 255 for Marlin
    (`device-setup-controller-selection.ts:25-26,123-127`). The `profileWithControllerFacts`
    merge, which keeps S max, has no production caller. The remaining reach is typing an S max
    above 255 into the Marlin S max field, which accepts 1..100000 (`DeviceProfilePowerFields.tsx:44-48`),
    or a PERCENT build left on the 255 starter. Both are operator misconfiguration that the
    catalogue note warns about, so the severity stays P3.
- **Fix direction:** Add a Job Review warning, like `smoothiePowerScaleWarning`, when a Marlin
  inline profile's S max is not 255 (PWM255) or 100 (PERCENT). It should say that stock laser
  builds hold S in one byte and that RPM builds need `SPEED_POWER_MAX` to match.

## Known (not re-raised)

- 03-P2-4 / 03-P2-5 (small `$30`, `$30=0`, `$30 ≤ $31`): fixed by #1349 / ADR-567 Amendment 1;
  P2-1 is a FluidNC gap in that fix, not a repeat.
- 03-P2-2 and 03-P3-1 (Marlin continuous power at air changes and keep-alive).
- 03-P2-8 (motion manifest reads Smoothieware burns as travel).
- 03-P3-3 (raster float noise; version 3 now keeps 12 significant digits).
- 03-P3-11 (traced-artwork warning names M4 on Marlin).
- 03-P3-15 (Save toast compares against the saved profile while bytes use the connected `$30`).
  This is the same execution-copy-vs-saved-profile pattern as P3-1, but a different consumer.
- C6-P2-1 (Smoothieware `M221 S0` after Frame/jog/Home; PR #1380).
- D5-P2-2 (`$32=0` lit rapids on external runs; PR #1390).

## Refuted

Candidates considered and dropped:
- **Smoothieware `G1 … S0` runways burn at `laser_module_minimum_power`.** True in `Laser.cpp`
  L279 (`(max−min)·power + min` for any G1 block). But it is disclosed: the profile note and the
  Machine Setup guide say to set it to 0, and saved G-code carries
  `; assumes: laser_module_minimum_power=0`.
- **Marlin M4 layers run as continuous `M3 I`.** Deliberate (ADR-398 Amendment 1; `M4 I` derives
  power from the feedrate, `M3-M5.cpp`), and `CutPowerModeField.tsx:9-16` replaces the M3/M4
  choice with an explanation on Marlin.
- **Focus Test power check on Smoothieware.** It uses version 1 rounding, so S max 1 would refuse
  any power below 50%. Unreachable: `focusTestProfileIssue` refuses non-GRBL-family profiles first
  (`focus-test.ts:121-126`).
- **Min power applied to vectors.** Not applied on any dialect, and the UI shows Min Power only
  for grayscale, matching LightBurn's "only" DSP-or-Grayscale rule.

## Verified clean

- **Vector S (L1/L2):** whole ranges of 100 or more use `Math.round(p·max)` (half-up, so the
  error is at most ±0.5 S). Smaller or fractional GRBL/grblHAL ranges use 0.1% steps, which both
  firmwares keep as float. No positive percentage of 0.05% or more emits S0 at S1000; S0 is never
  rounded up.
- **Raster S mapping:** grayscale is `round(sMin + strength·(sMax−sMin))` and white is exactly 0.
  Dithered pixels are `sMax` or 0, and min power is unused for them. Marlin fan and Smoothieware
  round-trip through their compile ranges (255 / 1000) without drift (table rows above).
  `rescaleRasterValuesForVersion` keeps 12 significant digits.
- **Min power (Q2):** used only for grayscale images on every dialect; never sent as a firmware
  floor, and `$31` is not adjusted for (same as LightBurn). See P3-2 for the advisory text.
- **Mode switching (Q4):** M4→M3 is `M3 S0` and M3→M4 is `M5`, `M4 S0`. Raster manages its own
  arm and `M5`. Smoothieware gets `M400` before every `M221` (M-codes run immediately in
  `Laser.cpp`), with `P1` for Constant and `P0` for Dynamic, as `disable_auto_power = P > 0`
  requires. Marlin gets `M5 I` / `M3 I S0` at every mode word. `$32=0` is a known readiness
  warning.
- **Smoothieware S rewrite:** `rescaleSWords` touches only code text, never `;` or `( )`
  comments, and runs before `nativePowerModes` inserts `M221 S…`, so the `M221` percent is never
  rescaled. `formatPower`'s 6 decimals are finer than the firmware's 1/2048 storage.
- **Marlin fan:** S0 and travel become `M107`; runways are dark; values are clamped to 0–255
  before writing; arcs are never emitted for Marlin or Smoothieware (`laser-arc-moves.ts`).
- **FluidNC and Falcon defaults:** the generic FluidNC profile's S max 255 equals FluidNC's Laser
  default `speed_map`. FluidNC's `$30` is the `speed_map` top and is used as the connected range.
  The Falcon A1 Pro's S1000 matches Creality's LightBurn bundle and is disclosed as unverified.
- **Twins (Q5):** the canvas raster preview compiles and normalises with the same device
  (`draw-raster-preview.ts:262-270`). Job Review shows the effective percentage and discloses a
  connected `$30` that differs from the profile. The Inspector's raw S column and "Power range"
  show the emitted values. `vectorPowerReachesController` uses each dialect's compile range,
  except for FluidNC truncation (P2-1).
- **Tab spans:** `power = cut.power × tab%` goes through the same `scaleS`.

## Not verified

- No hardware, air-cut or material runs. Duty values come from firmware source, not measured
  output.
- The Marlin float → `uint8_t` wrap (P3-3) is undefined behaviour in C++. The refuter checked
  ARM Cortex-M4 and AVR GCC 10.3 code generation (low byte kept) and ran it on x86, but no board
  was run. Also not checked: `FAN_MIN_PWM`/`FAN_MAX_PWM`/`FAN_KICKSTART_TIME`/soft-PWM
  effects on fan-wired lasers, and `LASER_SYNCHRONOUS_M106_M107` timing.
- grblHAL with `$35`/`$34` PWM limits or spindle linearisation, and FluidNC non-linear or
  offset `speed_map`s (for example `0=0% 0=12% 1000=100%`), were not modelled.
- LightBurn's exact byte form for Marlin and Smoothieware was not fetched (its docs only say
  GCode lasers hide Min Power except in Grayscale).
- Out of scope: low-power Fire and positioning-mark power (ADR-566), material/interval test
  labels (E5), resume and second-pass power rewriting (C1), Ruida.

```json
[
  {"id":"P2-1","severity":"P2","area":"ctl-power-mapping","file":"src/core/output/laser-power-scale-version.ts","line":22,"anchor":"Ground truth: FluidNC SpindleDatatypes.h typedef uint32_t SpindleSpeed, GCode.cpp pl_data->spindle_speed = gc_state.spindle_speed; Contract: ADR-567 Amd 1 (decimal S assumed), NN7","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"FluidNC truncates the fractional S of ADR-567 Amd 1's virtual range: at $30=1 every power below 100% emits S0.x and burns nothing; at $30=20 values lose up to 5% downward, while Job Review shows the percentage"},
  {"id":"P3-1","severity":"P3","area":"ctl-power-mapping","file":"src/ui/gcode-inspector/gcode-inspection-source.ts","line":125,"anchor":"Twin: save-gcode-emission.ts:60 connected $30 bytes vs saved-profile divisor; live-run Inspector uses execution device (canvas-motion-plan.ts:182); Marlin fan always 0-255; Contract NN7","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Inspector burn shading and energy use the saved profile S max: connected $30=255 vs profile 1000 shades 60% as 15.3%; Marlin fan with S max 1000 shades M106 S153 as 15.3%"},
  {"id":"P3-2","severity":"P3","area":"ctl-power-mapping","file":"src/core/preflight/controller-readiness.ts","line":297,"anchor":"Ground truth: gnea/grbl spindle_compute_pwm_value floor((rpm-rpm_min)*pwm_gradient)+SPINDLE_PWM_MIN_VALUE, cpu_map.h SPINDLE_PWM_MIN_VALUE 1","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"The $31>0 advisory says low powers may burn hotter; stock GRBL maps S from $31 so every power burns cooler (60% -> 55.7% at $31=100) and S<=$31 fires at 0.4%"},
  {"id":"P3-3","severity":"P3","area":"ctl-power-mapping","file":"src/ui/laser/DeviceProfilePowerFields.tsx","line":48,"anchor":"Ground truth: Marlin 2.1.2.5 spindle_laser_types.h uint8_t cutter_power_t, gcode.cpp power_to_range(v); Twin: smoothie-power-scale.ts warning exists only for Smoothieware","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"A Marlin inline profile S max above 255 wraps on stock laser builds (S600 -> 88, 34.5%) and a 255 profile on a PERCENT build saturates at 39.2%; no Job Review warning"}
]
```
