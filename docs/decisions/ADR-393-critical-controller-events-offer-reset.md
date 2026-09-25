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
   reset comes first. grblHAL's extended error codes 39-92 get their upstream titles
   (errors.c), with details for 45, 46, 50 and 79.
5. **Home from Alarm is a capability.** `ControllerCapabilities.homeFromAlarm` (absent means
   true) is false for Smoothieware. There the banner and the Start fix offer lead with Unlock
   (`M999`), with the hint "Unlock first: this controller cannot home while halted."
6. **A Wake can end in Alarm.** `wakeController()` resolves `'idle'` or `'alarm'`. A reset that
   brings the controller back locked in Alarm (GRBL, grblHAL and FluidNC all do this after a
   reset from Sleep with homing enabled) completes as `'alarm'` with the alarm latched, and the
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
