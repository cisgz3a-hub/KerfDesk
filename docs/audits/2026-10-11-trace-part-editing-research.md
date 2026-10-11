# Editing individual parts after tracing

Research checked on 11 October 2026 against the official documentation below.
This is a feature comparison and implementation rationale, not a claim that the
competitors were tested locally or that KerfDesk has complete feature parity.

## What other applications provide

| Application | Editing the trace in pieces | Related tools worth carrying into the workflow |
| --- | --- | --- |
| LightBurn | Trace Image produces a group of vectors. Ungroup makes the shapes individually editable. | Edit Nodes moves nodes and handles, inserts or deletes nodes, breaks a path at a node, deletes segments, converts lines and curves, and trims or extends to intersections. Snapping and constrained movement help with precise changes. Its Break Apart command separates every line/curve segment, which is different from ungrouping a traced image. |
| Adobe Illustrator | Expand turns a trace into grouped editable paths. Isolation mode edits inside that group; Ungroup exposes individual paths. | Direct Selection moves or reshapes selected anchors and path segments, including multi-selection. Simplify removes excess anchors; Live Paint enables colouring the resulting regions. Expansion ends editing of the original trace settings. |
| Inkscape | Trace Bitmap creates editable paths. Multi-scan results can be ungrouped. Split Path separates disconnected portions while keeping holes with their surrounding shapes. | The Node tool moves nodes and handles and reshapes a segment by dragging it. Break Apart instead separates every subpath, including hole boundaries. Inkscape's 1.4.3 notes record a further correction for nested holes in Split Path. |

Sources for the LightBurn row: [Trace Image](https://docs.lightburnsoftware.com/2.2/Reference/TraceImage/),
[Edit Nodes](https://docs.lightburnsoftware.com/2.2/Reference/EditNodes/), and
[Break Apart](https://docs.lightburnsoftware.com/latest/Reference/BreakApart/).

Sources for the Illustrator row: [Edit image trace results](https://helpx.adobe.com/uk/illustrator/desktop/manage-objects/traces-mockups-symbols/edit-image-trace-results.html)
and [Direct Selection](https://helpx.adobe.com/illustrator/using/tool-techniques/direct-selection-tool.html).
Adobe also documents [compound paths and fill rules](https://helpx.adobe.com/au/illustrator/desktop/manage-objects/reshape-transform-objects/create-compound-paths.html):
their component geometry can be edited separately while fills and holes remain
part of the compound object's appearance.

Sources for the Inkscape row: [Tracing an Image](https://inkscape-manuals.readthedocs.io/en/latest/tracing-an-image.html),
[Editing Paths with the Node Tool](https://inkscape-manuals.readthedocs.io/en/latest/editing-paths.html),
[1.2 release notes, Path Operations](https://wiki.inkscape.org/wiki/Release_notes/1.2#Path_Operations),
and [1.4.3 release notes, Path Operations](https://wiki.inkscape.org/wiki/Release_notes/1.4.3#Path_Operations).

## KerfDesk design

KerfDesk already documents hole-preserving trace Break Apart in
[ADR-406](../decisions/ADR-406-break-apart-splits-a-trace-into-shapes.md) and carried
trace nesting in
[ADR-531](../decisions/ADR-531-traced-paths-carry-their-nesting.md).
ADR-406 records that one dense trace can become thousands of scene objects, and
explicitly leaves that resulting store/canvas cost unmeasured. The new workflow
should make direct editing discoverable without requiring that whole-scene
expansion first.

The intended interaction is an **Edit trace parts** tool that remains active
while the user works through the image:

1. Click the required traced shape or stroke to select it independently.
2. Separate only that part from its original trace when needed, leaving the
   remaining trace together. A filled shape carries its holes; a centreline
   stroke is its own part. An island inside a hole remains a separate shape.
3. Use the existing move, nudge, resize, rotate, duplicate and delete actions on
   the selected part. Use existing node editing to reshape its geometry.
4. Keep extraction and subsequent edits undoable. Preserve placement, curves,
   path appearance, operation bindings and relevant tab anchors as parts are
   separated. Prevent a separated part from re-tracing the original whole image
   as though it were still the intact trace.

This takes direct access to artwork parts from the comparison and uses the
existing scene-object editing tools. It is a KerfDesk implementation choice,
not a documented claim about competitors' internal storage or performance.
Keeping the remainder in one object avoids immediately adding one scene object
for every shape in a large trace; responsive picking and retained geometry still
need implementation tests and browser verification.

## Scope and acceptance boundaries

- A part means a disconnected filled shape with its holes, or a traced stroke.
  It does not mean a recognised person, tree or other semantic region in the
  source photograph. Features touching in one contour remain connected.
- Moving an arbitrary section of one connected contour uses node editing.
  Cutting that contour into separately movable objects is a distinct operation;
  competitor trim, extend, join and segment-break tools are research findings,
  not new capabilities promised by this change.
- A thick raster line often traces into a closed outline with inner and outer
  edges. Moving that line should keep those edges together. Selecting one edge
  for reshaping belongs in node editing.
- Validate filled rings, nested islands, centreline strokes, transformed traces,
  overlapping candidates, operation metadata, undo/redo and save/reload. A dense
  synthetic trace should demonstrate that picking one part creates only the
  selected part and its remainder, not thousands of scene objects.
- Extraction must not silently change the traced geometry. Verify actual output
  coverage where separating overlapping colour paths or operation assignments
  might alter fill behaviour; this research does not establish output parity.
- No hardware, air-cut, material, release or deployment qualification follows
  from the research or software checks.

## Browser verification

The two cases in [trace-part-editing.e2e.ts](../../e2e/trace-part-editing.e2e.ts)
passed against the development renderer on 11 October 2026. The first imports
and traces a generated bitmap, moves only its ring while keeping the hole,
exercises undo/redo, Shift selection, nudge, delete/undo and node-coordinate
editing, then saves and reopens the edited project. Save comparisons allow the
format to omit redundant straight curves, while checking equivalent geometry
and the complete object/path metadata.

The dense case imports and traces a 1808 by 1808 pixel bitmap containing 4096
rings and 8192 contours. Picking and moving one ring leaves two scene objects:
the ring's two contours and a remainder of 8190 contours. Canonical curve
fingerprints match before and after separation; only the picked object's
placement changes. This proves selective extraction and geometry retention for
that fixture, not a general frame-rate or latency guarantee. The final replay,
after the high-zoom curve-picking correction, passed both cases in 1.5 minutes.
The observed trace flow took 6.60 seconds and the first pick, six-step drag and
completion snapshot took 3.71 seconds on the busy development machine. Those
wall times include browser automation and inspection overhead.

Local artifacts for this final replay are under
`C:/Users/Asus/AppData/Local/Temp/kerfdesk-trace-parts-e2e-verified/`:

- `trace-part-editing.e2e.ts--6de63-nd-saves-the-edited-artwork/moved-trace-part.png`
- `trace-part-editing.e2e.ts--ff2f1-thout-expanding-every-shape/dense-trace-one-moved-part.png`
- `trace-part-editing.e2e.ts--ff2f1-thout-expanding-every-shape/dense-trace-measurements.json`
