## ADR-341 Amendment 6 - Continue from where the head stopped, and the Review opens after a reconnect (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

Amendment 5 lets a recovery put the saved origin back after a controller reset. That works
only on a machine that was homed before the job: the saved offset is measured from machine
zero, and a machine that never homed gets a new machine zero wherever the head sits when it
restarts. The maintainer's Creality Falcon A1 Pro jobs usually run from Set origin here without
homing, so after the reported lost connection nothing could place the rest of the job except
lining the head up by eye.

The maintainer asked for three things:

1. Every job should remember where it started, so a lost connection never loses it.
2. After a reconnect KerfDesk should offer to put the origin back and bring up a way to
   continue where the burn stopped, without the operator hunting for it.
3. When the coordinates cannot come back, it should simply continue the G-code from where it
   stopped: the head stopped at the last G-code it had and the work did not move.

The facts behind 3: a USB link that drops mid-job leaves the controller running every line it
had already received, planner and receive buffer alike, and then it stands still. KerfDesk
knows how many lines it had sent at the drop, acknowledged ones plus those still in flight, but
the recovery record kept only the acknowledged count. On an image engraving a controller
holds dozens of unacknowledged lines, so the acknowledged count alone puts the stop several
millimetres back along a row.

The archive already records each job's work offset at Start (`archivedControllerObservation`),
so 1 holds for archived jobs. The recovery card was easy to miss: it sits collapsed above the
job controls, and the reported attempt went to Start from line instead.

### Decision

1. **A lost link records the lines sent.** When a run ends with a `disconnect` interruption
   the record keeps `sentLines`: the stream's acknowledged lines plus its in-flight lines,
   capped at the program's length, in the same sendable numbering as `ackedLines`. Other stops
   record none: Abort, a rejected line and a controller restart discard the planner, and a
   failed write's lines may never have left the host. The field is optional and older records
   read without it.
2. **Continue from where the head stopped.** For an archived laser run with a recorded
   `sentLines` short of the end, the review works out the program point at the end of the last
   sent line (the X and Y the program had commanded by then, in G54 millimetres) and the file
   line after it. When the controller's origin is gone, not reported, or not the one the job
   ran with, the review offers **Continue from where the head stopped**: one
   `G54 G21 G92 X<point> Y<point>` at the head's current spot makes that spot the program
   point without moving the head, through the same origin transaction as Restore saved origin,
   and the restart line becomes the line after the stop. The review then says the origin is
   set from the head stop and no longer warns that the origin moved or offers the restore.
   It is not offered when the program up to the stop cannot be followed (relative moves, a
   work coordinate system other than G54) or has not commanded both X and Y.
   The new head-stop scan also declines coordinate-setting/probing blocks, axis-bearing dwell,
   units changes after an axis is known, and words the shared numeric reader cannot consume.
   Those cases cannot establish this action's point from the retained modal words; normal
   recovery and archived resume transforms stay unchanged. After a later reset clears the
   origin, the review no longer claims the head-stop anchor even if the reported offset has
   the same numbers; the explicitly selected restart line remains selected.
   A head-stop anchor that times out without a fresh matching reported offset does not return
   success or advance the restart selection. It retains the actual cache and reports the lack
   of confirmation. Host-recorded dialects retain their acknowledged-write evidence; the
   existing Restore saved origin action keeps its best-effort behavior.
3. **The review says what the continue assumes.** The head must not have been moved since the
   stop, and a controller that itself restarted or lost power mid-burn stopped earlier than the
   last line sent; Frame remaining area shows that before anything burns. Restore saved origin
   points to the continue when both are offered, for a machine that was not homed.
4. **The Review opens by itself.** When an interrupted laser job was saved after a lost link,
   a controller restart, a failed write or a stalled stream, its Review opens as soon as the
   controller is connected and nothing else holds the rail (no live job, no pending Start, no
   live recovery claim, the rail not busy). It opens once per run in each app session; closing
   it leaves the card. The operator's own Abort, a rejected line and an unexplained stop do not
   open it. The open Review covers the Machine panel's Home, and a restore after a reset needs
   the machine homed first, so when the project has homing set up Restore saved origin sits
   beside **Home machine**, which runs the same Home as the Machine panel. Either action holds
   the other until it finishes. When Continue from where the head stopped is also offered, the
   restore says that homing moves the head off the stop, so after it only the restore fits.
5. **A recovery refusal for a missing origin** also names Continue from where the head stopped
   for a machine that was not homed.

### Consequences

- A job from Set origin here on a machine without homing can finish after a lost connection
  without lining anything up by eye: reconnect, the Review opens, Continue from where the head
  stopped, Frame remaining area, Start recovery. The simulator test pulls the cable while
  lines are in flight, lets the controller run out what it had, reconnects to a fresh
  controller counting from the head's spot, and the resumed job ends exactly where the
  original would have.
- The continue restarts after the last line sent, not after the last acknowledged one, because
  that is where the head is. If a line in flight never reached the controller, the head
  stopped a line or two earlier and the rest lands off by that move; Frame remaining area is
  the check.
- Jobs too large for the recovery archive (Job Review warns before Start) still keep no record
  and get neither the card nor the continue. Recording the origin and stop for them would need
  a lighter record in the ADR-337 start intent; that remains open.
- The continue and the restore are operator actions, not gates (ADR-228). Recovery Start
  refuses only what it refused before.

### Alternatives rejected

- **Continuing from the last acknowledged line.** The head is past it by every line the
  controller had buffered, so the rest of the job would shift back along the row.
- **Asking the operator to confirm the head has not moved in a separate dialog.** The button is
  the operator's own action and says what it assumes; a second confirmation is friction
  without new information.
- **Opening the Review on every connect.** It would reopen after the operator closed it; once
  per run per session keeps it in front of the operator after the reconnect that matters.
- **Opening it after Abort.** The operator stopped the job on purpose; the card is enough.
