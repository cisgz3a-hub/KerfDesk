## ADR-375 Amendment 1 - The head camera from WPos reports, and the note after a homing-state Reset (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

### Context

ADR-375's consequences left two gaps from its connection and capture work (decision 12):

- A camera on the laser head (ADR-449) read only MPos. GRBL reports MPos or WPos as `$10` selects,
  never both ([report.c L522-L527](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c#L522-L527)),
  so with WPos reports the camera had no head position. Capture here, Capture selection and the
  calibration's photo step then asked to connect and home a machine that was connected and homed.
- After the Reset out of stock GRBL's stuck homing state, the log said the controller "came back
  locked in Alarm, as it does after Sleep or a critical alarm. Unlock or Home it." With the Falcon
  command set on the stock GRBL driver, Home sends `$HX` again, and the controller sticks again.

### Decision

1. **The head camera takes the position the status panel shows.** `headPositionOnBed` uses
   `inferCurrentMachinePosition`, as Print and Cut's Capture head does since decision 12: MPos, or
   WPos plus this report's or the last reported WCO
   ([interface.md L548-L552](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md#L548-L552)),
   converted to millimetres once. It still needs a verified bed mapping (homed), and a position
   KerfDesk withholds after Unlock, Release motors or an unfinished Home stays hidden.
2. **The note after a homing-state Reset.** A reset out of that state raises `ALARM:6`
   ([motion_control.c L380-L384](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L380-L384)),
   and the Console log now says so. When the profile's Home is single-axis (the Falcon command
   set's `$HX` then `$HY`), the note says to Unlock, because that Home leaves stock GRBL built
   without single-axis homing stuck again. Otherwise it says Unlock or Home, as before.
3. **No new refusal.** Home is not refused after a refused `$HX`: the Alarm banner's Reset still
   gets out, and choosing a profile that homes with `$H` stays with the operator.

### Consequences

- Still open: with the Falcon command set on the stock GRBL driver, Home still sends `$HX` after
  that Reset (the log now says to Unlock instead); the simulator does not model `$10` WPos reports.

### Evidence

- `head-position.test.ts`: a WPos report with a WCO, and a later one without, place the head where
  the same MPos does; WPos before any WCO gives no position; an inch WPos report is converted once.
  The first and last fail with the MPos-only read.
- `controller-homing-state-reset.simulator.test.ts`: after the Reset, the log names the homing
  state and `ALARM:6`, says Unlock for the Falcon command set's `$HX` Home, and says Unlock or Home
  for the plain stock driver. Both fail with the old note.
