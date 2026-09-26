## ADR-442 - Find pieces on the bed and place the design on each (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

### Context

A common camera job is a batch of blanks: coasters, tags or offcuts laid on the bed by hand, a
little crooked, each needing the same design. LightBurn places a design by hand on the camera
picture, one copy at a time. xTool Creative Space and Glowforge find the pieces and fill them,
which is the part operators ask for. The offline production roadmap (Initiative 3, batch fill,
in `docs/audits/2026-08-01-offline-production-expansion-roadmap.md`) set the rules for this:
moves and turns only, never a scale; one Apply is one undo step; nothing is committed without
the operator; no "AI" wording and no confidence figure; show each piece's outline, centre, angle
and measured move; every piece can be left in or out; unmatched pieces are shown, not refused;
and Frame traces the rectangle around the whole fill, which the operator is told.

ADR-440 gives a top-down picture of the bed in millimetres at the right height (ADR-441
Amendment 2 for raised objects), so finding pieces is image analysis on that picture, with no
new camera geometry.

### Decision

1. **Finding pieces (`core/camera/pieces/`).** The frame is flattened onto the bed with the camera
   model at 2 px/mm (coarser only on beds above about 700 × 700 mm, to keep the picture near two
   megapixels). Then:
   - The colour is blurred over about half a honeycomb cell (two box passes, radius 2.5 mm),
     normalised by the pixels the camera saw, so the bed's cell pattern becomes an even tone and
     an unseen margin never darkens a piece beside it.
   - Each pixel gets one feature: the colour distance to a reference point when there is one,
     otherwise brightness. The reference is the selected design's centre when it lies on the bed,
     so a blank as bright as the bed is still told apart by its colour. Otsu's method splits the
     feature, and the split is moved to halfway between the two sides' means, so a blurred
     straight edge stays where it really is. The side that owns less of the picture's edge is
     the pieces, because the bed surrounds them. This holds whether the reference sits on a blank
     or on the bed.
   - The mask is opened and closed by 1 mm, and each 4-connected group is a piece. Groups under
     100 mm² are dropped. A group that touches the picture's edge or a pixel the camera did not
     see is marked partial.
   - Each boundary crossing is placed between the two pixel centres where the feature crosses the
     split. The smallest rotated rectangle around those points gives the angle, and then each
     straight side moves to the median of the points along its middle 80 %, because the smallest
     rectangle touches the outermost points and noise would make it too big. A side that only
     touches a corner or a curve, as on a disc, stays where it is.
   - A piece is round, square (sides within 8 %) or oblong. A square piece that fills less than
     86 % of its rectangle is round. A piece whose centroid (holes left out) sits more than
     max(0.5 mm, 2 % of its length) from its rectangle's centre has a heading, the direction of
     that offset.
   - Pieces are returned in rows, top to bottom, each row left to right.
2. **Where the design goes (`piece-placements.ts`).** When the design's centre lies on a found
   piece, that piece is the sample. Every other piece gets a copy moved by the offset between the
   two pieces' centres and turned about the piece's centre by the angle between them, so the
   design sits on each blank the way it sits on the sample. The long sides fix that angle up to
   a half turn (a quarter turn for square pieces). When both pieces have a heading, it picks among
   those turns. Otherwise the smallest turn is used. Two round pieces with no heading need no turn.
   When the design is not on a piece, it is centred on each piece with its long side along the
   piece's long side. Placement 0 is the design itself: it stays put on the sample, or moves to
   the first piece when the sample is left out.
3. **Applying (`placeSelectionCopies`).** The array action's body becomes
   `applySelectionPlacements(state, placementsFor)`. The array keeps its own placements, and the
   fill passes explicit ones. It is one undo step, and groups, locks and hidden layers behave as
   they do for an array.
4. **Panel and canvas (`ui/camera/pieces/`).** The Camera panel gets a **Pieces on the bed**
   section:
   - **Find pieces** captures a frame and lists every piece with its size and angle, and with how
     the selected design will move and turn onto it. Each piece has a tick box.
   - The piece under the design says so. A piece the camera saw only in part starts unticked, with
     the reason. A piece whose size differs from the sample by more than 3 mm, or whose shape
     differs, is flagged but stays ticked.
   - **Place selection on each piece** applies the fill and says that one Undo takes it all back,
     and that Frame traces the rectangle around all the copies.
   - The canvas draws each piece's outline, centre and long-side line, with its number. Pieces
     left out are drawn faint and dashed.
   - Finding pieces turns the overlay on, so the outlines sit on the camera picture. Nothing in
     the project changes until Place.

No new guards. **Find pieces** is disabled without a live camera, like **Trace from camera**,
because there is no frame to capture (a transport precondition). Place with nothing selected,
or with every piece unticked, says what to do instead of placing nothing silently.

### Measured

- Rendered top-down beds with 80 × 50 mm plywood blanks at 0°, 23° and 140° on a honeycomb, 2 px/mm
  and grain noise: centres within 0.2 mm, angles within 0.1°, and sizes within 0.3 mm for turned
  blanks. A blank square to the honeycomb rows reads up to 0.9 mm large, because the half-blurred
  cell rows beside it shift the local bed tone.
- Rendered 1280 px fisheye frames from a tilted overhead camera, 3 mm blanks at four angles,
  through `warpFrameToBedImage`: centres within 0.8 mm and angles within 1°.
- A blank on a 40 mm box is found within 0.8 mm with its height area and more than 3 mm off
  without it.
- Blue acrylic about as bright as the blurred bed is found using the reference colour.
- A lopsided arrow shape turned by 200° gives -160°, so a heading fixes the full turn.

### Consequences

- The search runs on the main thread after the capture: about 0.45 s in Node for a 400 mm bed at
  2 px/mm with six blanks, plus the flattening. A worker can take it later if large beds need it.
- The thresholds (blur radius, 100 mm² smallest piece, square and round limits, 3 mm size flag)
  come from rendered fixtures. The roadmap asks for a photographed corpus before calling them
  production defaults, so the hardware acceptance on a real camera and bed is still owed.
- Not in this decision, from the roadmap's manual draft: ghost copies of the design before Place,
  and adding or dragging a target by hand. The copies are ordinary objects, so they can be moved
  or turned after Place.
- A raised object outside its height area can also show up as a piece, because the camera sees
  it in front of the bed. It is listed like any other piece and can be unticked.
- Camera print-and-cut (registration marks on a printed sheet) is a separate decision.
