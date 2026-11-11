## ADR-367 Amendment 3 - Unlock hides the head position only when the alarm lost it, and every dead end names the way out (2026-11-11)

**Status:** Accepted (user annoyance audit A1, area A3, finding A3-P2-1; the maintainer approved
hiding only for alarms that lose position on 2026-11-11). | **Date:** 2026-11-11

Verified against the scripted GRBL and grblHAL simulator and the pinned firmware sources below,
not on a physical machine.

### Context

ADR-367 Context item 2 and Amendment 2 rest on one rule: an acknowledged Unlock (`$X`) voids the
reported position until Home, Set origin here, a probe or a reconnect (`controllerUnlockedPatch`).
The only exception was a failed probe (ALARM:4 or 5, ADR-375). The audit found two things wrong
with that.

1. **The rule was broader than the firmware facts, and than the app's own advice.** The Alarm
   card says of a soft limit "The position is kept, so Unlock ($X) is safe", and Unlock then hid
   the position anyway. The alarm tables already carry a `positionLost` flag per code, which
   Unlock did not read.
2. **Amendment 2 fixed the wording for Frame only.** While the position is hidden, Move to
   position said "The controller has not reported its work offset yet. Wait for a status report
   and try again." (Go) and "The head position is not known yet. Wait for a status report." (Use
   current); a Go to a Canvas position was refused by the store with "Wait for an Idle status
   report"; the origin row read "not reported yet"; and Fire was disabled under its ordinary
   tooltip. No report ends any of those waits.

### Decision

1. **Unlock keeps the position, the work offset and the XY origin evidence when the alarm it
   clears is known to keep the machine position.** `unlockPositionVerdict`
   (`position-kept-alarm.ts`) keeps them only when all of these hold; anything else hides exactly
   as before:
   - an alarm code is on record, and every firmware the session may be running lists it as
     position-kept in its alarm table: the profile's driver, the banner's, and grblHAL when the
     `$$` or `$I` shows it. The tables number codes differently (17 is a G-code error on FluidNC
     and a motor fault on grblHAL), so one dissent hides;
   - that code is the one the last `ALARM:N` line raised on this connection, and every reboot
     banner since answered a soft reset KerfDesk itself wrote. Stock GRBL clears its machine
     position at power-up, and KerfDesk keeps the alarm code on screen through any banner, so the
     record of the alarm line (`alarmRaised`) is dropped at a banner KerfDesk did not cause, and
     the Unlock that reads it clears it. A banner counts as KerfDesk's own when the reset
     transaction of Abort or Disconnect awaits it, or when KerfDesk wrote a soft reset in the
     10 s before it and no banner has answered that write yet. The Reset and Wake buttons need
     the second rule: they write their reset outside that transaction, and their recovery
     operation can end before the banner arrives. The existing `machineZeroEpoch` (ADR-341
     Amendment 13) is not reused: it also advances at the banner of a Reset or Wake, which a
     soft limit always passes through, and that count is left as it is. Release motors hides
     the position itself, and an Unlock never un-hides, so the Unlock after its Wake still
     leaves it hidden;
   - the alarm was not raised while a feed hold or door hold was on, or while KerfDesk had the
     job paused (see the soft-limit row below);
   - the controller is not still asking for a reset.
2. **Nothing else Unlock clears is kept.** Home proof, work-Z evidence, Frame evidence and the
   Frame permit go, and `trustedPositionEpoch` advances, as after any Unlock. A position that was
   already hidden stays hidden.
3. **The failed-probe branch is unchanged** and is still decided first.
4. **A position-kept alarm that asked for a reset keeps its code through the reset KerfDesk
   sent.** Stock GRBL answers nothing in its critical-event loop, so its soft limit already
   survived the banner (the code-before-banner rule of `laser-reset-alarm.ts`). grblHAL keeps
   answering status reports there, the code was dropped, and the Unlock after the reset saw no
   code. `alarmAcrossBannerPatch` keeps the code only for a position-kept alarm, only when a
   "Reset to continue" latch was on, and only through a reset KerfDesk sent. Not on FluidNC, which
   leaves its Critical state for Idle on a reset or raises a new `ALARM:14`.
5. **The Frame's Unlock offer follows the same verdict.** After a position-kept alarm the prompt
   says the controller stopped the machine under control and still knows where the head is, that
   Frame can continue, and that Frame asks for the origin next if a reset cleared it. The Frame
   goes on once the controller reports Idle, as after a failed probe. The offer reads the result
   of the Unlock itself: if the position was hidden after all, it hands over to Set origin here.
6. **The Unlock log line says which case applied:** kept after a failed probe, kept after
   `ALARM:N`, or "Position not kept:" with the reason.
7. **Where the position is still hidden, each dead end names the way out.** One sentence, the
   one Frame uses without its "Then Frame again" (`positionWithheldMessage`): "Position is unknown
   after Unlock or Release motors. Home the machine, or move the head to where the job should
   start and use Set origin here." A machine without homing gets it without Home. It is the toast
   of Move to position's Go, for typed and saved positions in either coordinate frame, and of Use
   current; the tooltip of the origin row, which reads "unknown (Home, or jog to the start and
   Set origin here)"; and the tooltip of a Fire button that is disabled while the position is
   hidden. No control is disabled or enabled differently. Unconfirmed report units keep their own
   wording, since a `$$` read restores that position.

### The alarm table, checked against the firmware

"Kept" means the firmware raises the alarm only after motion ended under control and keeps its
machine position afterwards. Sources are pinned: gnea/grbl `bfb67f0`, grblHAL/core `d7aaee3`,
bdring/FluidNC `fdc17a2` (full links in `alarm-position-kept.ts`, `probe-failure-alarm.ts` and
`alarm-codes.ts`).

| Code | Stock GRBL 1.1h | grblHAL | FluidNC | Source |
|---|---|---|---|---|
| none (power-on lock) | lost | n/a | n/a | `main.c#L47-L67`: the lock follows the line that clears the machine position |
| 1 hard limit | lost | lost | lost | `alarm_codes_en_US.csv#L2` "position is likely lost"; grblHAL `alarms.c#L30`; FluidNC `Protocol.cpp#L748-L754` disables the steppers and unhomes |
| 2 soft limit | **kept** | **kept** | **kept** | `alarm_codes_en_US.csv#L3` and grblHAL `alarms.c#L31` "Machine position retained. Alarm may be safely unlocked."; feed hold before the alarm in `limits.c#L411-L430`, `machine_limits.c#L628-L650`, `Limit.cpp#L117-L134`; position kept through the reset in `main.c#L47`, `main.c#L72-L75`, `system.h#L275-L287`, `grbllib.c#L458-L461` |
| 3 reset during motion | lost | lost | lost | `alarm_codes_en_US.csv#L4`; `motion_control.c#L380-L386`; grblHAL `motion_control.c#L1196-L1204`; FluidNC `Protocol.cpp#L1458-L1460` |
| 4, 5 failed probe | **kept** | **kept** | **kept** | unchanged, ADR-375 (`probe-failure-alarm.ts`) |
| 6 to 9 homing failures | lost | lost | lost | the cycle zeroes the axis position before each approach, `limits.c#L227-L241`, and did not finish |
| 10 | lost (dual-axis homing) | lost (E-stop) | lost (spindle control) | homing did not finish; grblHAL refuses Unlock until the E-stop is released; FluidNC not verified, kept conservative |
| 11 | n/a | lost (homing required) | lost (input on at start) | raised only while an axis that homes is not homed, `machine_limits.c#L668-L673` |
| 13 | n/a | lost (probe protection) | lost (hard stop) | grblHAL `system.c#L137-L140`, `protocol.c#L568-L571` mark the position lost when the motors were stepping |
| 14 | n/a | lost (spindle at speed) | lost (unhomed) | FluidNC `Protocol.cpp#L726-L730`: raised while an axis that homes is not homed |
| 17 | n/a | lost (motor fault) | **kept** (G-code error in a job FluidNC runs itself) | `ProcessSettings.cpp#L1377-L1383` raises it; `Protocol.cpp#L734-L764` only sets the Alarm state: no stepper stop, no unhoming |
| 12, 15, 16, 18 to 22 | n/a | lost | lost where listed | not verified as kept, so they stay conservative (ADR-644) |

One value was wrong and is corrected: **grblHAL ALARM:13 (probe protection) was marked
position-kept** in `alarm-codes.ts`. `probe-failure-alarm.ts` already cited the source showing it
is not. It is now `positionLost: true`, which also makes a run that ended on it count as possibly
having lost position for checkpoint recovery (`runStopMayHaveLostPosition`). Every other flag
agreed with the sources read.

**The power-on lock is not a position-kept case.** Stock GRBL locks a machine with homing on at
power-up, with no alarm code, straight after clearing its machine position. grblHAL raises
ALARM:11 and FluidNC ALARM:14 only while an axis that homes has not been homed. The number
reported there is not a measured position, so Unlock hides it as before.

**The soft limit has one path that does lose steps.** Stock GRBL and grblHAL run the feed hold
only from the Cycle state. A target that fails the check while a feed hold is already slowing the
machine goes straight to `mc_reset`, which kills the steppers while a hold is executing, and the
soft-limit code then replaces the abort code (the alarm is a single value: `system.c#L370-L375`).
The controller reports ALARM:2 and its "position retained" text all the same. KerfDesk therefore
records, when the alarm line arrives, whether the last report showed Hold or Door or the job was
paused, and does not keep the position then. A hold from the machine's own button that no status
report showed before the alarm is not caught; the window is the deceleration of that hold.
FluidNC waits for its planner to drain first and has no such path.

### Consequences

- No guard is created, re-added or widened (ADR-228): the Frame offer precedes a refusal that
  already existed, a declined offer reports it unchanged, and the Move to position toast replaces
  one for a move that was already refused.
- After a soft limit, Reset and Unlock, the DRO, the origin row, Move to position, Fire and Frame
  work at once. On stock GRBL the reset still clears an origin set with Set origin here, so a
  User Origin Frame asks for it; grblHAL keeps it.
- On grblHAL the Alarm card now names the soft limit after the reset, as it already did on stock
  GRBL, instead of a generic Alarm.
- An ALARM:3 from Abort, the commonest alarm on a machine without homing, still hides the
  position: the reset stopped the motors mid-move. The Abort card's Restore saved origin (ADR-341
  Amendment 11) and the wording of item 7 are the ways out there.
- Tests: `alarm-position-kept.test.ts`, `position-kept-alarm.test.ts`,
  `start-blocked-alarm-offers.test.ts`, `position-withheld-wording.test.tsx` and
  `unlock-keeps-position.simulator.test.tsx`.
