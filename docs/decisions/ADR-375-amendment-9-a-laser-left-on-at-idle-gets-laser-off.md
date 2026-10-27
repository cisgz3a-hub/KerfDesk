## ADR-375 Amendment 9 - A laser left on at Idle gets LASER OFF (2026-10-27)

**Status:** Accepted. Unit- and simulator-tested; not tried on hardware. | **Date:** 2026-10-27
**Fixes:** rolling audit v5 J2-P2-1 (P2). **Builds on:** decision 10 of this ADR (C-2, Abort for
motion nothing in KerfDesk started) and the desktop close handoff (ADR-549).

### Context

- On a laser profile, a Console `M3 S…`, or a G-code file that ends without `M5`, leaves the
  controller's spindle output on at Idle. GRBL sets the output once the planner empties, keeps it
  until `M5`, a reset or an alarm, and forces a report that says so with `A:S` (`M3`) or `A:C`
  (`M4`)
  ([spindle_control.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/spindle_control.c),
  `spindle_sync` and `sys.report_ovr_counter = 0`).
- KerfDesk offered no way off. The Live Motion popup showed nothing, Ctrl+. did nothing, and the
  crash screen had no ABORT. Only Disconnect (a soft reset plus `M5`) or a typed Console `M5`
  turned it off, and nothing pointed to either.
- An ordinary desktop close and a web tab close went ahead with no stop: the close stop acted only
  on a latched Fire, a job, owned motion or an unsafe controller operation. The update close
  already counted the same report as busy and refused.
- CNC has **Stop spindle & coolant**, which asks first because the cutter may be in the work.

### Decision

1. **The evidence is the controller's own accessory report**, the one the update close reads: the
   canonical accessory cache, or between `A:` observations the last report
   (`src/ui/state/unowned-controller-output.ts`). On a laser profile, connected, at Idle, with
   `A:S` or `A:C`, and with nothing here owning the output (no job, controller operation, jog,
   Frame or Fire), the laser counts as left on. A second grblHAL spindle hides it, as it hides
   Stop spindle & coolant, because `M5` may not reach the spindle reported on.
2. **The Live Motion popup shows LASER ON with LASER OFF.** LASER OFF sends `M5`, or `M5 M9` when
   air assist is reported on too (`F` or `M`), as one Console block. That is the Console's fail-off
   sequence, so it needs no fresh status round trip first and a grblHAL pendant does not block
   it. There is no reset, so the work origin and position stay.
3. **Ctrl+. and the crash screen's ABORT send the same block** in this state. The crash screen
   offers ABORT for it.
4. **An ordinary desktop close and a web tab close turn it off first**, as they turn a latched Fire
   off. The desktop close says "Turning the laser off before closing." When the block is refused
   or not written, the close notice says KerfDesk could not turn off the laser the controller
   reports on, with **Retry turning the laser off** and **Acknowledge warning and close**. Retry
   sends the block again although the failed attempt already expired the report. A web tab
   starts the write in the unload event itself, best effort.
5. The update close still refuses in this state, unchanged.
6. CNC is unchanged: Stop spindle & coolant keeps its confirmation, and an ordinary close leaves a
   CNC spindle as it is.

### Consequences

- A laser lit by hand or by a file is one click, one key or a close away from off, without a reset.
- `A:S` at S0, for example `M3` in G0 mode under `$32=1`, also shows LASER ON. The controller is
  armed, so the next G1 would fire; LASER OFF is harmless there.
- After LASER OFF the popup stays until the next status report shows the accessories off.
- Whether an ordinary close should also stop a CNC spindle left on at Idle is open. Stopping a
  spindle in the work needs the operator's confirmation, which a closing window cannot ask for.

### Tests

`src/ui/state/unowned-controller-output.test.ts` covers the evidence.
`src/ui/laser/laser-left-on.simulator.test.tsx` runs the real store against the GRBL simulator:
LASER OFF, Ctrl+. with air, the desktop close, the update close refusing, the web tab close, a
refused `M5` with Retry, and a CNC profile left alone. `src/ui/app/App.crash-safety-notice.test.tsx`
checks that the crash screen's ABORT sends `M5 M9`, not a reset.
