## ADR-565 Amendment 1 - A clean XY jog keeps the Frame of a job placed by a fixed origin (2026-11-11)

**Status:** Accepted by the maintainer's explicit approval on 2026-11-11, after user annoyance audit A1 (finding A2-D-2). Amends ADR-565 and the "any jog expires the permit" note of [ADR-372](ADR-372-start-waits-for-a-clean-frame.md). Software and simulator evidence only; no machine was operated.

### Context

Start stays greyed out until a clean Frame of the current job completes (ADR-372), and that Frame stays valid while the footprint and placement are unchanged (ADR-565). Until now every jog ended it:

- the jog cleared the permit when it started, and the invalidation subscription ended the completed Frame on any motion operation;
- the remaining checks compared the reported machine and work position exactly, so the head had to stand where the Frame left it.

For a job placed at the head's **Current Position** that is right: moving the head moves the job. For **Absolute Coords**, **User Origin** and **Verified Origin** it is not. Those programs are written in work coordinates (`G90`, `G54`), so where they land depends on the work offset and not on where the head stands. The operator who framed, jogged the gantry back to load the blank and came back found Start grey and had to Frame again. ADR-565 already let an Absolute footprint survive an app-owned job run, and ADR-605 Amendment 1 already keeps the Frame through the positioning light's own travel.

### Decision

A completed Frame survives an app-owned jog when **all** of these hold. Otherwise it expires exactly as before.

1. **The placement does not depend on the head.** The framed job is placed by Absolute Coords, User Origin or Verified Origin. A Current Position job expires on any jog.
2. **The move is a plain X/Y jog that ends cleanly.** It is an app-owned jog operation: a jog-pad step or hold, a keyboard jog, a step from the phone remote, Move to position, Go to work zero, or a click-to-position move. It reaches its own settled Idle (planner-drain marker acknowledged, then a later Idle report) with no alarm, no rejected line, no pendant takeover, no reset and no reconnect.
3. **Nothing else the Frame binds changed.** Controller session, report units, work offset, work-origin state and source, trusted-position epoch, Work Z reference and evidence, and the reported **Z** are all the same. Only the reported X and Y may differ. The artwork, output selection, placement and registration are unchanged, including an edit that was made and undone while the head moved.

How it works:

- When the jog starts, the Frame is taken out of the store, as it always was. No permit, completed Frame or trace is live while the head moves, so Start is disabled by the same rule as before, and every existing invalidation still acts on the live proof fields.
- The jog's own motion operation carries the Frame. If the operation is cancelled by a failure, interrupted or replaced, the Frame is dropped with it.
- The invalidation subscription watches the carried Frame and drops it at the first drift, so nothing can be changed and changed back during the move.
- On the status report that settles the jog, the checks in items 1 to 3 run once more against that report. If they pass, the Frame goes back with the same candidate and only the observed controller position rebased, as `settledCompletedFramePatch` already does after an owned run. The status line again reads **Ready to start — framed placement unchanged**.
- While the head moves, the status line reads **Jogging — the Frame is kept. Start unlocks when the head stops**, not "Frame expired".

Each case, decided from the code:

| Case | Result | Why |
| --- | --- | --- |
| Z jog, laser or CNC | Expires | A laser Focus Test layer moves Z relatively (`G91`, ADR-602), so the Z the job starts from matters, and Auto-focus already expires the Frame. On a CNC, Z is part of the job and the Frame ends at an owned safe-Z target that later checks hold strictly. A jog that commands Z or A is never carried, and the reported Z is compared at the end as well. |
| Move to position, Go to work zero, click-to-position | Kept | They are the same jog operation (`kind: 'jog'`) with the same settlement proof; only the target is computed differently. On a CNC their safe-Z lift moves Z, so the Frame then expires by the Z rule. |
| Centre & LED | Unchanged | It is not a jog operation and keeps its own rule (ADR-605 Amendment 1). |
| Home, probe, Auto-focus, origin actions, park by program | Unchanged | Not jog operations; they expire the Frame as before. |
| Console motion (`$J=`, `G0`) | Unchanged | The Console clears the Frame itself and its motion is not an app-owned jog operation. The Console is also refused while a jog runs. |
| Jog stopped by a limit or soft limit | Expires | An alarm ends the operation and voids position trust. A jog the controller rejects (`error:15` past soft limits, or any other `error:N`) cancels the operation and drops the Frame, as every rejected line already voided the proof. |
| Hold-to-jog release, Stop motion | Kept | The operator's Cancel of a still-healthy jog binds the Frame to that Cancel attempt. It returns only when that attempt's own settlement (marker, stamped status query, later Idle) releases the jog. A Cancel that fails or times out, an automatic release, and a Cancel of a jog a failure had already cancelled all drop it. |
| Phone-remote hold release, or any stop by a remote owner | Expires | The remote owner marks its jog cancelled before it sends the Cancel, which is the same mark a failure leaves. It is not told apart, so the Frame expires as before. A remote step jog that runs to its end keeps it. |
| Step presses that join a running jog (ADR-674) | Kept | They are lines of the same operation. A queued step that moves Z or A drops the Frame. |
| Cancel with no jog owning motion | Unchanged | Cancel intent still expires live proof. |
| Rotary job, rotary test turn | Expires | A roller turns the work under the head, so a jog there is not a plain head move. A rotary job is never carried, and a test turn always expires the Frame. |
| Transient camera and second-pass permits | Unchanged | They keep their own immutable ownership and expire on any jog. |
| A trace awaiting its exact program (ADR-353) | Expires | The exact program is being prepared against the position the Frame was pressed at, and that preparation is cancelled by any other position change, so a kept trace could never be bound. |

Nothing after the Frame assumes the head still stands at the Frame's end point for a fixed placement. `returnToWorkPosition` and `controllerBeforeFrame` are read only while the Frame itself runs and completes. Start prepares the current program again from the Frame's resolved origin and compares its bounds and placement with the Frame (`prepareFramedStartReview`), rebinds the controller snapshot at review (`rebindReviewedFramedRun`), and its final handoff compares against that rebased snapshot (`framedRunStartHandoffIssue`). Run again, the timed start mark and recovery take their controller snapshot when they run. The emitted laser and CNC programs open with `G90` and `G54`, so the first travel is absolute in work coordinates for Absolute, User Origin and Verified Origin alike.

No other invalidation is weakened: alarm, reset, reconnect, Auto-focus, pendant/MPG, origin change, artwork or placement change, and an interrupted Frame all end the Frame as before. No Start policy gate is added.

### Evidence and limits

- `jog-keeps-frame.simulator.test.ts`, on the GRBL simulator with a non-zero work offset and the real invalidation subscription: Absolute, User Origin and Verified Origin keep the Frame through a jog, and Start then streams the exact program prepared for the Frame once; hold-to-jog with Cancel, joined step presses, a jog run by another owner and Move to position keep it; Current Position, a Z jog, a jog that asks to void the Frame, a jog its owner had already cancelled, an alarm, a reset, a changed work offset (even when put back), session, position-trust or Work Z identity, an origin set afterwards, a placement change and an edit that is undone all expire it. A User Origin Frame is also kept, and its program sent once, on the grblHAL, FluidNC, Marlin and Smoothieware simulators.
- `jog-held-frame.test.ts`: a failed Cancel, an automatic release, a rejected line (the jog's own or another), a Resend, a quickstop and a pendant takeover never return the Frame.
- `start-job-authorization-position.test.ts`: the X/Y-only comparison still binds Z, state, session, origin, units and Work Z evidence.
- `WorkspaceJobActions.test.tsx`: during a jog that carries the Frame, Start is disabled and the status line reads the jogging text, not "Frame expired" or "Not framed".
- `e2e/jog-keeps-frame.e2e.ts`, in the app on the in-page stock GRBL: for Absolute Coords and User Origin, Frame, jog away twice, Start is enabled, and the extent of the burned moves equals the extent the Frame traced; the Current Position twin needs a new Frame.
- Not verified: any physical machine; the app end to end on a controller other than stock GRBL; a CNC project, whose rules above are read from the code and covered only by the shared Z comparison test; and lost steps during a jog, which no controller in this family reports.
