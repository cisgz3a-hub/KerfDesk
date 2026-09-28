## ADR-341 Amendment 5 - Recovery puts the saved origin back instead of asking for a new one (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

The maintainer's Creality Falcon A1 Pro lost its USB connection at line 207,288 of a
248,273-line User Origin fill. After reconnecting, **Start from line** refused with the
ordinary Start message: "User Origin needs a custom work origin. Click "Set origin here"
first."

1. **The origin was gone.** "Set origin here" writes a `G92` origin. Stock GRBL and FluidNC
   clear it on every reset and power cycle, and on Windows opening the port can itself
   reset an Arduino-class board. KerfDesk forgets its cached origin at every disconnect and
   re-learns it only from the controller's next work offset report (`WCO:`), so after a
   reboot the controller reported a zero offset and User Origin had nothing to place the job
   on.
2. **The advice was wrong for a recovery.** Both recovery paths (the **Interrupted job
   saved** card's Review and the manual Start from line) qualify through the ordinary Start
   placement and showed its refusal unchanged. Following it sets the origin wherever the
   head stopped, and the rest of the job burns shifted by the distance from there to where
   the job started. Nothing in the app could put the original origin back: the review
   showed "Origin then" and "Origin now" (Amendment 3) and said to set the origin back, but
   offered no way to do it except by hand in the Console.
3. **An origin at machine zero read as matching.** On a machine without homing the operator
   often sets the origin right after power-on, at machine 0,0, so its offset is zero. After a
   reset cleared it the review compared 0,0 with 0,0 and said the origin matched, while
   Start refused for the missing origin.
4. **The manual line field invited a large mistake.** The field starts at line 1 and the
   progress bar shows sent lines, not file lines; the reported attempt used 20700 for about
   207000, which would have burned most of the image twice.

The simulator reproduces 1 and 2: a User Origin job with its origin at X 20, Y 30, a cable
pull, and a reconnect to a fresh controller refuses recovery with the Set origin advice.

### Decision

1. **Restore saved origin.** The laser recovery review offers **Restore saved origin**
   whenever the run's archived work offset (its `archivedControllerObservation.wco`) is
   known and the live origin differs from it, is not reported yet, or, for a User or
   Verified Origin job, is not set at all. It writes one `G92` at the live machine position,
   `G92 X(m - s) Y(m - s)`, which makes the XY work offset equal the saved one whatever G54
   holds, without moving the head. GRBL-family controllers get `G54 G21` in the same block,
   as every origin action selects G54, and millimetres so a startup block that chose `G20`
   cannot scale the offset. Other dialects acknowledge `G21` separately before `G92`,
   since Marlin reads one G command per line. Z is untouched. The action runs through the
   ordinary origin transaction (fresh Idle, exclusive acknowledgement, Frame permit voided)
   and waits for the controller's offset report (`WCO:` on GRBL, `MPos`/`WPos` on Smoothieware).
   Only an offset-bearing report newer than the `G92` write confirms the result. The
   observer is registered immediately before that write, so a report received before its
   acknowledgement still counts, including when a later position-only frame omits WCO.
   A matching old cache, or a position-only update, is not new offset evidence. The owned
   observation is retired on success, cancellation or failure; the confirmation deadline
   remains three seconds after acknowledgement. If confirmation times out, it
   preserves the controller's reported offset (or its absence) and logs that the restore is
   unconfirmed; a contradictory report must never be replaced with the requested numbers.
   Host-recorded dialects retain the shift their acknowledged `G92` wrote.
2. **The review says when the numbers are right.** The saved offset is measured from
   machine zero. It lands where the job started only while machine zero is where it was when
   the job ran: after a reset or power loss, a machine that was homed before the job must be
   homed again first, and a machine that was not homed before the job cannot get its origin
   back from the numbers. The review says so beside the button, and that Set origin here would
   put the origin where the head is now. It does not decide it for the operator: the archive
   does not record whether the run was homed, and the machine may home itself at power-on
   without KerfDesk seeing it.
3. **A cleared origin reads as gone.** When the controller has no work origin set and the
   job's placement needs one (User or Verified Origin), the review says the origin is gone,
   not that it matches, and offers the restore, even when both offsets are zero.
4. **Recovery refusals name the saved origin.** When a recovery's placement is refused for a
   missing User or Verified origin, the refusal says the controller no longer has the origin
   the job ran with, gives the saved offset when the run's archive has one, warns that
   setting a new origin where the head is would shift the rest of the job, and points to
   homing and Restore saved origin. Ordinary Start keeps its message and its Set origin fix.
5. **Start from line starts at the saved job's restart line.** While an interrupted laser
   job is saved, the manual line field holds its automatic restart line (the Review's own
   choice, a file line) until the operator types another, and the section says where the job
   stopped in sent lines.

### Consequences

- A User Origin job interrupted by a reset can be resumed in the frame it ran in on a machine
  that homes: home, Restore saved origin, Frame remaining area, Start recovery. The simulator
  test resumes such a job after a fresh-controller reconnect and ends at the original
  program's last point in the saved frame.
- A machine that was never homed still cannot recover its origin in software after a reset;
  the operator lines the head up by eye and uses Frame remaining area to check.
- Restore saved origin is an operator action, not a gate. Recovery Start still refuses only
  what it refused before, Frame stays the only ordinary Start guard (ADR-228), and archived
  observations are still never replayed without the operator's own click: this button is
  that click, and it writes only the XY offset the operator sees.
- The origin readiness checks moved from `laser-origin-actions.ts` to
  `laser-origin-readiness.ts` so the restore action shares them.

### Alternatives rejected

- **Restoring the origin automatically on reconnect.** Machine zero after a reset is only
  the old one when the machine was homed before and after, which KerfDesk cannot prove; an
  automatic write would silently misplace a no-homing job.
- **Moving the head to the saved origin (`G53 G0`) and then Set origin here.** Two steps and
  a motion where one non-moving `G92` gives the same offset.
- **Refusing Restore saved origin without homing proof.** A new guard (ADR-228), and wrong
  for machines that home themselves at power-on.
- **Recording the origin in the start intent for jobs too large to archive.** Worth doing,
  but it changes the ADR-337 intent schema; this amendment covers archived runs.
