## ADR-480 - Seven design tools from the LightBurn gap list, batch 5 (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

Builds LBG-T05, LBG-T07, LBG-F03, LBG-F08, LBG-F12, LBG-C07 and LBG-I04 from
`docs/audits/2026-09-26-lightburn-gap-audit.md`. The maintainer chose "Build all ten" on
2026-09-27, as two pull requests: these seven design tools first, then the three that move the
machine (LBG-T15, LBG-M02, LBG-M07). Nothing here moves the machine. Only Sort cuts last and the
bulk output switches change what a job burns, and both do it by editing settings the user can see
and undo.

### Context

LightBurn behaviour, read on 2026-09-27 from `https://docs.lightburnsoftware.com/latest/Reference/`:

- **Apply Path to Text** (`ApplyPathToText/`): Align X is Left ("the start of the text is next to
  the start point of the path"), Middle and Right. Align Y is Top ("the top of the text directly
  under the path"), Middle ("the text's vertical center on the path") and Bottom ("the bottom of
  the text directly on top of the path").
- **Create Rubber-Band Outline** (`CreateRubberBandOutline/`): "the shortest possible path that can
  contain all graphics in your selection, as if a rubber band were stretched around them", images
  included. The outline goes on the last layer picked in the colour palette.
- **Edit menu** (`UI/EditMenu/`): Select Contained Shapes ("The currently selected shape remains in
  the resulting selection"); Select Shapes Smaller Than Selected; Delete Duplicates, `Alt+D`
  ("objects with identical shapes, sizes, and positions"); Close Path ("Connects a shape with one
  start and one end node by creating a new line between them"); Reverse Shape Direction.
- **Numeric Edits toolbar** (`NumericEditsToolbar/`): XPos, YPos, Width, Height and Rotate accept
  equations such as `(10+2) * 4 + 1`, the constants e and pi, functions such as sin, cos, tan,
  sqrt, abs, atan, log and pow, unit suffixes such as `5in` and `5"`, and a percentage beside Width
  and Height.
- **Cuts / Layers** (`CutsLayersWindow/`): Sort Cuts Last orders layers by strength ("higher Power,
  lower Speed, and more Passes") and puts every Line layer last. Right-clicking a column heading
  offers enable, disable and invert output, and show, hide and invert visibility, for all layers.
- **Apply Mask to Image** (`ApplyMaskToImage/`): Flatten Image Mask "also removes the masking
  shape, leaving you with only an image in the shape it had been masked". The gap audit row said
  the mask is kept; the documentation says otherwise, and this decision follows the documentation.

### Decision

1. **Path text alignment.** The text dialog's path section gets **Place at** (Start, Middle or End
   of path) and **Text sits** (On top of, Centred on, or Hanging below the path). They are optional
   `pathText.alongAlign` and `pathText.acrossAlign` fields; absent means start and on top, the old
   placement. The offset always pushes away from the chosen point: forward from the start or
   middle, back from the end. Text that does not fit between the ends with its offset is refused
   with the existing "longer than the available guide path" message.
2. **Project schema 12.** Path text is re-rendered when it is edited and when variable text such as
   a serial number changes, so an older build that ignored the alignment would burn the text in
   the wrong place. Older builds refuse schema 12 with the existing "newer version" message.
   ADR-457 and this work initially used separate schema-11 variants. Schema 12 preserves both
   CNC stage recipes and path-text alignment. The 10 to 11 to 12 migrations only change the
   version: absent recipes or alignments retain their legacy defaults, while either schema-11
   variant keeps its authored values through loading and saving.
3. **Rubber-Band Outline.** **Tools → Vector → Rubber-Band Outline** adds the convex hull of everything
   selected as one closed path and selects it. Vector artwork and text contribute their real world
   outlines; images and reliefs contribute their four transformed corners. KerfDesk has no
   "current palette layer", so the outline takes a copy of the first selected artwork's Line
   operation settings (the ADR-103 offset rule), or a new Line operation named Outline when nothing
   selected is on a Line operation. A selection with no area (one straight line) is explained in a
   notice and changes nothing. One undo step.
4. **Select Contained and Select Smaller Shapes.** Both are in the Edit menu, keep the current
   selection and add to it, and only pick artwork the user could click (unlocked, on a visible
   operation), like Select Open Shapes (ADR-410). Contained means every outline point of the
   artwork lies inside one closed path of the selection, in world space, so a shape straddling two
   containers or crossing the notch of a concave one is not added. Each outline segment,
   including the closing segment, is partitioned at boundary intersections and checked throughout;
   contained vertices alone cannot establish containment. Separate paths remain separate, and
   boundary contact counts as contained. Smaller means no wider and no
   taller than the widest and tallest selected object, measured on the rotated world box. Each says
   how many objects it added, or why it added none.
5. **Delete Duplicates** (`Alt+D`, Edit menu) deletes later copies of artwork drawn twice in the
   same place for the same output. Better than LightBurn's identical-shape match:
   - geometry is compared in world space to 0.001 mm, so a separate object with the same transform
     baked in, or a copy moved back onto its original, still counts;
   - a closed shape that starts at another corner or runs the other way is the same shape, which is
     how doubled outlines arrive from DXF files; an open path drawn backwards is the same path;
   - copies on different operations, with a different power scale, or with a different operation
     override are deliberate (score, then cut) and are kept;
   - fill rules, relative nonzero winding, materialized stroke envelopes and manual CNC tab
     annotations participate in equivalence. Tabbed paths keep their authored path order,
     start and direction in the comparison because a tab fraction depends on that basis;
   - locked artwork, image masks and path-text guides are never deleted, and one of them is kept in
     preference to an unprotected copy.
6. **Close Path and Reverse Direction** (Tools → Vector) edit imported, traced and drawn-line artwork
   on any operation, which the node tools can also edit. Both change the exact curves and the
   compatibility polyline together, and leave a path whose curves and polylines do not pair up one
   to one alone rather than guessing.
   - Close Path joins each open path of three or more points with a straight line and says the
     widest gap it closed, in millimetres, so a surprise long closing line is visible at once. The
     closed polyline repeats its first point, as every closed KerfDesk path does, so the canvas
     draws the closing line; the rubber-band outline does the same.
   - Reverse Direction swaps the ends of an open path. A closed path keeps its start point and runs
     the other way round, and CNC tab positions move with it (`t` becomes `1 − t`). Anchors on
     paths left unchanged keep their original fraction and physical position.
   - Text and drawn rectangles, ellipses and polygons rebuild their paths from their settings, so
     the notice says to convert them to paths first.
   - When Cut Planner may cut open paths from either end (Path direction Allow reverse with a
     travel policy other than source order), Reverse Direction says how to keep the new direction.
     Kerf offset still sets its own winding for closed paths, as before.
7. **Math in number boxes.** The X, Y, Width, Height and Rotation boxes of the numeric edits bar
   take `+ − × ÷ ^`, brackets, `pi`, `e`, `sqrt`, `abs`, `sin`, `cos`, `tan`, `asin`, `acos`,
   `atan` (in degrees, like every KerfDesk angle), `log` (base 10) and `ln`, and the units mm, cm,
   in and `"` (lengths) or deg and `°` (angles). Width and Height take a percentage of the current
   size. A hand-written parser does it, with no `eval`. Typing inches is the explicit
   input-boundary conversion PROJECT.md non-negotiable 6 permits; nothing shows inches back. A
   typing mistake says what was wrong and what to type instead, and the box snaps back; a blank box
   snaps back silently. ArrowUp and ArrowDown still nudge by 0.1 mm or 1°. `pow` is `^`.
8. **Operations list tools.** A "•••" menu on the Cuts / Layers header has Turn output on for all,
   Turn output off for all, Invert output, Show all, Hide all, Invert visibility and Sort cuts
   last, and every row gets **Show only this**. Each is one undo step, or none when nothing
   changes, and none writes `parkedOutput` (ADR-416).
   - The registration jig (ADR-057) is burned in its own run. Turning output on for all and
     inverting it leave the jig as it is; turning output off for all includes it.
   - **Sort cuts last** keeps Fill and Image operations where they are, then orders Line operations
     weakest to strongest by power × passes ÷ speed, with per-artwork settings and power scale
     applied. Artwork priority (ADR-211) is the laser's run order, so it also reorders the saved
     Run order: engrave-only artwork, then artwork that both engraves and cuts (its cut runs right
     after its own engraving), then cut-only artwork weakest first. Run units stay whole, and
     artwork without output keeps its place. It is a one-time rewrite of saved orders, not a new
     ordering rule, so the compiler keeps a single rule. The jig keeps its place. In CNC the entry
     is disabled with "CNC already runs profiles last".
9. **Flatten Image Mask** (Tools → Image, beside Crop Image) bakes the mask into the image and crops it exactly as Crop
   Image does (greyscale, like Crop), then deletes the mask shape, as LightBurn does. The mask shape
   stays when it is locked or another image or path text still uses it, and the notice says which
   happened. One undo step.

### Alternatives

- **Put the rubber-band outline on the selected operation in the Cuts / Layers list.** Rejected:
  KerfDesk operations belong to artwork, so there is no palette layer to mean "current". Copying
  the first Line operation matches Offset Shapes.
- **Match duplicates only when every node is identical, as LightBurn describes.** Rejected: DXF
  doubles usually start at another corner or run the other way, and those are the copies users
  need removed.
- **Sort Fill and Image operations by strength too, as LightBurn does.** Rejected: the user's
  engraving order is often deliberate (a light fill under a darker one), and only the cuts need to
  move for the parts to stay put.
- **Keep the mask shape on Flatten, as the audit row said.** Rejected: the LightBurn documentation
  deletes it, and Crop Image already covers baking while keeping the shape.
- **Trigonometry in radians.** Rejected: every angle a KerfDesk user types is in degrees.

### Consequences

- Project schema 11. Open pull requests #943, #950, #959, #960 and #963 also move the schema to 11
  for their own fields; whichever lands second takes 12.
- One shortcut is added: `Alt+D`. It was free.
- The Tools menu's Vector group gains Rubber-Band Outline, Close Path and Reverse Direction, and
  its Image group gains Flatten Image Mask; the Edit menu gains Select Contained, Select Smaller
  Shapes and Delete Duplicates.
- G-code changes only when a user runs Sort cuts last, changes output for all operations, or edits
  artwork with these tools. No output snapshot changes.

### Verification

- `src/core/text/text-on-path-alignment.test.ts`: start, middle and end along a 100 mm guide, the
  three across placements, offsets from each end, and text too long for its offset.
- `src/core/geometry/rubber-band-outline.test.ts`, `shape-containment.test.ts`,
  `duplicate-shapes.test.ts` and `path-direction-edits.test.ts`: hull points, world transforms,
  images, no-area refusals, concave and straddling containers, rotated sizes, start-point and
  direction-independent duplicates, the 0.001 mm grid, protected keepers, curve and polyline
  closing and reversal, cubic control points and unpaired paths.
- `src/ui/state/design-tools-actions.test.ts`, `path-cleanup-actions.test.ts` and
  `src/ui/commands/image-command-actions.test.ts`: every store action's selection, undo step and
  notice, and the Flatten command's three outcomes.
- `src/core/numeric-expression.test.ts` and `src/ui/commands/NumericEditsBar.test.tsx`: grammar,
  units, percentages, functions, messages, snap-back and nudging.
- `src/core/sort-cuts-last.test.ts`, `src/ui/state/operation-list-actions.test.ts` and
  `src/ui/layers/OperationListTools.test.tsx`: operation and Run order, effective settings, the
  registration jig, CNC, undo steps and the menu.
- `src/io/project/project-path-text.test.ts` and `migrations.test.ts`: alignment round trip,
  invalid values refused, and the 10 to 11 step.
- `src/ui/app/editing-tool-shortcuts.test.ts` and `AppMenuBar.control-audit.test.tsx`: `Alt+D` and
  every new menu entry.
