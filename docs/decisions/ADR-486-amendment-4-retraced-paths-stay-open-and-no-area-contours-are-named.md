## ADR-486 Amendment 4 - Retraced paths stay open, and the kerf names contours with no area (2026-11-14)

**Status:** Accepted; software-verified through unit and decoded-G-code tests, no material cut. |
**Date:** 2026-11-14

Amends ADR-486 decision 2 and Amendment 1 (what the kerf offset reports). It also amends how three
tools close paths: Join paths and the shared endpoint pairing (ADR-350 §3, ADR-626 Amendment 8 for
DXF import), and Close Path / Close Paths with Tolerance (ADR-480). Advisory only: nothing here
refuses Frame, Start or export (rule 7, non-negotiable 21).

### Context

Tools audit T1 (2026-11-13) raised T30-P1-2, which the refuter confirmed and re-graded to P2, and
T30R-P2-1 (P2).

1. **The loss.** A line drawn twice, or a path that runs out and back over itself, became a closed
   contour that encloses no area. The tools that did it were:
   - Join paths, which closed any chain with no free end, whatever it enclosed;
   - DXF import, which uses the same pairing for touching pieces and its own "ends meet" rule for one
     entity;
   - Close Path and Close Paths with Tolerance.
2. **Why it vanished.** Kerf Offset reads a layer's closed contours by the even-odd rule before it
   offsets them (`kerf-offset.ts`). That reading has no region for a loop with no inside, so it
   dropped the cut at any non-zero offset, even 0.001 mm. The canvas still showed the line.
   Before the edit, the same geometry burned 60 mm (the 30 mm line twice). After it, the burn was
   0 mm.
3. **When nobody was told.** Job Review warned only when the dropped contour sat on the shrinking
   side: "closed up 1 hole or slot narrower than the kerf", for example a slit inside a part with a
   positive offset. On the growing side the loss was silent. Examples:
   - a standalone doubled DXF LINE on a +0.1 mm operation;
   - a slit inside a part with a negative offset.

### What LightBurn does

LightBurn's documentation does not cover duplicate or zero-area shapes in any of these tools.
- Auto-Join joins segments whose nodes lie within 0.05 mm.
- Close Path closes a shape "connected except for its start and end nodes".
- Kerf Offset "only works with shapes that are closed".
- Doubled geometry has its own tools:
  - Delete Duplicates removes objects identical in size, shape and position. Its page says
    duplicates add extra passes in Line mode.
  - Optimization's Remove overlapping lines drops shared lines at send time.

So a doubled line is two lines, not a closed shape. KerfDesk has both tools (ADR-480, ADR-499), and
keeps their behaviour.

### Decision

1. **One test for "encloses no area"** (`core/geometry/zero-area-contour.ts`). A closed ring encloses
   no area when the kerf's own even-odd normalisation, on its 1 µm grid, returns nothing for it. A
   ring of fewer than three points encloses none. Most contours never reach the boolean engine,
   because their shoelace area is larger than their perimeter × 1 µm.
   - A figure eight has a signed area of zero, but each lobe still has an inside, so it encloses area
     and stays closed.
   - Curves are flattened at 0.001 mm in world millimetres. An arc between collinear anchors keeps its
     bulge, and a tiny local shape is judged at its placed size.
2. **The shared endpoint pairing does not close such a chain** (`path-endpoint-join.ts`).
   - A component with no free end, whose closed result encloses no area, is left exactly as it was:
     no join and no closure. It is counted as `retraced`.
   - This covers Join paths and DXF import's touching-piece join. It also covers the CNC
     profile-outline join, laser leads' open-gap reading and the open-outline preflight, which all
     use the same pairing.
   - The Join paths dialog says: "1 path runs back over itself, so it stays open: closed, it would
     enclose nothing and Kerf Offset would drop it from the job. For a line drawn twice, use Delete
     Duplicates."
3. **DXF's "ends meet" rule skips them** (`dxf-entities.ts`).
   - An unflagged LWPOLYLINE, POLYLINE or SPLINE whose ends meet is no longer closed when it runs out
     and back over itself.
   - A bulged run is judged closed as before, because its anchors do not show its arcs.
   - A contour the file itself flags closed stays as authored. The kerf warning in decision 5 covers
     it.
4. **Close Path and Close Paths with Tolerance skip them** (`path-direction-edits.ts`,
   `close-within-tolerance.ts`).
   - Both modes of Close Paths with Tolerance skip them too.
   - The toast adds the same sentence as the Join dialog, or gives it alone when nothing else was
     closed.
   - Fill's open-contour repair (`close-open-fill-contours-actions.ts`) passes its own predicate and
     is unchanged. Fill burns nothing inside such a contour either way.
5. **The kerf stage names what it drops, on both sides** (`layer-kerf.ts`).
   - When the offset is non-zero, every closed source contour that encloses no area is counted.
   - It is taken out of Amendment 1's closed-up count, so it is never reported as a hole narrower than
     the kerf.
   - The compile adds `kerf-offset-no-area` with the layer name and count, merged per layer like
     `kerf-offset-closed-up`.
   - Job Review says: "Kerf offset on layer "Cut" dropped 1 closed path that encloses no area, such
     as a line drawn twice or a path that runs out and back over itself, so it is missing from the
     job and will NOT be cut. Check the preview before running. Break it open at a node in the node
     editor, remove a second copy with Delete Duplicates, or set Kerf Offset to 0."
6. **Nothing else moves.**
   - The G-code changes only where a retraced path used to be closed. It now stays open and burns as
     drawn, because open paths are not kerf-offset.
   - The kerf offset itself is unchanged. A loop with no area still burns nothing at a non-zero
     offset, but it is now named.

### Limits

- A contour that encloses area only in part keeps that part, and the rest is dropped without a
  count. An example is a retraced stick with a loop at its end. **Replaced by
  [Amendment 5](ADR-486-amendment-5-kerf-names-line-it-drops-from-a-contour.md):** the dropped
  line is now counted and named in Job Review.
- A loop traced twice over one region has winding number 2 everywhere. It encloses nothing under
  even-odd, but its shoelace area is large, so the fast check passes it and it is not counted. No tool
  makes one.
- Closed contours of one path that cancel each other, such as two identical squares in one compound
  path, are a separate case. They are not counted here.
- A doubled line within the join gap but not coincident (for example 0.03 mm apart) still closes into
  a thin loop with area. With a growing offset it burns as a ring. With a shrinking offset
  Amendment 1 reports it.
- The Join paths toast (`vector-repair-actions.ts`) does not yet repeat the dialog's sentence.
- Code and test evidence only. No material was cut.

### Tests

- `src/ui/state/retraced-paths-kerf.test.ts` reads every result back from the emitted G-code with
  its own decoder (`retraced-paths.test-support.ts`):
  - **Join paths.** A slit drawn twice (both ways) and an out-and-back path inside a frame, at kerf
    +0.1, −0.1 and +0.001, still burn 60 mm after Join.
  - **DXF import.** Two coincident LINEs (both ways) and an out-and-back LWPOLYLINE import open and
    burn at ±0.1. A bulged out-and-back LWPOLYLINE (a circle) still closes.
  - **Close Path.** Close Path and both Close Paths with Tolerance modes leave the path open, say
    why, and keep the 60 mm burn.
  - **Kerf warning.** A closed contour with no area, standalone or inside a part at ±0.1, is named
    in Job Review and not reported as closed up. Without a kerf it burns and nothing is said. A
    0.05 mm slot is still reported as closed up.
- `src/core/geometry/zero-area-contour.test.ts` covers:
  - the area test: out-and-back, two points, square, 0.05 mm slot and figure eight;
  - the pairing: a doubled line both ways, an out-and-back path, and a cubic with its exact reverse
    all stay open, while a four-line frame still closes.
- 27 of these 32 tests fail on main.
