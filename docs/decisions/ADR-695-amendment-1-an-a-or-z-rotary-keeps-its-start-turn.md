## ADR-695 Amendment 1 - An A or Z rotary keeps the turn its job started from, and its axis's own rate (2026-11-10)

**Status:** Accepted; unit evidence, and a four-axis grblHAL simulator run with the real store,
Frame, Job Review and Start. No hardware. | **Date:** 2026-11-10

Follows rolling audit v13 findings Y5-P1-1, Y5-P1-2 and Y5-P1-4 (all P1, confirmed by the refuter),
and Y5-P3-1 and Y5-P3-2 (`docs/audits/2026-11-10-rolling-v13/Y5-rotary-fix-verify.md`). Amends
Decisions 5, 8 and 13, and ADR-127 Amendment 2 D4 for a dedicated axis.

### Context

- **Decision 5's premise is false.** It said "nothing reports where a dedicated rotary stands", but
  grblHAL and FluidNC report A as the fourth MPos and WCO value.
- **Abort and re-run (Y5-P1-1).** Every job and Frame on A or Z opens with `G92 A0` at the part's
  current turn. After an ABORT JOB, Restore put back the XY origin only. The re-run then zeroed the
  turn wherever the Abort had left the part, and burned 66–84 mm round an Ø60 glass from the
  half-burned first run. Nothing warned.
- **Start from line (Y5-P1-2).** The re-entry moved the head in X but never turned the part, so the
  first replayed stroke burned a streak from the stopped turn. Where a reset clears G92 (stock GRBL,
  FluidNC), every remaining line counted from machine zero.
- **Axis max rate (Y5-P1-4).** The controller's planner caps every move so that no axis passes its
  own max rate (GRBL v1.1h `planner.c`, `limit_value_by_axis_maximum`). KerfDesk read only
  `$110`/`$111`. On a Z rotary with `$112=500`, or the A1 Pro's `$112=2000`, strokes round the part
  burned at 1.1–4.3× the dose, silently.

### Decision

1. **The stop keeps the start turn.** An operator Abort of an A or Z rotary job records the machine
   turn the job started from (`JobStopRequest.rotaryStartTurn`). Because the job opened with
   `G92 A0`, that turn is the axis's work offset (WCO) while the job runs. The status parser now keeps
   a fourth MPos/WPos/WCO value as `a`.
2. **Restore turns the part back.** Restore saved origin on the Alarm 3 card, and the Frame offer
   for an unrestored origin, jog the rotary back to that turn after the XY origin is restored. The
   jog is relative and laser-off, through the ordinary jog action. The card says so, and the offer
   names how far the part has turned. The re-run's own `G92 A0` then zeroes the turn the first run
   used.
3. **Job Review says the turn.** When no Restore is on offer (Absolute, Current Position), and the
   part is more than 0.5° (A) or 0.05 mm (Z) away from the stopped job's start turn, Job Review warns.
   It names the turn and the jog that brings the part back. It warns, never refuses (ADR-228).
4. **Start from line re-enters the turn.** A program that opens with `G92 A0` or `G92 Z0` resumes
   with, after its beam-off `M5`:
   - `G53 G0 A<start turn>`, the job's zero in machine coordinates;
   - `G92 A0`;
   - `G0 A<the line's turn> S0`;
   - then the existing X re-entry.

   Without the start turn the resume is refused, rather than burn a streak. This covers lost-link
   recovery and a restart, where the turn is gone.
5. **The rotary axis's own rate.** `$112` and `$113` are read with the `$$` dump.
   - **The warning:** when a layer with a stroke round the part needs more of that axis than its max
     rate, Job Review warns and names the layer speed that runs evenly. Emitting a lower F would
     change no motion, because the planner applies that cap whatever F asks for, so only the warning
     is new.
   - **Not read:** FluidNC's per-axis `max_rate` from its YAML configuration.
6. **Wording.** The surface-speed warning names the axis and its unit on A ("A 1.43° per mm of
   surface", °/min). It speaks only of layers with a stroke round the part, so a 0° fill no longer
   warns. The Y wording is unchanged.
7. **The A1 Pro preset's arithmetic.** `$103=8.900` × 360 is 3204 steps, not 3200, so the note now
   asks for a ten-turn seam check.

### Consequences

- **Machine position through a reset.** A re-run after an Abort lands on the half-burned part only
  if the controller kept the axis's machine position through the reset. The simulator keeps it;
  real grblHAL and FluidNC builds are not verified. Where it is lost, the turn shown is wrong too, and
  the operator must line the part up by eye.
- **Lost links and restarts.** Start from line after a lost link, or after KerfDesk restarts, is
  refused on an A or Z program.
- **Untouched files.** The emitted program and the Y-port rotary are byte-identical. Only a resume
  of a dedicated-axis program changes.
