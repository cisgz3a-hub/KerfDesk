## ADR-279 Amendment 1 - A recovery that finishes the part advances variable data once (2026-11-12)

**Status:** Accepted. | **Date:** 2026-11-12

### Context

ADR-150 advances variable data "only after explicit operator action, successful export, or
completed streaming", and ADR-279 decision 4 applies `after-successful-stream` "once only after a
fully completed stream" and says recovery "must not double-advance". An interrupted run consumes
nothing, which is right: the part is not finished. But the sealed laser recovery that then
finishes the same part consumed nothing either, because only Start armed the completion observer.
So the part was burned with serial X, the project still showed X, and the next job burned X again.

Oracle audit O1 area O5 found it (O5-P1-1). LightBurn, the comparison the operators bring,
advances on every Start, Send or Save, so a LightBurn user never sees one part's serial reused.

The same audit found that a manual Start from line, evaluated with the live project after a
completed job has advanced, takes the current (next) serial and CSV record, while its confirmation
said only that "a date or time" could differ (O5-P2-1).

### Decision

1. A sealed laser recovery arms the same completion observer as Start
   (`armRecoveryVariableStreamAdvancement`). When the recovery stream completes cleanly, the open
   project's serial number and CSV record advance once, exactly as the interrupted run would have.
   A recovery that is aborted, errors or is interrupted again consumes nothing; recovering it
   again follows the same rule, so one finished part consumes one slot.
2. The recovery advances the open project only while that project still holds the variable data
   the interrupted run burned (record, serial, policy, range and CSV). After Next, Reset, a new CSV
   or another file, it consumes nothing, as a Start whose values changed while it ran does.
3. A manual Start from line still never advances. Its confirmation now says so when the project
   advances after each job, and, when it is evaluated now, that it takes the current serial number
   and CSV record, which can differ from the part already burned.
4. A painted second pass re-burns part of a finished part, so it arms no advance. Armed, it reached
   the stale-values check with the archived run's project and warned that variable data "was
   changed while it ran" when nothing had changed (O5-P3-5).

### Consequences

- A production run that needs a recovery no longer repeats the recovered part's serial.
- Manual restarts stay the operator's own tool: they name what they burn and what they leave for
  the operator to advance, rather than guessing whether the restart finished a part.

### Verification

- `laser-recovery-flow.variables.test.ts`: a recovered, cleanly finished run advances once; an
  errored recovery and a project whose values changed consume nothing.
- `manual-restart-variable-note.test.ts`: the restart confirmation's variable-text note.
- `start-job-transmission.second-pass-variables.test.ts`: a second pass arms nothing; an ordinary
  completed Start still advances once.
- NOT verified: a recovery on hardware.
