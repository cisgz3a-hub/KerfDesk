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
