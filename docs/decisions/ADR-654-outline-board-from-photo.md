## ADR-654 - Place Board: irregular outline boards from a photo, registered by the head (2026-10-21)

**Status:** Accepted, at the maintainer's request ("take a photo of a board ... add measurements ...
the canvas draws that shape ... it should know exactly where the board is on my laser", "capture
the bottom left side of the board to know the board coordinates", irregular outlines, every corner
verified). Revised the same day after the maintainer's first test (see "Revision").
**Date:** 2026-10-21

Extends [ADR-126](../../DECISIONS.md) (Place Board board-shape union) with a third arm, `outline`.
Builds on ADR-124 (jogged capture), ADR-125 (fill the board), ADR-327 (placement anchors are
physical corners) and ADR-341 Amendment 5 (one G92 that sets a chosen work offset).

### Context

Place Board registers rectangles and circles from head positions. Live-edge slabs, offcuts and
shaped blanks are neither. A phone photo shows their shape well, but a handheld photo carries no
relation to machine coordinates, and its scale and perspective are unknown. Neither a photo nor an
assistant reading one can say where the board lies on the bed.

### Decision

1. **Three sources, three unknowns.** The photo gives the outline's shape. The operator's typed width
   and height give its size. The head gives its position, rotation and a scale check.
2. **The operator draws the outline.** In the photo window the operator clicks the board's corners in
   order around its edge, adding points along curves and dragging points to adjust them.
   **Straighten edge** moves the points between two picked ends onto the line joining them, for
   clicks that were a little off; it refuses to move a point further than 15 % of the edge's
   length, so it cannot reshape the board. The clicked points are the shape; nothing is detected
   automatically. The typed width and height
   rescale the outline per axis. Every clicked corner is a check point, up to six (more points use
   the six sharpest convex corners). A photo comes from a file, the clipboard, or an MCP assistant
   on the desktop app, which opens the window by itself.
3. **Canvas first.** **Draw on canvas** puts the outline on the canvas at once: a locked, exact
   (unfaired) closed polyline on the registration layer with `captured-board` provenance, centred and
   kept out of the burn. Placement is unchanged, so artwork can be laid out on the board, and Fit and
   Array used, before any machine is connected. Fit and Array fill the outline's largest inscribed
   axis-aligned rectangle (conservative).
4. **Head registration.** The operator jogs to two points and captures each (default: the point
   nearest the photo's bottom-left, then the point farthest from it). A proper similarity (rotation,
   uniform scale, translation, never a reflection) maps the outline to the bed. It is fitted in the
   canvas orientation of the device origin, so rear- and right-origin machines are not mirrored. If
   the head-measured scale differs from the typed size by more than 5 %, the capture is refused as
   the wrong point or the wrong size. Above 1 % the operator sees a notice.
5. **Registration keeps the layout.** The drawn outline keeps its centre and takes the shape and turn
   the head measured. Unlocked artwork whose centre lies on the drawn board turns about the same
   centre by the same angle, so every design keeps its place on the physical board. Locked artwork
   stays put. Placement switches to User Origin, front-left. One Undo step covers the whole change.
6. **Work origin by arithmetic.** On registration, one `G92` at the live head position makes the work
   offset the machine point of the outline's physical front-left bounding-box corner. This is the
   corner ADR-327's front-left anchor binds to. It reuses the confirmed write behind Restore saved
   origin, so the head need not stand on a corner that is in the air.
7. **Verify every point.** Each check point is a verification target. Accepting or fine-jogging
   records the head position, refits by least squares over every measured point, and re-sets the
   origin. The panel shows how many points have been checked and the largest miss. Neither is a
   Start gate: the completed Frame stays the sole ordinary Start policy gate (PROJECT.md
   non-negotiable 21, ADR-565).
8. **Remote control.** MCP clients can send the photo (`set_board_photo`), read status
   (`get_board`), place artwork (`place_on_board`), and with control approval capture and register
   (`capture_board_point`, `finish_board`), all under the existing `place-board` Pro gate. KerfDesk
   does the geometry; a client never supplies coordinates it measured from a picture.

### Consequences

- Check points land to the head's accuracy after verification. Between points the outline keeps the
  photo's error, which grows when the photo is taken at an angle; the photo window warns when the
  typed size does not match the clicked proportions. The panel suggests an edge margin.
- No new entitlement or Start check. Stale epochs (session, trusted position, work origin) invalidate
  an outline board exactly as they invalidate rectangles and circles.
- Output stays plain G-code with no transform: rotated artwork is rotated on the canvas.

### Revision (2026-10-21)

The first build used four clicks on a reference sheet to flatten the photo, then traced the board
automatically with the ADR-442 piece mask, and drew the board only after two head captures. In the
maintainer's test the clicks did not draw the board, the trace locked onto other edges, the MCP route
was invisible in the app, and nothing reached the canvas without a machine. Items 2, 3 and 5 replace
that flow; the reference-sheet and automatic-trace code was removed.

### Amendment 1 - Remote capture and finish keep the PC's Capture gate (2026-10-27)

**Status:** Accepted; unit-tested with the real panel behind the real remote adapter, not
hardware-tested. Fixes rolling audit v3 G7-P3-1 (P1 after its refuter,
`docs/audits/2026-10-27-rolling-v3/G7-app-shell-remote.md`).

**Context.** Item 8 gives MCP clients `capture_board_point` and `finish_board` as the panel's own
capture, and the tool text says "same as Capture on the computer". The PC disables Capture and
Finish unless the machine is connected, autofocus is not running, no controller write is pending,
and `jogFrameCommandBlockMessage` is clear: no job, motion or controller operation, no MPG, and a
known Idle status. The remote path checked none of this. The panel's `captureNow` recorded the
last rendered position with no machine-state check after the first point, which alone goes
through Set origin. So while a PC jog, Frame, Home, an MPG or the client's own job moved the head,
a remote capture recorded a mid-motion position as a board point. In the refuter's repro a
100 × 50 mm board was created as 100 × 54 mm. An outline capture 12 mm off the line between its
points turned the board 1.9° and moved the G92 corner 6.7 mm. Neither raised a warning.

**Decision.**

1. **One gate.** `boardCaptureBlockMessage` (`src/ui/laser/board-capture/board-capture-gate.ts`)
   is the PC gate as a plain function of the laser state. `useCaptureGating` selects it for the
   buttons. `boardActionBlockMessage` (`src/ui/remote-control/machine-actions.ts`) refuses remote
   capture and finish with it before the panel runs, so the operation fails definitely, writes
   nothing, and gives the reason the PC button shows. `captureNow`, used by both paths, checks it
   again and reads the position from the same store snapshot, not from the last render.
2. **A fresh Idle report.** A remote capture records the head only after a status report that
   arrived after the request finds the gate still clear. One status query asks for it; a
   controller that is only polled answers on its next idle poll. The capture is refused at once
   when that report shows the head moving, and refused when no report arrives within 3 s, the
   controller session changes, the panel closes, or a point is captured on the computer meanwhile.
   The PC button does not wait: its operator watches the head.
3. **Finish checks.** One function (`measuredRectChecks`, `board-finish-checks.ts`) gives the panel
   and remote finish the rectangle findings: too small (Create is disabled), off square by more
   than 5 mm, and a first corner more than 5 mm from the bottom-left. The PC operator reads the two
   warnings before choosing Create board outline. A remote client cannot, so, as with Zero Z
   (ADR-657 item 1), remote `finish_board` is refused where the PC warns, and the board can still
   be created on the computer. The outline scale note (more than 1 %) appears on the PC with the
   created board, so the remote receipt carries it. An outline the PC refuses (more than 5 %) is
   refused before the panel runs. A circle is finished on the computer.

**Consequences.**

- Remote board refusals are definite and safe to repeat, and the PC and remote gates cannot drift.
- Two-point outline registration cannot detect an error square to the line between the points,
  because a similarity always fits two points. The gate and the fresh report keep a moving head
  out of a capture; item 7's verification is what finds a point captured in the wrong place.
- `get_board` output is unchanged. The MCP tool descriptions name the new refusals.
- Reach: desktop 1.0.22 and 1.0.23 carry #1362. Whether the production relay Worker does was not
  observed. If it does not, the defect was latent until the relay redeploy that rolling v2
  01-P2-3 still needs, so this amendment lands before that redeploy.

### Amendment 2 - Undo and Redo restore Start From with the board (2026-10-27)

**Status:** Accepted; unit-tested through the real store and history, and through the real panel
behind the real remote adapter (`finish_board`). Not hardware-tested. Fixes rolling audit v4
H9-P2-1 (P1 after its refuter, `docs/audits/2026-10-27-rolling-v3/H9-undo-guards.md` on
`claude/rolling-audit-v3`).

**Context.** Item 5 says "One Undo step covers the whole change", and ADR-124 capture also switches
Start From to User Origin. All three Place Board writes (capture, outline registration, and the
correction that resizes a captured board) pushed the old project onto the Undo stack and set the live
placement in the same patch. Undo restores the live placement only from the setup context a step
records with `captureSetupHistoryContext`, as Machine Setup, the Laser/CNC toggle and device
changes do. No Place Board write recorded it. So Undo took the board and the outline's turn back
and left Start From at User Origin. In the refuter's repro, a job at Absolute started `G0 X50 Y360`.
After a rectangle capture and Undo the canvas again showed that layout with no board, but the job
started `G0 X0 Y10` from the `G92` board corner. An outline registered at 5° lost its turn and still
burned from the corner (`G0 X10 Y70`). The restored project's own saved placement said Absolute
while the live setting said User Origin. Start From and Job Review's origin tile name the mode, but
neither warns of that mismatch. MCP `finish_board` drives the same panel handlers, so it had the
same gap. Camera **Add target to canvas** (ADR-440 Amendment 5) had the mirror case: it replaced
the scene in one Undo step and then set Absolute outside it.

**Decision.**

1. **Place Board.** `commitCapturedBoard` (capture, Draw on canvas, and registration with no drawn
   outline), `registerCapturedOutlineMutation` and `updateCapturedBoardMutation` record the setup
   context before they change the project. One Undo puts the board, the artwork's turn and Start
   From back as they were. Redo puts all three back as registered. A later edit that is undone on its
   own leaves Start From as it is. Desktop and remote `finish_board` share these writes.
2. **Add target to canvas.** `replaceSceneWithGeneratedScene` takes an optional placement patch.
   With one, it records the setup context and applies the placement in the same patch as the scene,
   with the saved job setup kept in step. The target passes `{ startFrom: 'absolute' }` when Start
   From is not already Absolute, so Undo restores the operator's mode and Redo restores Absolute.
3. **No new warning.** Undo and Redo can no longer split the canvas from the placement, so neither
   Job Review nor Start gets a new check (PROJECT.md non-negotiable 21, ADR-565).

**Consequences.**

- Undo of a Place Board step also restores the selection and output scope recorded with it, as
  Undo of a Machine Setup change already does.
- The G92 the capture wrote stays on the controller after Undo. Undo restores the Start From the
  operator had, as at any other time the work offset is set and Absolute is chosen.
