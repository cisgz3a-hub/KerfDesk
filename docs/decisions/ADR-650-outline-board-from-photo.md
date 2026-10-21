## ADR-650 - Place Board: irregular outline boards from a photo, registered by the head (2026-10-21)

**Status:** Parked (2026-10-21). This branch does not work the way the maintainer wants; see "Known
problems" at the end before resuming. Originally requested as: "take a photo of a board ... add
measurements ... the canvas draws that shape ... it should know exactly where the board is on my
laser", "capture the bottom left side of the board to know the board coordinates", irregular
outlines, every corner verified.
**Date:** 2026-10-21

Extends [ADR-126](../../DECISIONS.md) (Place Board board-shape union) with a third arm, `outline`.
Builds on ADR-124 (jogged capture), ADR-125 (fill the board), ADR-327 (placement anchors are
physical corners), ADR-341 Amendment 5 (one G92 that sets a chosen work offset) and ADR-442 (find
pieces in a flattened picture).

### Context

Place Board registers rectangles and circles from head positions. Live-edge slabs, offcuts and
shaped blanks are neither. A phone photo shows their shape well, but a handheld photo carries no
relation to machine coordinates, and its scale and perspective are unknown. Neither a photo nor an
assistant reading one can say where the board lies on the bed.

### Decision

1. **Three sources, three unknowns.** The photo gives the outline's shape. The operator's typed width
   and height give its size. The head gives its position, rotation and a scale check.
2. **Photo to outline.** The operator taps the four corners of a known rectangle lying flat on the
   board's top (A4, Letter, custom, or the board itself). A homography flattens the photo to mm.
   The operator taps the board, and the ADR-442 piece mask traces its outline. KerfDesk simplifies
   that outline and picks up to six sharp convex corners as anchors. A "photo taken straight down"
   path skips the reference and says it is rough. The typed size rescales the outline per axis.
3. **Head registration.** The operator jogs to two anchors and captures each (default: the anchor
   nearest the board's bottom-left, then the anchor farthest from it). A proper similarity
   (rotation, uniform scale, translation, never a reflection) maps the outline to the bed. It is fitted in
   the canvas orientation of the device origin, so rear- and right-origin machines are not mirrored.
   If the head-measured scale differs from the typed size by more than 5 %, the capture is refused as
   the wrong anchor or the wrong size. Above 1 % the operator sees a notice.
4. **Work origin by arithmetic.** On commit, one `G92` at the live head position makes the work offset
   the machine point of the outline's physical front-left bounding-box corner. This is the corner
   ADR-327's front-left anchor binds to. It reuses the confirmed write behind Restore saved origin, so
   the head need not stand on a corner that is in the air. Placement is User Origin, front-left, as
   for rectangles.
5. **Verify every anchor.** Each anchor is a verification target. Accepting or fine-jogging records the
   head position, refits by least squares over every measured anchor, and re-sets the origin. The
   panel shows how many anchors have been checked and the largest miss. Neither is a Start gate: the
   completed Frame stays the sole ordinary Start policy gate (PROJECT.md non-negotiable 21, ADR-565).
6. **Canvas.** The outline is a locked, exact (unfaired) closed polyline on the registration layer with
   `captured-board` provenance, kept out of the burn. When homing has confirmed the controller-to-bed
   mapping, it is drawn where the board lies. Otherwise it is centred, like other captured boards.
   Fit and Array fill the outline's largest inscribed axis-aligned rectangle (conservative).
7. **Remote control.** The same steps are exposed to MCP clients under the existing scopes and the
   existing `place-board` Pro gate. KerfDesk does the geometry; a client never supplies coordinates
   it measured from a picture.

### Consequences

- Anchors land to the head's accuracy after verification. Between anchors the outline keeps the
  photo's error (about 0.5-1 mm with a flat reference on the board's top). The panel says so and
  suggests an edge margin.
- No new entitlement or Start check. Stale epochs (session, trusted position, work origin) invalidate
  an outline board exactly as they invalidate rectangles and circles.
- Output stays plain G-code with no transform: rotated artwork is rotated on the canvas, as Find pieces
  does.

### Known problems (maintainer testing, 2026-10-21)

Reported by the maintainer: "Clicking the 4 points on a photo is not drawing the board. It picks up
other lines and just acts weird. No MCP button and no way to save to canvas, it's blocked."

1. **The four clicks mean the wrong thing.** The operator expects to click the board's corners and
   see the board drawn. This build uses those four clicks for the corners of a reference sheet. It
   then needs a separate click on the board and traces the edge automatically. That trace is the ADR-442
   piece mask (Otsu split on colour or brightness), and on a hand-held photo it locks onto the sheet,
   shadows, grain and background edges. Next attempt: the operator clicks the board's own outline,
   so the clicked points are the shape. Scale comes from the typed size. Any automatic edge snapping
   only refines points the operator placed and never replaces them.
2. **No MCP entry point in the app.** The MCP tools are only callable by a connected AI client on the
   desktop build; there is no button, and the web dev server has no MCP at all. Next attempt: a
   visible "Get photo from phone" action in the panel (for example through the existing phone
   remote pairing), with MCP as an extra path rather than the only one.
3. **Nothing reaches the canvas without a machine.** "Use this outline" stays disabled until the
   draft validates (2–6 anchors, positive size, simple polygon). Even then the board is drawn only
   after two head captures on a connected machine. Next attempt: put the sized shape on the canvas
   straight away (locked, centred, unregistered), so artwork can be laid out on it, and register its
   position with the head later.

Still sound and worth keeping: the frame mapping and origin arithmetic (`board-outline-registration`,
`sceneAxisSigns`, `setOriginAtMachinePoint`), the proper-similarity fit, the exact unfaired
registration polyline, Fit/Array inside an outline, and the Pro gating with its tests.
