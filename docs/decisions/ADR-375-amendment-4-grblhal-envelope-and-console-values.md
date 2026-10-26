## ADR-375 Amendment 4 - grblHAL's jog envelope, and Console setting values grblHAL stores differently (2026-10-22)

**Status:** Accepted; decisions 3 and 4 amended by
[Amendment 5](ADR-375-amendment-5-grblhal-evidence-under-a-grbl-profile.md) (the grblHAL value
check also applies on a stock-GRBL profile whose controller shows grblHAL; the re-read reports a
value stored in part on every driver). | **Date:** 2026-10-22

Amends ADR-375 decisions 3 and 9, after controller audit v2 (2026-10-22) findings C3-P2-1, C3-P2-2
and C4-P2-1. Sources are grblHAL core at `d7aaee3d`, the commit ADR-375 pins, and master `62f25d4`
(build 20261015) where it differs. No hardware was available, so none of this is hardware evidence.

### Context

- **Force set origin on grblHAL.** ADR-375 decision 3 gives grblHAL a hold clamp "from grblHAL's
  own envelope" after this session's Home. KerfDesk took force set origin only from stock GRBL's
  `$I` `[OPT:]` Z and never asks grblHAL for `$I`. Without force origin, a negative-homing axis
  could lie in [0, travel] or in [-travel, 0], so with an X or Y bit in `$23` the grblHAL hold had
  no envelope and asked for a whole bed width. With `$20=1` and `$40=0` (its default) grblHAL
  refuses such a jog with error:15
  ([motion_control.c L832-L835](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/motion_control.c#L832-L835)),
  so every hold failed with a message asking the operator to shorten a distance they never chose.
  grblHAL keeps force set origin in `$22` bit 3, "Set machine origin to 0"
  ([settings.h L714-L718](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.h#L714-L718)).
  At COMPATIBILITY_LEVEL 1 or below `$$` prints the whole `$22` bitfield and lists the extended
  settings, `$384` among them; above that `$22` is 0 or 1, and force origin is a build default no
  setting reports
  ([settings.c L1775-L1782](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L1775-L1782),
  [system.c L300-L317](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L300-L317),
  [settings.c L2475-L2477](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2475-L2477)).
  Without force origin a homed axis's envelope is [-travel + pull-off, -pull-off] whatever `$23`
  says
  ([machine_limits.c L116-L140](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/machine_limits.c#L116-L140)).
- **Soft limits off.** Without a verified bed frame, KerfDesk used the firmware envelope only with
  `$20=1`. grblHAL never has a frame, and `$20=0` is its default
  ([config.h L1048](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/config.h#L1048)),
  so a homed grblHAL with hard limits on got no pull-off inset: a held arrow toward the homing
  corner ran onto the switch, raising `ALARM:1` and losing the position. Decision 3's hard-limit
  bullet is not conditioned on soft limits, and homing rests the head the pull-off inside the
  switch whether or not they are on
  ([machine_limits.c L144-L160](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/machine_limits.c#L144-L160)).
- **Console values on grblHAL.** Decision 9 left grblHAL's `$N=` values to the firmware because
  "grblHAL refuses such values itself". That holds for a non-zero fraction and for a value outside
  the limits a setting declares, but not in general:
  - grblHAL keeps every character after `=` in a `$` line and reads only the number at the start,
    then answers `ok`
    ([system.c L1139-L1213](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L1139-L1213),
    [settings.c L3527-L3552](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L3527-L3552)).
    So `$100=26,67` stores 26 and `$110=5O00` stores 5, on `d7aaee3d` and on master.
  - `d7aaee3d`'s `read_uint` takes each zero after the point as one more digit
    ([nuts_bolts.c L194-L244](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/nuts_bolts.c#L194-L244)),
    so `$1=255.0` stores 2550, and `$22=1.0` parses to 10 and ends with homing and soft limits
    off. Build 20261015 fixed this; KerfDesk cannot tell builds apart.
  - `$26` (homing debounce) is a 16-bit setting with no maximum, so `$26=70000` is stored as 4464
    ([settings.c L2392](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2392),
    [settings.c L3590-L3592](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L3590-L3592)).
  - The Console then re-read `$$` without comparing it with the typed value, so nothing told the
    operator.

### Decision

1. **grblHAL's force set origin comes from `$22` bit 3** (amends decision 3). The settings
   snapshot reads it when the dump shows the whole bitfield: `$22` above 1, or `$384` listed. The
   grblHAL hold clamp uses it, so its envelope is known for every `$23`. A COMPATIBILITY_LEVEL 2
   dump (`$22` 0 or 1, no `$384`) keeps the unknown force origin, and the full-travel hold, for an
   axis that homes toward its minimum.
2. **A Home in this session bounds the hold with soft limits off** (amends decision 3). Without a
   frame, the firmware envelope now applies when soft limits are on or when this session's Home
   was confirmed. With soft limits off it keeps the switch inset (`$27`, both edges on grblHAL as
   its own envelope does) and no rounding margin, since nothing is refused. This covers stock GRBL
   homed without a frame too. Before a Home, the hold still asks for full travel, as do FluidNC,
   Marlin, Smoothieware, Ruida and vendor command sets.
3. **The Console checks grblHAL values for the GRBL settings KerfDesk knows** (corrects
   decision 9). For `$0`–`$6`, `$10`–`$13`, `$20`–`$27`, `$30`–`$32` and the X, Y and Z settings
   `$100`–`$132`, a value is sent only if the Machine Settings encoder (`encodeGrblSettingValue`)
   would send it unchanged: one decimal number, a whole number for a whole-number setting, no
   exponent, within the line and float limits, and `$26` no larger than 65535. A value grblHAL
   reads alike on every build (`+25`, `025`, `25.`, `0.0`) passes. Anything else is refused before
   the confirmation prompt, naming the line to send instead. This is refusal kind (a), as on stock
   GRBL. grblHAL's other settings, strings,
   addresses, passwords and plugin settings among them, are left to the firmware, because their
   formats differ by build and plugin.
4. **The Console compares the `$$` re-read with the typed value.** After an acknowledged Console
   `$N=` write on stock GRBL or grblHAL, a numeric value is compared at the precision the
   controller printed. On grblHAL a value that is not one number counts as a mismatch only when
   the setting reads back as a number, so text settings are not flagged. A mismatch is shown in the
   Console transcript and set as the last write error, naming the stored value. The write stays acknowledged, and the
   settings table shows what the controller stored.

### Consequences

- A grblHAL laser homing toward −X or −Y with soft limits on can press-and-hold again, and a homed
  grblHAL with soft limits off stops a held arrow the pull-off clear of its switch.
- With soft limits off the box still comes from `$130`/`$131`, so where travel is set shorter
  than the machine, a hold toward the far edge stops early. Step jogs still reach it.
- A COMPATIBILITY_LEVEL 2 grblHAL build is unchanged for negative-homing axes. `$I` `[OPT:]` Z
  (controller design audit D-4) would cover it, but grblHAL is still not asked `$I`.
- Malformed Console values for the known settings no longer reach grblHAL. A plugin setting typed
  wrongly still reaches it, and the re-read comparison reports the stored value.
- No change to Frame, Start, step jogs or typed head moves. No refusal of Frame, Start, Save G-code
  or output.
