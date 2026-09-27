## ADR-470 - Point at, measure and isolate moves in the 3D view (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

The third of five batches from the 2026-09-26 audit of the three.js viewers (after ADR-425 and
ADR-426). The first two batches made the G-code Inspector's 3D view correct and pleasant to move
around. This batch makes it answer questions: what is this move, how far apart are these two
points, and what does this part of the job look like on its own.

### Context

1. **The view could not be asked about a move.** The 3D view drew every move but could not say
   which line of G-code a stroke came from. Finding the line behind a suspicious move meant
   scrubbing the timeline until the playhead reached it, or reading the source by eye.

### Decision

1. **Pointing at a move** (`ui/viewer3d/scene-pick.ts`, `ui/viewer3d/pick-ids.ts`,
   `ui/gcode-inspector/use-move-pointer.ts`, `ui/gcode-inspector/InspectorMoveTip.tsx`).
   - A pick pass draws the thin copy of every move into a 13 x 13 pixel square around the pointer,
     each move in a colour that spells its segment index plus one, and reads the square back. The
     move drawn nearest the pointer is the one named. The pass shares the ghost lines' geometry
     (one extra 4-byte attribute per vertex), is built on the first hover, and costs one small
     draw per pointer update however long the program is. It honours depth, the travel toggle and
     both projections.
   - The point on the move nearest the pointer's ray gives the position and, with the planner's
     per-move times, the moment the tool reaches it.
   - Hovering outlines the move in cyan inside a dark casing, drawn over everything. Cyan is no
     move kind's or lens's colour, and the casing keeps it readable over Classic's pale lines and
     over Studio's warm ones. A card beside the pointer gives the line number, the kind of move
     and its G word, X Y Z at the pointer, the feed (or "rapid") and power in force, and when the
     tool gets there. The card flips to the pointer's other side near the view's edges.
   - Clicking a move (press and release within 4 pixels) selects its line in the source pane and
     moves the playhead to the clicked point. In live mode it selects the line only, because the
     playhead follows the machine there.
   - Hover pauses while a mouse button is held or the camera moves, since the pick would chase a
     moving view. A click still counts: pressing a button starts a zero-length camera drag.
   - Both looks and the canvas preview get it; the source pane and timeline already reach the
     same places from the keyboard, so the card is a pointer convenience and stays hidden from
     screen readers.

### Consequences

- **Picking reads pixels back synchronously.** One 13 x 13 read per animation frame while the
  pointer moves over the view. That stalls the GPU queue briefly; the square is tiny and nothing
  is picked during a drag, so it does not show. Batch 4 (large files) revisits it if programs of
  millions of moves make the pick draw itself slow.
- **Not a guard (ADR-228).** Nothing here blocks, refuses or asks for confirmation. Every addition
  reads the program; CAM and G-code are unchanged.

### Verification

- Unit tests:
  - `encodePickIds` paints both ends of each move with its index plus one and round-trips indices
    past 2^24; `nearestPickedSegment` names the move nearest the centre, finds one at the window's
    edge and names nothing over empty space.
  - `moveReadout` wording for a cut, a rapid and a program without power; `secondsAtPick`
    interpolates along the move and clamps.
  - `InspectorMoveTip`: one pick per frame at canvas coordinates, the outline follows the pick,
    nothing while a button is held or the view is not ready, a click locates while a drag does not,
    and a click still locates while the camera reports movement.
- Browser (`e2e/gcode-viewer-pick.e2e.ts`): hovering a real square job names a cut on its lines
  with its feed and time; clicking it moves the playhead to that line; moving off clears the card;
  in Studio's orthographic Top view the same pick reads X 0 or 80 and Z -1. Screenshots of the
  hover in both looks.
