## ADR-196 Amendment 1 - A press drags only after it has travelled, and picks by screen distance (2026-11-11)

**Status:** Accepted. Extends ADR-196 (geometry-first picking, the move handle, Alt+click). Keeps
ADR-683 and its amendments (a Fill shape is solid only where it is filled), ADR-222 (the
single-artwork default) and ADR-706 (a right-click on locked artwork offers Unlock). Leaves ADR-565
and PROJECT.md non-negotiable 21 unchanged: no Start, Frame, output or machine rule moves, and no
G-code changes. | **Date:** 2026-11-11

### Context

Round two of the user annoyance audit (`docs/audits/2026-11-11-annoyance-a2/`, section B6) listed
five faults in how the canvas answers the pointer. The audit was a static read, so each was
reproduced with a failing test through the real pointer pipeline before it was changed (fix group
G3). All five reproduced.

1. **B6-P2-3, no drag threshold.** A press on artwork returned a `move` drag at once and the first
   pointer move wrote transforms. With snapping on, a one-pixel slip was pulled to the nearest grid
   line. A click to select left the object somewhere else, marked the project changed and put a
   Move in undo. Scale and rotate handles behaved the same way. A moved object no longer matches a
   completed Frame's footprint, so the slip also cost the Frame (ADR-565).
2. **B6-P3-9.** A plain click on one of several selected objects left them all selected.
3. **B6-P2-2, picking in millimetres.** A click reached a line within a fixed 2 mm of artwork.
   Handles, guides and the snap reach are already sized in screen pixels. Where several lines were
   in reach the one stacked on top won, however far it was. A press inside any closed outline took
   hold of the outline, so a selection box could not be started inside a border.
4. **B6-P2-6, handles over small artwork.** The eight resize handles are 8 px squares tested before
   the artwork. On a small selected object they met and covered it. The audit put the limit at
   about 20 px; the measurement was narrower: on a 9 px box the very middle still moved, a press
   near a corner resized, and below 8 px the whole body resized. On a straight line the top and
   bottom handles sat on the move handle and did nothing, so dragging a selected line by its middle
   did nothing.
5. **B6-P2-1.** Every stationary right-click selected the one object under the pointer, or cleared
   the selection on empty canvas. Right-clicking one of five selected objects left one, and the
   menu then offered Group, Align and Distribute.

The reproduction found one fault the audit did not list. A selected straight line could not be
made longer by dragging its end: the corner handle lies on top of the end handle and was tested
first, and its aspect lock holds a box with no height to its present length.

### Measurements

The canvas bitmap is one canvas pixel per CSS pixel. At fit zoom the scale is the canvas, less its
30 px margins, over the bed. For an 1100 x 760 px canvas:

| Bed | 2 mm at 0.1x | 2 mm at fit | 2 mm at 16x |
| --- | --- | --- | --- |
| 100 x 100 mm | 1.4 px | 14 px | 224 px |
| 400 x 400 mm | 0.35 px | 3.5 px | 56 px |
| 1300 x 900 mm | 0.16 px | 1.6 px | 25 px |

So the old reach ranged from a sixth of a pixel to over 200 px. The audit suggested 5 px capped at
2 mm. The cap was not adopted: it would leave a large bed at fit zoom with a 1.6 px target, which
is the half of the finding about thin line art being hard to click.

### Decision

1. **A press becomes a drag after it has travelled** (`src/ui/workspace/drag-threshold.ts`).
   - Move, scale, multi-selection scale and rotate wait until the pointer is more than 4 px from
     where a mouse button went down, 6 px for a pen and 10 px for touch, measured in CSS pixels.
     4 px is the right-click's existing tolerance. The pen and touch values are KerfDesk's own
     choice and were not measured on hardware.
   - Until then nothing is written, no undo snapshot is taken and the project object is the same
     object, so nothing keyed on it can change. Esc, a lost pointer capture and a tool change end
     the press as they end a drag, with nothing to roll back.
   - The move that passes the threshold takes the snapshot. From then on the drag is the drag it
     always was, still measured from the press point, so the point that was grabbed stays under
     the pointer and coming back inside 4 px does not stop it. One drag is one undo step.
   - The press on record is a ref, not React state, because two pointer moves can arrive before a
     render between them.
   - Marquee, pan, draw, measure, node, segment, guide and tab drags are unchanged. A trace-part
     pick still separates its part on the press; only its move waits.
2. **A click on one of several selected objects selects it alone**, on release without travel. The
   selection is unchanged while the button is down, because the press may become a drag of the
   whole selection. A click on the move handle keeps the selection. Shift+click still toggles and
   Alt+click still cycles, both on the press.
3. **Picking rules** (`hitTestDetailed` in `src/core/scene/hit-test.ts`).
   - **Reach.** A click reaches a line within 5 canvas pixels at the live zoom
     (`STROKE_PICK_SCREEN_PX`, `src/ui/workspace/workspace-hit-test.ts`). The workspace converts
     that to millimetres and passes it in, so `src/core` holds no pixels. A caller with no view
     (the registration jig editor, Design Studio's photo pick) keeps 2 mm.
   - **Curves.** Hit polylines are flattened for the reach in use, on the bed, at an eighth of it.
     Chords cut for 2 mm lie up to 0.25 mm, times the object's scale, from the drawn curve; with a
     reach of a few hundredths of a millimetre a click on the line would have missed it.
   - **Order.** Objects are scanned from the top. An object painted over the point (a filled area
     where it is filled, an image) ends the scan: nothing beneath it is reached. Of the lines in
     reach above it, or of all lines in reach when nothing is painted there, the nearest wins and
     stacking order settles a tie. If no line is in reach, the painted object wins. A line drawn
     over a filled shape is therefore still picked from beside the line, as before.
   - **Interior.** With no such hit, the smallest outline around the point is picked by its
     interior, as ADR-196 decided. The hit now says which kind it was.
   - **A press inside an outline that is not selected** selects it on a click, as before, on
     release. When the press becomes a drag it draws a selection box instead of moving the
     outline. An outline that is already selected is still moved from anywhere inside it, and any
     outline is still moved by its line.
   - **Alt+click** has the same reach and keeps its stacking order.
   - The hover readout, the hover pulse, the text tool, artwork numbering and the guide pick use
     the same reach.
4. **Handles on a small selection** (`src/ui/workspace/handle-layout.ts`), for a single object's
   own box and for a multi-selection's box alike.
   - A side shorter than 24 px has no middle handle.
   - A middle handle also goes when the box is under 8 px across the other way, where it would
     cover its twin and the move handle.
   - On a box under 24 px on its shorter side, a press strictly inside the box never takes a
     handle: the move handle and the artwork get it. Each corner handle answers on the part of its
     square outside the box.
   - A straight line along one of its own axes keeps only the two handles at its ends. A line
     under 24 px long leaves the band between its ends to the artwork.
   - Of two handles whose squares overlap, the nearer answers.
   - Only the handles that answer are drawn.
   - The registration jig editor draws and tests the same multi-selection handles, so it follows
     these rules. It already left the inside of a box under 8 px to the artwork.
   - The alternative, moving the handles of a small box outside it, was not taken: a resize would
     then need a grab offset so the corner did not jump to the pointer.
5. **A stationary right-click keeps a selection it lands on**
   (`src/ui/workspace/workspace-context-menu.ts`).
   - On an object of the selection, or on the selection's move handle, the selection is kept and
     the selection menu opens.
   - On an object that is not selected, that object is selected alone, as before.
   - On empty canvas the selection is kept and the empty-canvas menu opens. It used to be cleared.
   - On locked artwork the selection is kept and the menu opens with Unlock first (ADR-706).
   - Trace-part mode is unchanged.

### Consequences

- A click selects and nothing else. Clicking never moves artwork, marks the project changed, adds
  an undo step or changes what a completed Frame was traced for.
- Dragging the inside of an outline that is not selected no longer moves it. Select it first, or
  drag it by its line.
- A deliberate move shorter than 4 px needs the arrow keys or the position boxes.
- An ordinary click now scans every object under the pointer's box instead of stopping at the
  first line in reach. It stops at the first painted object. A click on empty canvas already
  scanned them all.
- Two tests that pinned the old behaviour were changed on purpose in
  `use-workspace-drag-hook.test.tsx`: a right-click on empty canvas no longer clears the selection,
  and a press holds no undo snapshot before it travels. One assertion in `handles.test.ts` moved to
  a box large enough for a handle to answer inside it.

### Not decided here

- What LightBurn does was not checked. `LIGHTBURN-STUDY.md` has no note on selection and
  LightBurn's documentation could not be reached, so none of the numbers above claim parity.
- Node, segment, guide and tab drags still start on the press.
- A resize by a handle still does not snap (B6-P3-6).

### Verification

- `src/core/scene/hit-test-tolerance.test.ts`: the reach, the nearest line, painted shapes, hit
  kinds and a scaled curve at a 0.05 mm reach.
- `src/ui/workspace/use-workspace-drag-press.test.tsx`: the threshold for move, scale, rotate and
  multi-selection scale; mouse, pen and touch; Esc; the undo snapshot; click narrowing.
- `src/ui/workspace/use-workspace-drag-picking.test.tsx`: the reach at zoom 0.25, 1, 4 and 16; the
  selection box from an interior; the right-click cases; small objects and straight lines.
- `src/ui/workspace/handle-layout.test.ts`: which handles a box shows and answers to.
- `e2e/pointer-feel.e2e.ts`: click, drag and right-click at low and high zoom in Chrome.
