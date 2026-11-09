## ADR-630 Amendment 9 - The Run review is made beside the parse, once per start (2026-11-09)

**Status:** Accepted. Amends ADR-630 "What is sent". Follows ADR-598 (preparation off the UI
thread) and the performance audit precedents S1-P2-1 and S4-P2-3. Keeps PROJECT.md non-negotiable
21 and ADR-565: the review's words, refusals and warnings are unchanged, and the completed Frame
stays the only ordinary Start gate. Fixes rolling audit v11 W7-P2-1 (rated P1 by its refuter).
| **Date:** 2026-11-09

### Context

ADR-630 says the normalized bytes "are parsed and timed again by the cancellable Inspector
worker" and that a large file is normalized a slice at a time "so the dialog stays responsive".
The parse ran in the worker, but the Run dialog then built the review of the same bytes
(`reviewExternalProgram`: the controller's reading of every line, the command scan, the point
envelope and the Z lifts) inline in its render, with no memo. At 500k lines that is 1.0-1.5 s on
the UI thread per render, 3.0 s at 1M lines. The lit-rapid scan (`findLitRapids`, 0.55 s at 500k)
ran again each time the controls mounted.

The dialog re-renders on every controller, motion, connection and streamer change:
`CommandShell` subscribes to them and rebuilds the Inspector slot with fresh props, and none of
`InspectorHost`, `RunGcodeFileDialog` or `InspectExternalRun` is memoized. A Frame changes the
motion operation once per segment, and the controller reports `Jog`, then `Idle`. Start changes the
controller operation, installs the streamer and clears the operation again after the first window
is sent, while the dialog stays open until the recovery retirement finishes; the controller then
reports `Run`. The refuter measured it in Chrome with a paced GRBL stand-in at 500k lines:

- Ctrl+. reached the controller 539-661 ms late once the beam-on stream had begun, inside UI
  blocks of 1.2-2.4 s;
- during a Frame the jog cancel arrived 5,874 ms after the press, and the Frame's first jog was
  written after the operator had asked it to stop.

### Decision

1. **The worker makes the review.** The Run dialog's inspection source carries the review's
   context (`runReview`: machine mode, `$30`, controller, start, KerfDesk bit-change labels). The
   parse (`inspectGcodeText`, the same function on the worker and on the main-thread fallback)
   then calls `reviewExternalProgram` on the model and findings it has just built, scans the lit
   rapids, and returns both with the model (`SuccessfulGcodeInspectorWorkerResult.runReview`). The
   review is the same function on the same inputs, so its envelope, units, warnings and Z lifts are
   unchanged. The main Inspector does not ask for it.
2. **A render only displays it.** The prepared run (`prepareExternalRun` on the worker's review) is
   kept per inspection result, start and bit file. A render that changes none of them, which is
   every render the Frame, Start and the stream cause, makes no whole-program pass. The start is
   pinned through the Frame and Start (ADR-630), so the head's passing positions change nothing.
3. **What makes it read again is what made it read again before:** the head coming to rest
   somewhere new, a CNC Frame that leaves the bit at safe Z, another controller, machine mode,
   device or `$30`. Each is a new worker inspection, during which the dialog says it is preparing
   the program.
4. **Start reuses the worker's lit rapids.** The prepared run carries them (`ExternalRun.litRapids`),
   so the `$30`/`$32` acknowledgement at Start (`externalLaserModeStartPrompt`) does not scan the
   program again. A caller without them still scans.
5. A result with analysis but no review cannot happen on this path; if it ever did, the dialog
   refuses with a reason (`RUN_REVIEW_MISSING`) rather than make the pass on the UI thread.

### Not in this decision

- The dialog still stays open after Start until the recovery retirement finishes (ADR-630): with
  no whole-program pass in its renders, closing it earlier changes nothing the operator can feel,
  and the lock that keeps Close from hiding an arming Start stays as it is.
- The other one-off passes at the Start click, before any byte is sent, belong to performance audit
  S1-P2-2 and S4: `startJob`'s preparation and, in `installInitialStream`, the scan of every line
  for the controller state an opened program may change (`externalProgramControllerStatePatch`,
  Amendment 6). In a 6x CPU-throttled profile that scan was about 1.1 s of the Start task.

### Verification

- `src/ui/gcode-inspector/RunGcodeFileDialog.review-cost.test.tsx` counts `reviewExternalProgram`
  and `findLitRapids` calls: one each across repeated shell re-renders and status reports, and one
  through a Frame (jog reports, per-segment shell renders) and a Start (`Run` report, operation
  cleared, shell renders), where main's dialog made 9 and 8. A new rest position reads it again.
- `e2e/run-gcode-file-abort.e2e.ts` opens a 500k-line photo-shaped file on the paced GRBL
  stand-in and presses Ctrl+. from Node (a) as the Frame's first jog is written and (b) as the
  stream's beam-on line is written. Each must reach the controller within 300 ms. A CPU profile of
  the page's own thread, from the Frame click until the dialog has gone, must hold no sample inside
  `reviewExternalProgram` or `findLitRapids`, and must sample a probe the page runs on purpose,
  so an empty profile fails. That check holds on any runner. A first version bounded every UI
  task after the beam-on line at 600 ms instead; on CI it caught the Abort's own teardown (3.5 s
  on the software-GL runner, after the press) and Start's preparation, neither of them this
  dialog. The paced stand-in gained `watchLine` / `watchedLine` for the stamps.
- Measured on the maintainer's PC (Vite dev server, React StrictMode, window serial route):
  - with this change, the jog cancel reached the controller 45-83 ms after the press during the
    Frame and the soft reset 18-37 ms after it in the stream, with no page-thread sample of either
    pass;
  - with main's dialog the same spec fails: the Frame's first jog was not written within 180 s of
    the click, and Start was not unlocked within 300 s, because each render's review blocked the
    Frame's next step (StrictMode doubles each render in development; the refuter's single-render
    run took 13 s to the first jog and 46 s to the Frame record).
