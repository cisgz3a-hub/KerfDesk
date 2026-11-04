## ADR-393 - After a critical controller event the Alarm banner offers Reset, not Unlock or Home (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

Amends the Alarm recovery offer of ADR-367 (fix offers in place) and the alarm handling of
ADR-361. The Frame-first Start contract (PROJECT.md non-negotiable 21, ADRs 228, 230, 232, 237 and
372) is unchanged: nothing here adds a Start guard. Start already refuses while the controller
reports Alarm; this decision only changes which recovery the app offers and which operator
commands it sends to a controller that cannot act on them.

### Context

Controller audit 2026-09-25, findings GP-2, HF-2, HF-3, CG-4 and HF-5/CG-8. A hard limit, a soft
limit, an E-stop or a motor fault is a *critical event*. Each GRBL-family firmware prints
"Reset to continue" and then accepts only a soft reset (Ctrl-X):

- gnea/grbl 1.1h (`bfb67f0c`, protocol.c:224-236): after `ALARM:1` or `ALARM:2` it prints
  `[MSG:Reset to continue]`, clears the reset flag and spins in a loop that tests nothing but a
  new reset. It answers no line and no `?` until Ctrl-X.
- grblHAL (`d7aaee3d`): `alarm_is_critical` (alarms.h:73-80) marks hard limit, soft limit,
  E-stop, motor fault and expander faults; `$X`, `$H` and `$SLP` then answer `error:79`
  ("Not allowed while critical event is active", system.c:1175-1183). The same text comes from
  messages.c:28.
- FluidNC v4.0.3 enters `State::Critical` and logs `[MSG:ERR: Reset to continue]`
  (Protocol.cpp:463-469, Report.cpp:104). `$X` unlocks only `State::Alarm`, so in `Critical` it
  answers `ok` and stays locked (ProcessSettings.cpp:269-286).

KerfDesk's Alarm banner offered Home or Unlock only, and the Reset control existed only in the
Sleep banner. On stock GRBL the Unlock or Home line was never answered, and its owed
acknowledgement then fenced every later command until a reconnect. On grblHAL it failed with an
undescribed `error:79`. On FluidNC the `ok` cleared KerfDesk's alarm latch although the controller
stayed locked. Separately, a halted Smoothieware board answers every G-code line with `!!` until
`M999`, so its Home sequence (which starts with `M400`) cannot run there (CG-4), and a Wake whose
reset brings the controller back locked in Alarm was reported as a failure (HF-5, CG-8).

### Decision

1. **Reset-required latch.** The line handler latches `resetRequired` when the controller prints
   its critical-event message (`[MSG:Reset to continue]` on GRBL and grblHAL,
   `[MSG:ERR: Reset to continue]` on FluidNC; `controller-reset-required.ts`). The latch is
   session-scoped: the reboot banner after the soft reset clears it, as does a disconnect.
2. **While latched, only Reset reaches the controller.**
   - Unlock and Home refuse before writing, with "The controller stopped on a critical event
     (hard or soft limit, E-stop or motor fault) and accepts only a soft reset. Press Reset
     (Ctrl-X), then Unlock or Home."
   - The Console refuses every line except the realtime status query, for the same reason.
   - The Alarm banner shows that text and a single **Reset (Ctrl-X)** button, which runs the
     existing Wake action (soft reset, then wait for the reboot banner).
   - Start's blocked-alarm fix offer offers nothing; the banner holds the one valid step.
   These are refusals of commands the firmware itself ignores or rejects in that state, not a
   policy gate.
3. **An acknowledged `$X` no longer clears the alarm.** The alarm code stays until the controller
   sends a status report that is not Alarm. This is what makes FluidNC's `ok` in `Critical`
   harmless, and it applies to both unlock paths (banner and Console).
4. **Texts.** GRBL and grblHAL `ALARM:1`/`ALARM:2` and FluidNC alarms 1, 2 and 13 say the soft
   reset comes first. The grblHAL error codes stock GRBL does not define (18, 19 and 39-92)
   get their upstream titles (errors.c), with details for 45, 46, 50 and 79.
5. **Home from Alarm is a capability.** `ControllerCapabilities.homeFromAlarm` (absent means
   true) is false for Smoothieware. There the banner and the Start fix offer lead with Unlock
   (`M999`), with the hint "Unlock first: this controller cannot home while halted."
6. **A Wake can end in Alarm.** `wakeController()` resolves `'idle'` or `'alarm'`. A reset that
   brings the controller back locked in Alarm (GRBL, grblHAL and FluidNC all do this after a
   reset from Sleep; GRBL protocol.c:49-54) completes as `'alarm'` with the alarm latched, and the
   no-homing guide shows its alarm step instead of a failure.

### Consequences

- An operator who hits a limit sees one button that works. After the reset the controller
  reports its ordinary locked Alarm and the usual Home or Unlock offer returns.
- A critical event that prints no "Reset to continue" (a firmware variant with a different
  message) is not latched; the previous behaviour applies there, and the command's own reply or
  timeout still reports the failure.
- Regression tests: `controller-reset-required.test.ts`, `AlarmBanner.test.tsx`,
  `laser-unlock-alarm.test.ts`, `laser-console-completion.test.ts`,
  `response-presentation.test.ts`, `start-blocked-fix-offers.test.ts`,
  `laser-wake-into-alarm.test.ts` and `laser-wake-into-alarm-grbl.test.ts`.

### Amendment 1 - A lock from before the connection latches too (2026-11-03)

UX audit 2026-11-03 U5-P2-1, with U5-P3-2 (before the reset) and U5-P3-5. A board that does not
reset when the port opens (most 32-bit and ESP32 boards) keeps a critical lock it raised while
KerfDesk was not listening: the E-stop was pressed before connecting, a limit tripped while
another program had the port, or the page was reloaded. Its "Reset to continue" went to nobody,
so the latch never tripped. The Alarm card offered Unlock and Home, grblHAL refused both with
`error:79`, and nothing offered Reset. Disconnect then Connect worked only because Disconnect
happens to send Ctrl-X.

1. **Three more replies latch `resetRequired`** (`controller-reset-required.ts`):
   - `error:79` to any line on a GRBL-family driver. Only grblHAL sends it, and only while a
     critical event blocks the command (`Status_NotAllowedCriticalEvent`, d7aaee3d
     system.c:1179-1181). Stock GRBL stops at `error:38` and FluidNC's codes skip from 70 to 80,
     so the stock driver a banner-less grblHAL board connects on reads it the same way.
   - An Alarm report whose `Pn:` holds `E`, except on FluidNC. grblHAL raises its critical E-stop
     alarm whenever that input is on (protocol.c `protocol_main_loop`). FluidNC's E input raises
     a critical Hard Stop only when it trips outside Alarm (Protocol.cpp
     `protocol_do_fault_pin`), and the next rule covers that state.
   - An Alarm report straight after the controller acknowledged `$X`, with no `ALARM:N` between
     them. That is FluidNC's `State::Critical`, which reports `Alarm` (Report.cpp `state_name`)
     and answers `$X` with `ok` (decision 3). Every other GRBL-family unlock either leaves Alarm
     or answers an error. `unlockAwaitsReport` carries the acknowledged `$X` to that report.
   The status `Alarm:N` substate is deliberately not evidence: grblHAL keeps the critical code
   in `sys.alarm` after the reset that cleared it, so it would offer Reset for ever.
2. **Stock GRBL needs nothing new.** Its critical loop answers nothing, not even `?`, so the
   stopped-answering card (ADR-642) appears, and its Reconnect sends the Ctrl-X that frees it.
   Chrome asserts DTR on open, which reboots most AVR boards and clears the lock anyway.
3. **The card.** With no `ALARM:N` seen and the latch set, the card is titled "Controller needs
   a reset" and says: "The controller was stopped by its E-stop or a limit switch before
   KerfDesk connected, and accepts only a reset. Release the E-stop or move the head off the
   switch, then press Reset (Ctrl-X). After the reset, Unlock or Home." With a known code, the
   alarm's own physical step comes first: alarm 1 "Clear whatever the head ran into, and move it
   off the limit switch."; grblHAL alarm 10 (also on the stock driver, where alarm 10 is never
   critical) "Release the E-stop (twist or pull the button out)."; grblHAL 17 "Check the motor
   drivers and their wiring."; FluidNC 13 "Release the E-stop, or clear the fault the controller
   reports." Then "Then press Reset (Ctrl-X): the controller accepts nothing else until it is
   reset. After the reset, Unlock or Home." Other codes keep decision 2's text. A reset with the
   E-stop still pressed raises the alarm again, which the first sentence now explains.
4. **The notice goes with the latch.** The reboot banner that ends the latch also clears a
   controller-error notice for `error:79` whose rejected line was a `$` command: a refused `$X`
   or `$H` moved nothing, so there is nothing left to warn about. A job's notice stays.
5. **Unowned holds name a control.** The Live Motion bar's controller hold and door hold that no
   job started said "release it with cycle start", which most hobby lasers have no button for.
   They now say to use the machine's cycle-start button if it has one, or ABORT MOTION here to
   clear it with a controller reset. The ADR-375 rule of no Resume for a hold KerfDesk never
   requested is unchanged; the owned bar's mid-job hold (U4-P3-2) is not touched here.

Not covered: a banner-less grblHAL board still connects on the stock GRBL driver (UX audit
U5-P3-4, owned by the driver work), where alarm 10 decodes as the stock dual-axis homing failure
outside the latch. G-code output is unchanged. Regression tests:
`controller-reset-required.test.ts` (fake grblHAL locked before the port opens, on both drivers;
E-stop input; FluidNC), `AlarmBanner.test.tsx` and `LiveMotionBar.unowned.test.tsx`.
