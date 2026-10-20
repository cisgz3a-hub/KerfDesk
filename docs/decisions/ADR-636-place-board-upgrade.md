## ADR-636 - Place board: custom shapes, the pointer, nine-point placement (2026-10-19)

**Status:** Accepted. Extends ADR-124 (capture board corners), ADR-125 (fit and array on a board)
and ADR-126 (board shapes); uses ADR-341 Amendment 5's offset G92 and ADR-641's jig-mode page. | **Date:** 2026-10-19

### Context

The maintainer asked for a better Place board tool:

- an easier, better-looking panel;
- the machine's built-in pointer (red dot or crosshair) switched on automatically while corners
  are captured;
- boards of any shape, formed by capturing their corners, not only rectangles and circles;
- placing artwork at any of nine spots on the board (the corners, the middle of each edge and the
  centre), not only the centre and the four corners.

Two existing weaknesses surfaced while designing it. A rectangle's work origin was set at the
first captured corner, so capturing another corner first put the origin, and the burn, at the
wrong corner; the panel could only warn and ask the operator to start over. And the rectangle and
circle check points assumed machine +X and +Y point right and away from the operator, so on a
rear- or right-origin machine a check of "top-left" moved the head beam-off to a point off the
board.

### Decision

1. **Custom shape.** A third board shape captures three to 64 corners, normally in order around
   the edge. If the capture order crosses itself, the corners are re-sorted around their centroid
   when that gives a simple outline, and the panel says so and draws the re-sorted outline on the
   map; otherwise the outline is refused.
   The outline is a locked, closed, straight-edged registration polyline (stamped at the current
   pen fairing version so it is never rounded) that is excluded from the burn like any captured
   board. Its job placement is the rectangle's: user origin, front-left anchor.
2. **Origin at a machine point.** A custom shape's work origin is the physical front-left corner of
   its bounding box, which is usually not a point on the board. It is set with one G92 at the live
   machine position (`setOriginAtMachinePoint`, the same write as ADR-341 Amendment 5's Restore
   saved origin) without moving the head, and Place board refuses the outline unless the
   controller confirms the new offset. Commit accepts exactly the one work-origin change it wrote.
   An unconfirmed or failed write may still have landed and uses up that change, so Place board
   then says the work origin may have moved and sends the operator to Start over; it does not
   write a second G92 that the commit would refuse. Where the head already is on the point, the
   ordinary Set origin here is used instead.
3. **Rectangle first corner.** If the first captured corner is more than 5 mm from the front-left
   corner, creating the outline moves the origin to the front-left corner by the same offset G92
   and says so. Otherwise the first corner stays the origin, as before.
4. **The pointer.** When the device profile has a usable separate positioning light (ADR-612,
   Machine Setup) and the project is in Laser mode, the panel switches it on as soon as Place
   Board is open with a board still to capture, so the operator aims with it from the first
   corner, and off again when the board is created or the panel closes, but only a light the
   panel itself switched on. In CNC mode Place Board neither switches nor aims with the light,
   like the jog panel's LED controls: its mapped command can be coolant (M7/M8) and its offset is
   from the beam, not the bit. A failed automatic switch-off is shown as a toast, since the page
   may already be closed. It uses
   the ordinary positioning-light transaction (fresh Idle check, beam-off lines, then the light's
   own command), waits for the controller to be free instead of queueing, and tries once per
   capture. The operator can switch it by hand and can turn the automatic switch off; the choice is
   remembered in this browser. The cutting beam is never used as a pointer.
5. **Aiming with the pointer.** While the light is on, a captured or checked point is the head
   position plus the light's configured offset, converted from canvas axes to machine axes, and
   a move meant to put the light on a point targets the point minus that offset. This covers corner
   capture, circle rim and centre capture, the calculated circle centre and the board checks. With
   the light off, nothing changes.
6. **Nine-point placement.** A 3x3 grid places the selected artwork, moved as one block, at any of
   nine spots a chosen edge margin in from the board edge. On a rectangle this is plain alignment.
   On a circle or custom shape the artwork starts at the centre of the material and slides toward
   the chosen spot until it meets the margin, so it stays on the board; artwork that cannot fit is
   still aligned to the bounding box, with a warning. Fit to board centres artwork on the widest
   part of a custom shape and finds the largest scale that keeps the margin. Array on board keeps
   only the copies that sit on the custom shape.
7. **Orientation.** Rectangle and circle checks, the first-corner test and custom-shape outlines
   use the device origin's axis directions, so they match the physical board on every origin
   corner. Front-left and centre origins behave exactly as before.
8. **Place Board mode.** A floating card over the canvas covered the artwork it was meant to place,
   so Place Board became a page, built like jig mode (ADR-641): it takes the place of the tool
   strip and the main canvas while the machine panel (connect, jog, positioning light) stays
   docked beside it, and the whole job happens there, from the first capture to the last burn.
   Its three steps are **1 Capture board** (shape tiles, the pointer bar, the capture card, then
   the measured board and its checks), **2 Place artwork** (Import artwork, the placement grid,
   Fit to board, Fill with copies) and **3 Burn** (power, speed and passes for the operations the
   artwork uses, then the workspace's own Frame and Start, which leave the machine panel while
   the page is open and the project holds a captured board; until then the machine panel keeps
   them). Steps 2 and 3 work from the board in the project, so they still work after the
   project is reopened; step 1 then says that capturing again replaces that board. Creating the outline moves on to step 2. The page's canvas is jig mode's
   editing canvas on the open project, so artwork is moved, resized and rotated on the board
   with ordinary Undo; over it the page paints the points captured so far, the outline they
   make, the live head or pointer crosshair and the board's check points. Done returns to the
   main canvas; there is nothing to save. Opening Place Board closes jig mode and the reverse.
9. **The outline where the board is.** The captured outline is drawn where the board sits on the
   bed, from its machine position, so it lines up with the captured points and the head marker.
   This is display only, since the burn is anchored to the work origin; when the position is
   unknown or off the bed the outline is centred, as before.

### Alternatives

- **Ask the operator to move the head to the bounding-box corner and Set origin there.** It adds a
  motion step to every custom shape and puts the head over a point that is often off the material.
  The offset G92 needs no motion and is already proven by recovery.
- **Fire the laser at low power as a pointer.** Rejected: it can mark the board and it bypasses the
  beam-off guarantees of every capture and check move.
- **Treat a custom shape as its bounding box for placement.** Simple, but the corners of a
  hexagon's or a circle's box are off the material, so artwork placed there would overhang.

### Consequences

- The origin action, its confirmation wait and the Start gates are unchanged; only the point the
  origin is set at changes for custom shapes and for a rectangle captured from another corner.
- Nesting on a custom-shape board still uses the board's bounding box.
- Existing projects with rectangular or circular boards load and behave as before.

### Verification

Unit tests cover the custom-shape geometry (ordering, re-sorting, orientation, origin and
correction), the rectangle and circle check points, rectangle corrections, the front-left corner
and the pointer offset on every origin corner, the offset G92 and its refusal when unconfirmed,
the nine-point placement on rectangles, circles, a triangle and an L-shape, the
reducer's origin-advance rule, and the panel flows, including the pointer switching on for capture
and off after it. The panel was checked in the browser build. It has not been run on hardware:
the positioning light and the offset G92 still need an air test on a machine.
