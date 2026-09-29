## ADR-494 Amendment 1 - Tabs stay put through path commands, and inner shapes are found without testing every pair (2026-09-29)

**Status:** Accepted; software-verified through unit tests. | **Date:** 2026-09-29

Amends ADR-494 item 4 ("Move, rotate, scale, copy and paste, break apart, recolour, path join and
text re-edits carry them as they carry `cncTabAnchors`"), which did not name the path commands of
ADR-480, and the automatic rule of item 2 ("a closed contour the automatic rule picks"), whose
"skip inner shapes" test ran on every pair of contours. Output changes only where a command below
used to move tabs placed by hand or lose a corner; the automatic rule decides exactly as before.
No project schema change, no new guard or refusal (ADR-228).

### Context

A tab placed by hand, laser (`laserTabAnchors`) or CNC (`cncTabAnchors`), is stored as a fraction
`pathT` of one source contour's length, measured from that contour's start in the artwork's own
coordinates (ADR-156). Any command that changes where a contour starts, which way it runs, or
which object carries it must keep each tab at the same physical place, or deliberately handle it.
The 2026-09-28 weakness audit (finding E-3) found commands that did neither.

- **Delete Duplicates** (ADR-480 item 5) compared placed CNC tabs but not placed laser tabs, so a
  copy carrying laser tabs matched an untabbed copy and could be the one deleted, and two copies
  with the same fractions on contours that start at different corners, which put the tabs at
  different places, counted as one.
- **Reverse Direction** (ADR-480 item 6) moved CNC tabs with the reversed contour (`t` becomes
  `1 − t`) but left laser tabs at their old fraction, so each laser tab landed somewhere else on
  the part: a tab 12 mm along the bottom edge of a 40 × 20 mm part moved about 17 mm.
- **Start** and **Break** in the Edit nodes toolbar redraw a closed contour from the selected
  node but left every placed tab, laser and CNC, at its old fraction, so each tab moved round the
  part by the node's share of the outline: after Start at the third corner of a 40 × 20 mm part, a
  tab 12 mm along the bottom edge landed on the top edge. On a contour closed by an implied
  straight line (a closed DXF spline, or a closed polyline without its start repeated), the same
  two commands also lost a corner: Start at the third corner of a rectangle cut a diagonal in
  place of the first corner, and Break at the start dropped the last corner.
- **Skip inner shapes** (finding E-7). With it on, a closed contour takes automatic Line tabs only
  when it lies strictly inside an even number of the layer's other closed contours, so parts take
  tabs and their holes do not. Each contour was tested against every other one, so the exact
  containment test ran n × (n − 1) times: 8,997,000 times, about 15 to 20 s, for a sheet of 3000
  parts on one layer.

### Decision

1. **Delete Duplicates.** Two objects are duplicates only when they cut the same thing, placed
   tabs included. Laser tabs join the comparison exactly as CNC tabs did: objects whose
   `laserTabAnchors` differ are kept, and an object carrying placed laser tabs is compared with
   its authored transform, contour order, start point and direction, as ADR-480 item 5 already did
   for CNC tabs. Laser and CNC tabs at the same fractions are different output and are kept apart.
   When a copy is deleted, the kept copy has the same tabs at the same places.
2. **Reverse Direction.** Laser tabs follow each reversed contour exactly as CNC tabs do: `t`
   becomes `1 − t` (0, the start, stays 0), and anchors on contours the command leaves unchanged
   keep their fraction.
3. **Start and Break (Edit nodes).** Start moves each placed tab on the restarted contour, laser
   and CNC, back by the new start's fraction `f` of that contour (`t` becomes `t − f`, wrapped into
   0 to 1), measured on the same flattened outline that places the tabs, so every tab stays where
   it was. Tabs on other contours keep their fraction. Break re-measures the tabs of its contour
   from the break node in the same way. An open contour holds no placed tab (ADR-494 tabs are for
   closed shapes), so while it is open its tabs do nothing; they are kept, and closing the contour
   again with the straight line Break removed (for example with **Close Path**) puts every tab
   back at its place. A contour closed by an implied straight line keeps that line as a
   segment when it is restarted or broken, so no corner is lost.
4. **Inner shapes in one pass.** The rule is unchanged: a closed contour of at least three distinct
   points takes automatic tabs when it lies strictly inside an even number of the layer's other
   such contours. The layer's contours go into a box index (`ContourBoxIndex`, which tracing and
   CNC nesting already use), and the exact test, moved unchanged to `tab-contour-containment.ts`,
   runs only on pairs where one contour's box holds the other's (`tab-inner-shapes.ts`). A contour
   strictly inside another passes the even-odd test at every vertex, which keeps its box inside the
   other's box up to the rounding of one crossing, about 1e-15 of the largest coordinate. Boxes
   grow by 1e-9 of the largest coordinate (at least 1e-9 mm), so no pair the exact test would
   accept is skipped. A layer with a coordinate that is not a finite number, or larger than 1e150,
   tests every pair as before.

### Consequences

- Delete Duplicates deletes fewer objects only where copies differ in placed laser tabs, or where
  tabbed copies start or run differently.
- Reverse Direction changes only the cutting direction of a tabbed part; its laser tabs stay put.
- Start changes only where a tabbed contour starts; its laser and CNC tabs stay put. This changes
  CNC output as well as laser output: CNC tabs placed by hand no longer move when the start does.
- Start and Break keep every corner of a contour closed by an implied line, on laser and CNC
  artwork alike; contours whose last segment returns to the start are unchanged.
- Skip inner shapes gives the same answer as before for every layout, and the tab output is
  unchanged. A sheet of 3000 separate parts runs the exact test no times instead of 8,997,000 and
  decides in well under a second; a part with a hole runs it once. Layouts of deeply nested
  contours still test every nested pair, since each one counts. CNC tabs, which never skip inner
  shapes, are unaffected.

### Verification

- `src/core/geometry/duplicate-shapes.test.ts`: a tabbed and an untabbed copy are both kept in
  either order and burn different outlines; copies whose start point or authored scale moves the
  same fraction are kept while a true copy, which burns the same outline, is deleted; laser and
  CNC tabs at the same fraction are kept apart.
- `src/ui/state/path-cleanup-actions.test.ts`: after Reverse Direction every laser and CNC tab is
  at its old place, a tab at the start keeps 0, and a path the command skips keeps its fractions.
- `src/ui/state/path-node-curve-command-tabs.test.ts`: after Start on a polyline part, a curved
  part and a part closed by an implied line, every laser and CNC tab is at its old place (rotated,
  scaled and moved artwork) and a hole's tabs keep their fractions; after Break the open contour
  has no tab, and after Close Path every tab is back at its old place.
- `src/core/cnc/cnc-tab-anchors.test.ts`: the node fraction on straight and implied closing lines,
  through a contour that passes back through its start, and the wrap of the moved fractions.
- `src/core/scene/curve-edit.test.ts`: Start and Break keep every corner of a rectangle closed by
  an implied line.
- `src/core/geometry/tab-inner-shapes.test.ts`: the one-pass rule and the tab output equal a frozen
  copy of the every-pair rule (`tab-inner-shapes.test-support.ts`) on nested sheets (parts, holes,
  islands and holes in islands), shapes whose boxes touch, match or share edges, concave, crossing
  and self-crossing shapes, open and degenerate contours, far and tiny shapes, shapes too large for
  the index, points that are not numbers and two random layouts of 400 shapes. Counting the exact
  test: none for 3000 separate parts or 3000 squares sharing edges, and 1500 for 1500 parts with a
  hole each, where the every-pair rule ran it 8,997,000 times.
