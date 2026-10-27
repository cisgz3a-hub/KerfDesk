## ADR-443 Amendment 2 - A restart keeps the job's registration and its variable-text clock (2026-10-27)

**Status:** Accepted. | **Date:** 2026-10-27 | **Amends:** ADR-443 (output), and the manual
restart of ADR-341 Amendments 3, 5 and 10 (Start from line, Choose restart point)

### Context

Rolling audit v4, finding H2-P1-1, confirmed by a refuter and re-verified on `main`
(`docs/audits/2026-10-27-rolling-v3/H2-recovery-journey.md` on the audit branch).

Start compiles a Print-and-Cut job through the snapshot path with the registration of the two
captured marks (`currentPrintCutOutputRegistration`). The two-point solve moves, turns and scales
the output (ADR-443 Context), and a registration that is not valid is refused: "Print-and-Cut
registration is not valid. Capture both machine points again." Captures are bound to the trusted
position epoch, so any alarm, reset, reconnect or Home retires them.

The manual restart compiled the open project with neither: `prepareRecoveryProjectSource` passed
no registration and skipped the snapshot, because "re-evaluating variables/registration would
alter checkpoint bytes". No earlier run's program matched that compile, so the restart fell back
to it:

- With valid marks 5 mm right of and 3 mm away from the design, Start burned X 45-65, Y 337-357
  and the restart X 40-60, Y 340-360: 5.8 mm off the print and off the part already cut. No
  dialog named the registration.
- Right after an interruption, the usual state, the marks are retired. Start then refuses, but
  Start from line streamed the unregistered program. With Labs' Print and Cut switched off it
  ran a job that Start refuses outright.

Variable text shared the gap. The restart compiled the template text, never evaluated, and no
earlier run could match a job whose text holds a date or time.

The sealed recovery card was safe: it replays the run's exact bytes, and the fingerprint-only
card refuses a project that does not reproduce the saved program.

### Decision

1. **A time-bound job restarts as Start compiles it.** A manual restart of a project with
   Print-and-Cut targets on a laser, or with variable text, compiles through the snapshot path
   with a registration and an evaluation time, like Start. It never compiles a registered job
   without its registration, nor variable text unevaluated.
2. **The run is matched with its own inputs.** Each time-bound compile in a session records the
   registration and evaluation time it used, keyed by the program it produced
   (`time-bound-start-inputs.ts`, the last 32 compiles). A manual restart recompiles each earlier
   run (interrupted, completed, previous manual restart) with that run's inputs, so a matching
   project reproduces its program byte for byte, as an unregistered job always could. A run this
   session did not compile is tried with Start's inputs now. The fingerprint-only card uses the
   same recorded inputs.
3. **The variable-text clock stays the run's.** The rest of the piece carries the same date and
   time as the part already burned. With no earlier run reproduced, the text is evaluated now,
   as Start would evaluate it, and the confirmation says a date or time can differ.
4. **The marks are the ones Start would take.** The restart is registered to:
   - the marks captured now, when they are valid. Start would use them, and a sheet that moved
     carried the part already cut with it. When they differ from the run's, the confirmation
     says by how much at the targets, and that if the sheet has not moved the operator should
     capture both marks again. That is a note, never a refusal (ADR-443 Amendment 1, item 4);
   - else the marks the matched run used, which this session recorded. The confirmation says
     so, and that marks retired by a reset, reconnect or Home were used, so a moved sheet needs
     new captures;
   - else nothing. The restart is refused with Start's message, because no transform exists.
     That holds while Labs has Print and Cut switched off too, even for a run that used marks.
5. **The confirmation names it.** Choose restart point and Start from line's review show the
   Print-and-Cut and variable-text note beside the program and placement notes.

### Consequences

- A restarted Print-and-Cut job lines up with the print and with the part already cut, and is
  refused wherever Start refuses for want of a registration.
- After an app restart nothing is recorded, and the marks are gone too, so a registered job's
  manual restart is refused until both marks are captured again. The sealed card still replays
  the run as it ran.
- The recorded inputs live only in memory and hold no machine or project data beyond a
  transform and a time.
- Regression tests: `src/ui/laser/manual-restart-print-cut.test.ts` (the audit's square with
  marks captured, retired, recaptured 1 mm away and switched off in Labs, and a dated Data Matrix
  restarted 90 minutes later).

### Not covered

- A run compiled in another session, or more than 32 time-bound compiles ago, has no recorded
  inputs. It matches only when Start's inputs now reproduce it, which a registered or dated job
  never does; the restart then uses the marks captured now, or is refused.
- No machine was operated. These are code and test results only.
