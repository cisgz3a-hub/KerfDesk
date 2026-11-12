## ADR-322 Amendment 4 - A homed grblHAL maps the bed from its own settings, and other firmware is told why it cannot (2026-11-11)

**Status:** Accepted on the audit coordinator's task for fix group G5 of user annoyance audit A2
(`docs/audits/2026-11-11-annoyance-a2/`, finding B3-P2-2), under the maintainer's standing
instruction to fix confirmed audit findings. An operator-stated mapping for the other firmware
is **not** decided here; see "For the maintainer". | **Date:** 2026-11-11

**Amends:** the bed mapping that [ADR-322 Amendment 3](ADR-322-amendment-3-falcon-a1-pro-homes-and-reads-settings.md)
applies to the Falcon A1 Pro contract and that stock GRBL 1.1 earns from `$$` and `$I`. It
builds on [ADR-637 Amendment 4](ADR-637-amendment-4-grblhal-work-area-is-its-homed-envelope.md)
(grblHAL's work area is its homed envelope) and ADR-375 (the jog envelope). An unknown mapping
still limits only display, Move laser here and advisories. Nothing here gates Frame or Start
(ADR-228, ADR-232), and no G-code changes.

### Context

Finding B3-P2-2, reproduced on the grblHAL, FluidNC, Marlin and Smoothieware simulators
(`non-grbl-evidence.simulator.test.ts`): each of them homed and confirmed, and none got a bed
mapping. `resolveNativeBedFrame` resolved one only for the Falcon A1 Pro contract or for stock
GRBL 1.1. On every other firmware:

- Move laser here was refused with "The controller-to-bed mapping is unverified. Home with a
  supported coordinate mapping before moving to a canvas point." Nothing said what a supported
  mapping is, and on these machines no Home could help.
- Every Job Review said KerfDesk cannot check where the job sits on the bed.
- The camera burn check was unavailable.
- The status line's hover said "This is normal until your machine is connected and homed."

**What each firmware's homed coordinates establish.** Checked against the sources:

- **grblHAL** ([f8f10aec](https://github.com/grblHAL/core/tree/f8f10aecdf05943e3a02b1ac3c691b666a811495)).
  - `limits_set_work_envelope` sets a homed axis's envelope from `$130`-`$132` (stored
    negative), the pull-off (`$27`) when hard limits are on (`$21`), force set origin (`$22`
    bit 3) and the axis's `$23` bit
    ([machine_limits.c L114-L139](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/machine_limits.c#L114-L139)):
    - without force origin: `travel` negated plus pull-off, up to minus pull-off;
    - with force origin, homing toward positive: the same lower edge, up to 0;
    - with force origin, homing toward negative: 0 up to travel minus pull-off.
  - An axis that is not homed gets an envelope of 0 to 0.
  - `$H` runs the homing passes `$44`-`$49` in turn and marks only each pass's axes homed
    (`sys.homed.mask |= cycle.mask`), so an axis in no pass is never homed
    ([settings.h](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/settings.h),
    `Setting_HomingCycle_1 = 44` to `Setting_HomingCycle_6 = 49`, "Axes to home in first pass").
  - `$$` lists all of these at COMPATIBILITY_LEVEL 0 or 1. Above that, `$22` is 0 or 1 and
    neither force origin nor the passes are reported.

  So a homed grblHAL's `$$` fixes its envelope in machine coordinates, exactly as a stock GRBL's
  `$$` and `$I` do. KerfDesk already modelled it for the jog clamp and the reported work area.
- **FluidNC** ([v4.0.3](https://github.com/bdring/FluidNC/tree/v4.0.3)).
  - Homing sets each axis to its `homing/mpos_mm` config value
    ([Homing.cpp `set_mpos`](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Machine/Homing.cpp)).
  - Its limits are `mpos_mm - max_travel_mm .. mpos_mm` when `positive_direction` is true, and
    `mpos_mm .. mpos_mm + max_travel_mm` otherwise
    ([Limit.cpp](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Limit.cpp)).
  - `$$` reports the travel (`$130`-`$132`) and the direction mask (`$23`, a bit set when
    `positive_direction` is false) but not `mpos_mm`, and has no `$27`
    ([SettingsDefinitions.cpp `make_proxies`](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/SettingsDefinitions.cpp),
    [Axes.cpp](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Machine/Axes.cpp)).

  So `$$` gives the envelope's size and not where it sits. `$/axes/x/homing/mpos_mm` would give
  it; KerfDesk does not ask.
- **Marlin** ([1cd56c4c](https://github.com/MarlinFirmware/Marlin/tree/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d)).
  A homed axis is set to `base_home_pos(axis)`, a build constant
  ([motion.cpp `set_axis_is_at_home`](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/motion.cpp)).
  `M211` prints the soft endstop minimum and maximum when the build has software endstops
  ([M211.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/control/M211.cpp)).
  KerfDesk does not ask for it.
- **Smoothieware** ([38e2cc08](https://github.com/Smoothieware/Smoothieware/tree/38e2cc083db0e4f768535a9bf2d32cdf104ea980)).
  A homed axis is set to `homing_position + home_offset` from the config file, 0 or 200 by
  default, and the Endstops module has no soft limits and prints no travel
  ([Endstops.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/endstops/Endstops.cpp)).

### Decision

1. **A homed grblHAL earns the bed mapping from this session's `$$`.** `nativeBedFrameStatus`
   resolves it when all of these hold, and otherwise gives none:
   - the profile's driver is grblHAL with no vendor command set, and the greeting named grblHAL;
   - the profile has homing on, and a Home was confirmed in this connection;
   - this session read `$$`, and it reported homing on (`$22`), `$21`, `$23`, `$27`, `$130`,
     `$131`, force set origin (the whole `$22` bitfield) and the homing passes (`$44`-`$49`);
   - **both X and Y are in a homing pass**;
   - the profile's bed is the envelope's size, to 0.001 mm, as the stock path already requires.
     Machine Setup offers exactly that size (ADR-637 Amendment 4).

   The envelope comes from `jogTravelLimits`, the model the jog clamp uses, with nothing
   assumed: a value the clamp would guess (`$27` unread, `$21` unread) gives no mapping here.
   The mapping is used as the stock one is: display, Move laser here, the jog box, Absolute
   advisories and the camera's bed frame. It goes when the Home goes: an alarm, a reset and a
   reconnect clear it, because each clears the confirmed Home.
2. **The Falcon A1 Pro contract and stock GRBL are unchanged.** The same checks run in the same
   order, and their tests pass unchanged.
3. **No mapping has a reason, and every surface says it** (`native-bed-unknown-reason.ts`). The
   firmware is checked first, so a family KerfDesk cannot map is never told to Home:
   - FluidNC, Marlin, Smoothieware: one sentence each saying what the firmware does not report
     or KerfDesk does not read, and that Home does not tell KerfDesk where the bed is;
   - homing off in the profile; not homed in this connection; settings not read in this
     connection; a settings report without a homed area; a profile bed that is not the homed
     area, with both sizes; a greeting that does not match the profile's controller type.

   It is shown in four places:
   - **Move laser here**: "Move laser here needs to know where the bed is." and the reason; on
     an unmappable firmware, "Jog the head to the point instead."
   - **Job Review**: the existing bed note gains "Why:" and the reason. Its opening is
     unchanged, so its rank in the list is unchanged.
   - **The status line's hover**: the reason, and "Place the job with User Origin or Current
     Position and run Frame to see where it burns." A GRBL or grblHAL profile with homing on
     keeps "This is normal until your machine is connected and homed" before it connects.
   - **The camera burn check's** "unavailable" line.
4. **Nothing new is sent to any controller.** `$44`-`$49` are read from the `$$` KerfDesk
   already requests.

### What is not covered

- A grblHAL build at COMPATIBILITY_LEVEL above 1, and one that greets as "Grbl 1.1" under a
  grblHAL profile: no mapping, with the "settings report" or "greeting" reason.
- A grblHAL whose pull-off differs per axis. At the pinned commit `$27` is one value for every
  axis; a later build with per-axis values would need this re-read.
- FluidNC, Marlin and Smoothieware: wording only.

### For the maintainer

The audit proposed a per-profile statement for firmware that reports nothing usable: "Home is
at this corner; coordinates run this way", accepted after a confirmed Home. It was **not built**.
A resolved bed frame has about 25 consumers, and for an operator-stated one each needs a
decision no ADR gives:

- whether it clamps hold-to-jog and Move laser here (a wrong statement would stop a jog short,
  or let one run into a rail);
- whether camera calibration, Print and Cut captures and the burn check may be fitted in it;
- whether Absolute advisories and no-go zone notes may cite it, and in what words.

Two routes need no statement and could give real evidence, each with new controller traffic on
firmware no hardware has qualified:

- **FluidNC:** ask `$/axes/x/homing/mpos_mm` and `$/axes/y/homing/mpos_mm` at connect. With
  `$23` and `$130`/`$131` that fixes the envelope.
- **Marlin:** ask `M211` after Home on builds with software endstops.

Smoothieware reports nothing usable, so only a statement would serve it.

### Evidence

Tests and simulators only. No machine was operated; no grblHAL, FluidNC, Marlin or Smoothieware
board was connected.

- `native-bed-frame.grblhal.test.ts`: the envelope for hard limits on and off, force origin on
  and off and all four X/Y direction masks, against an oracle written from
  `limits_set_work_envelope`; and each missing piece of evidence giving no mapping.
- `grblhal-homing-cycles.test.ts`: the pass mask.
- `non-grbl-evidence.simulator.test.ts`: the four simulators before the fix's evidence and
  after it; the grblHAL mapping cleared by an alarm, a reset and a reconnect.
- `native-bed-unknown-reason.test.ts`, `position-laser-click.test.ts`,
  `canvas-motion-badge.relative-help.test.tsx`: the wording on each surface.
- `native-bed-frame.test.ts`, `falcon-a1-pro-preset-homing.test.ts`,
  `manual-motion-limits.test.ts`: unchanged and passing.
