## ADR-180 Amendment 7 - On FluidNC a CNC Pause never lifts, and the Resume advice names `spinup_ms` (2026-10-22)

**Status:** Accepted. | **Date:** 2026-10-22

### Context

Amendment 2 made CNC Pause send the safety-door byte (`0x84`), so the controller stops in place
and switches the spindle off. The FluidNC driver uses GRBL's realtime bytes, so FluidNC gets the
same door pause. ADR-411 then added Pause and lift, but only on GRBL 1.1 and grblHAL. On FluidNC
the bit therefore stays in the cut.

Amendment 5, decision 2, worded the `$32=0` Resume advice around GRBL's door delay: "Resume
restarts the spindle, waits a fixed spin-up delay (4 s in stock GRBL), then continues". FluidNC
has no such delay. Read from bdring/FluidNC `main` on 2026-10-22:

- `Parking.cpp`: the door resume (`unpark`) runs `restore_spindle()`, which is
  `spindle->setState(saved_spindle, saved_spindle_speed)`. It adds no wait of its own.
- `Spindle.cpp` `spindleDelay`: the only wait is `_spinup_ms * up / maxSpeed()`, scaled by the
  RPM change.
- `Spindle.h`: `spinup_ms` is "@default 0".
- The FluidNC wiki's Spindles page (<http://wiki.fluidnc.com/en/config/config_spindles>) agrees.
  `spinup_ms` (0 to 60000 ms, default 0) is "the time that will be given for the spindle to spin
  up to maximum RPM as defined in the speed map", and the wait is proportional to the RPM change.
- An RS485 (Modbus) VFD that reports its speed is polled until it reaches it, so it is not
  affected (audit refuter, `VFDSpindle.cpp`).

So an on/off, relay, PWM, 0-10 V or H-bridge spindle with `spinup_ms` left at 0 continues the
interrupted line at cutting feed as soon as the spindle is switched on. The bit is dragged through
the cut while it speeds up, which is the CNC audit's MC-1 hazard, and the advice said the
opposite. This is controller audit v3 finding D4-P2-2, confirmed by an independent refuter.

A plain feed hold (`!`) would keep FluidNC's spindle turning. Amendment 2 chose the door byte
because the maintainer requires Pause to stop the spindle, so that choice stands.

### Decision

1. **FluidNC stays out of Pause and lift.** The lift stays qualified on GRBL 1.1 and grblHAL only,
   for two reasons:
   - The lift checks for parking by looking for `P` in `$I`. FluidNC prints `P` whatever its
     YAML says (`Report.cpp` adds `"PH"` unconditionally). Its parking is the YAML setting
     `parking: enable`, which defaults to false and which KerfDesk does not read. So KerfDesk
     cannot confirm that the firmware will not park the bit itself.
   - The lift's reset and restart were read from GRBL and grblHAL source and run on the GRBL
     simulator. FluidNC's `protocol_do_rt_reset` appears to follow the same rule: no alarm at a
     completed hold, because `protocol_do_cycle_stop` clears `executeHold` and
     `executeSysMotion`. But nothing has run the lift against FluidNC, in simulation or in an
     air cut.

   On FluidNC, the advice prefers **ABORT JOB** and pass recovery, as the laser-mode advice
   already does.
2. **The firmware check comes first, and the banner decides.** The lift asks which firmware it is
   on before it reads any settings. It uses the firmware the welcome banner names, or the
   connected driver until a banner arrives (`cncPauseControllerKind`). So a GRBL profile
   connected to FluidNC firmware is refused too. The reason given is "KerfDesk does not lift the
   bit on FluidNC." Checking first matters because the parking check cannot speak for FluidNC.
   Whenever KerfDesk parsed FluidNC's `$I` line, that check would say "The controller parks the
   spindle itself", which is false for FluidNC's default configuration.
3. **The FluidNC Resume advice stands alone.** With `$32=0`, or with `$32` unreported, it says:
   - KerfDesk does not lift the bit on FluidNC, so the bit is still in the cut unless parking
     is on in the FluidNC configuration (KerfDesk cannot read that setting);
   - Resume restarts the spindle and waits only the spindle's `spinup_ms`, which is 0 unless set
     (an RS485 VFD that reports its speed is waited for);
   - with no wait, the bit is fed through the cut while it is still speeding up;
   - prefer **ABORT JOB** and recover from the Interrupted job card;
   - to make Resume wait, set `spinup_ms` in the spindle's section of the FluidNC configuration
     to the spindle's time to full speed (FluidNC wiki, Spindles).

   It does not start with the lift's skip reason or say "Resume tries to lift it first", because
   on FluidNC that retry is always refused. With `$32=1`, which on FluidNC means a Laser spindle
   type, it says Resume restarts motion with no spin-up. It also says to configure a router
   spindle in the FluidNC configuration rather than to send `$32=0`, because FluidNC's `$32` is
   read-only (Amendment 6).
4. **The Pause message does not promise a lift on FluidNC.** It says the bit stays in the cut
   unless parking is on in the FluidNC configuration.
5. **Everything stays advisory.** Pause still sends the door byte, and Resume is never refused
   (PROJECT.md non-negotiable 21).

### Consequences

- A FluidNC router operator is told at Pause and at Resume that the bit stays in the cut and how
  long Resume waits. They are pointed to Abort and pass recovery (ADR-215), or to the one setting
  that makes the wait real.
- A nonzero `spinup_ms` also delays every `M3` and RPM change in a job, on top of KerfDesk's own
  `G4` spin-up dwell. That costs only time.
- GRBL and grblHAL are unchanged: same advice, same lift. grblHAL's door delay is its `$392`, not
  GRBL's fixed 4 s. The existing wording names stock GRBL and is left as it is.
- Follow-up: to qualify Pause and lift on FluidNC, KerfDesk would need to read FluidNC's YAML
  parking setting instead of `$I`, run the lift against FluidNC's reset, and complete an air cut.
- Controller audit v3 D4 also found two small machine-hours faults, fixed alongside this
  amendment; neither changes a decision. The hours clock now identifies a job by its motion and
  start time. Pause and lift re-issues the plan with a new position epoch, and that no longer
  counts one job as two (D4-P3-1). The hours panel also reloads when another window writes the
  hours (D4-P3-4).
- Based on FluidNC source and its wiki, not on hardware.
