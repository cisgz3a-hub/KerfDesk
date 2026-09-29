## ADR-375 - Controller audit 2: origins kept through a failed probe, unreported work offsets, and motion inside the firmware's limits (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

A second audit of the controller layer and the controller settings (requested 2026-09-24), checked
line by line against pinned firmware source: gnea/grbl v1.1h at `bfb67f0c`, grblHAL/core at
`d7aaee3d` and FluidNC at `fdc17a2c`. It found 36 faults. A separate controller audit on
2026-09-25 (`docs/audits/2026-09-25-controller-full-audit.md`; ADR-393, ADR-400, #923 and #932)
fixed nine of them and part of four more on main before this work landed, so this decision records
only what main still lacked. Each fix below was reproduced with a focused test against the store
or the GRBL simulator before it was made. No hardware was available, so none of this is hardware
evidence.

Builds on ADR-361 and ADR-362 (the first controller audit), ADR-393 (critical events offer Reset)
and ADR-400 (GRBL-family protocol). The frame-first Start contract (ADR-228, PROJECT.md
non-negotiable 21) is unchanged: every refusal added below names its kind, (a) the transport cannot
carry the work or (c) the handoff is inconsistent, and everything else is a Job Review warning.

### Context

GRBL 1.1h and grblHAL at its default `COMPATIBILITY_LEVEL 0` differ in ways KerfDesk's controller
layer had flattened into one model: whether soft limits apply before homing, whether a failed probe
resets anything, and when the work offset is reported. Several manual-motion and placement paths
therefore sent moves the firmware refuses, or trusted values the controller had not reported yet.

### Decision

1. **Origins that outlive a failed probe and a corner probe** (M-1, M-2).
   - A failed probe, `ALARM:4` (the probe was already triggered, or on grblHAL is not connected) or
     `ALARM:5` (no contact within the travel), stops only the probe move and resets nothing: GRBL
     and grblHAL do not count either as critical, FluidNC only enters Alarm, and `$X` only returns
     to Idle, so the machine position and every work offset, a G92 included, still hold
     ([motion_control.c L273-L298](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L273-L298),
     [system.c L160-L165](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L160-L165)).
     These two alarms now keep the XY origin, and an Unlock that clears one of them (the Alarm
     banner's or a Console `$X`) no longer hides the reported position or drops the origin. Work Z,
     Home and Frame evidence are still cleared, as for every alarm, and a position that was already
     untrusted before the probe stays untrusted. The alarm an Unlock clears is read before `$X` is
     sent, because the first report out of Alarm clears `alarmCode` and can be handled before the
     `ok`. Frame's blocked-start Unlock offer then says the position and origin were kept and
     continues the Frame once the controller reports Idle.
   - Other probe alarms still count as a reset: grblHAL's `ALARM:13` (probe protection) marks the
     position lost when the motors were stepping, and FluidNC's `ALARM:18` (probe hard limit)
     stops stepping at once
     ([grblHAL protocol.c L568-L571](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L568-L571),
     [FluidNC MotionControl.cpp L439-L445](https://github.com/bdring/FluidNC/blob/fdc17a2c9c0367b07345c16da3937ff0739d4702/FluidNC/src/MotionControl.cpp#L439-L445)).
     A text alarm (Smoothieware) names no code and keeps the reset behaviour.
   - `G10 L20` stores the work offset as MPos - G92 - WPos
     ([gcode.c L550-L553](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L550-L553)),
     so a corner probe run while Set origin here's G92 was active stored a corner that moved by
     that G92 at the next reset on stock GRBL and FluidNC. The corner cycle now sends `G92.1` right
     before its single `G10 L20 P0` commit, after the sixth contact, so a failed contact still
     leaves the operator's origin as it was. A settled corner cycle is recorded as a saved G54
     origin and trusts status reports again, as Set origin here does; its start makes anything
     bound to the old origin, such as a Place Board registration, stale.
   - The Z touch-off keeps any G92: `G10 L20` works per axis and Set origin here writes only
     `G92 X Y`, so a `G92.1` there would drop the operator's XY origin, and every reset or `G92.1`
     that later drops a G92 Z already voids work-Z evidence.
   - No new refusal.

2. **Manual motion inside the firmware's limits** (M-3, M-5).
   - With `$20=1`, stock GRBL checks every jog target against its travel whether or not it is
     homed, from its own machine position, and refuses the whole line with `error:15`
     ([jog.c L35-L37](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/jog.c#L35-L37),
     [system.c L346-L349](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L346-L349)).
     When this session's `$$` shows soft limits on, press-and-hold jog is clamped in machine
     coordinates to the envelope from `$130`/`$131`, `$23` and this session's `[OPT:]` Z, with or
     without a verified bed frame and whatever the profile's homing setting. Each enforced edge
     stays 0.01 mm inside, because the status report rounds MPos to three decimals
     ([config.h L142-L143](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/config.h#L142-L143)).
   - After Unlock without Home (or Release motors, a failed Home, an origin write that ended
     unknown) KerfDesk hides the reported position, but stock GRBL still checks from its own MPos
     and `$X` leaves that position as it was. On stock GRBL with this session's `$20=1`, the hold
     then aims from the controller's MPos in the latest status report. Only the hold clamp reads
     that number (`withheldControllerMPos`); placement, Frame, Start, the bed mapping, Move laser
     here and the position readout still see no position.
   - grblHAL enforces soft limits on homed axes only, so its clamp applies after this session's
     Home, from grblHAL's own envelope
     ([machine_limits.c L114-L136](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/machine_limits.c#L114-L136)).
     Without a `$$` read (the Falcon's vendor command set), on FluidNC, Marlin, Smoothieware and
     Ruida, or with WPos-only reports after Unlock, the hold is unchanged: it asks for full travel
     and relies on release plus the jog-cancel byte.
   - With hard limits on (or `$21` unread), hold-to-jog and Move laser here stop `$27` short of the
     homing switch on each axis's homing side (1 mm when `$27` is unread, as gSender does). Homing
     rests the pull-off inside the switch edge so the switch does not trip again, and a hard limit
     resets the controller into `ALARM:1` with the position lost
     ([limits.c L366-L384](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L366-L384),
     [limits.c L110-L128](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L110-L128)).
     No inset with `$21=0` or with HOMING_FORCE_SET_ORIGIN, whose homing edge is already the rest
     point.
   - Both only shorten a move KerfDesk already sends. Step jogs, typed head moves and Frame corners
     are unchanged (ADR-232 leaves those limits to the controller). No new refusal.

### Consequences

- The GRBL simulator models more stock GRBL behaviour: `G10 L20` with an active G92, a failed
  `G38.2` (`probeFailure`), and, both off by default, the power-up lock into Alarm with homing on
  (`homingInitLock`) and the `error:15` check of a `$J=` target once `$20=1`.
- Still open for the origin: FluidNC enters Alarm before it prints the alarm line, so an
  `<Alarm|>` report that arrives before `ALARM:5` still drops a G92 origin; a Console `$X` with
  no alarm active still hides the position.
- Still open: grblHAL keeps an axis homed through `$X` and resets, but KerfDesk clamps only after
  this session's Home; per-axis pull-off settings in some grblHAL builds are not modelled.
