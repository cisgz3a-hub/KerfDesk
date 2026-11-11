## ADR-637 Amendment 11 - The G-code Inspector's Run asks the converted-laser question too

**Status:** Accepted (rolling audit v12, finding X7-P3-3, re-rated P2 by its refuter and confirmed
by the coordinator on main `ffd9fe66b`). It replaces the external-run item under Amendment 10's
"Still not covered", so the 1.0.30 update notes and the canvas card's **Not now** tooltip ("KerfDesk
asks again before any job or recovery starts") become true as written. It changes no G-code, no
stored machine and no project format. | **Date:** 2026-11-09

### Context

- Amendment 10 left the G-code Inspector's Run unasked. Its reason was that the Run streams the
  operator's own file, not a CNC job KerfDesk compiled for this machine.
- The refuter showed that the reason overlooks what the machine type does to the Run's own review.
  On a CNC-typed machine, the Run review drops the two laser-mode checks a laser gets:
  - the lit-rapid warning (`external-run-readiness.ts`, laser only);
  - the `$30`/`$32` Start acknowledgement (`laser-mode-start-acknowledgement.ts`, laser only).

  It asks only the CNC setup attestation.
- A machine 1.0.29 converted is at `$32=0` by construction. So the type error the question exists to
  catch also removes the warning that would name the burn.
- On a LightBurn-shaped file (`M4`, `S800`, `G0` travel), the repository's GRBL power model burns
  130.7 mm of travel at `S800` with `$32=0`.
- On the machines Amendment 10 was written for (spindle max RPM set to 1000, or `$30` written to
  12000), the only hint left was "The program never moves Z, as a laser program does. KerfDesk is in
  CNC mode."

### Decision

1. **The Run's Start waits for the answer.** While `convertedLaserQuestion` is open for the current
   machine (Amendment 10's rule), `externalStartIssue` returns:
   > Is this machine a laser? KerfDesk 1.0.29 could set a laser up as a CNC when its controller had
   > laser mode off ($32=0). Set up as a CNC, a job turns the laser on at full power, holds it still
   > for 3 seconds, and keeps it on over every travel move. Answer it first: on the canvas card or in
   > Machine Setup, choose "It's a laser" or "This is a CNC router", then start the program.
   - The question comes before the Frame-first status, so the Run dialog shows it as soon as it
     opens. Start stays disabled with it as the reason. Frame stays available, because it does not
     fire the tool.
   - The same check sits in `externalHandoffIssue`. So `startExternalProgram` refuses before any
     confirm, again after the confirms, and at the store's final `assertFinalStartAuthorized`. No
     program byte is sent.
2. **The answer is Amendment 10's.** "This is a CNC router" (on the canvas card or in Machine
   Setup), or "It's a laser" followed by Machine Setup's Save, ends the question for the Run as for
   every other start.

### Consequences

- The 1.0.30 notes line ("If 1.0.29 set your laser up as a CNC, KerfDesk asks whether it's a laser
  before any job or recovery starts") and the **Not now** tooltip are true for every start KerfDesk
  offers on that machine:
  - Job Review's Start and Run again;
  - both CNC recoveries;
  - the G-code Inspector's Run.
- **Still not covered.** A 1.0.29 CNC project opened on another computer whose last machine is the
  plain starter is still not asked (Amendment 8). The laser-worded `$30` advisory still warns at a
  laser-scale `$30`.
- **1.0.30 update notes.** The merged line needs no change.

### Verification

- `external-run.converted-laser.test.ts` uses the real 1.0.29 last machine, a stock-GRBL diode
  (`$30=1000`, `$32=0`) and a LightBurn-shaped `M4 … S800` file:
  - The dialog's issue is the question before any Frame and after it.
  - `startExternalProgram` refuses with it before any confirm, sends no program byte and starts no
    stream.
  - After "This is a CNC router" the issue returns to the Frame-first status. The framed program
    then streams.
- The external-run suites `external-run.test.ts`, `external-run.store.test.ts`,
  `external-run.cnc-store.test.ts`, `external-run.controller-readiness.store.test.ts` and
  `RunGcodeFileDialog.test.tsx` are unchanged and pass.
