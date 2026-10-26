## ADR-359 Amendment 3 - CNC cuts an exact stacked copy once and says so (2026-10-26)

**Status:** Accepted. | **Date:** 2026-10-26

### Context

Item 5 warns when copies of one artwork stack on laser output. It returns early for CNC, and it
compares only raster and traced images, so it never sees two vector outlines.

On CNC a stacked copy is worse than a double burn. Duplicate without moving, a second import of
the same file, or an SVG that draws one path twice leaves two identical closed outlines on one
operation. The profile, pocket, V-carve and inlay planners fill closed outlines even-odd
(`kerf-offset.ts` and the region builders), so the identical pair encloses nothing. The shape is
not cut at all. Job Review stays silent, and the part stays in the sheet.

The 2026-09-29 CNC pass recorded this as P2-toolpath-3. No later round tracked it, and meta audit
v1 confirmed it as M7-P2-2 on `adf300522`. Measured against the compiler with a 10 mm closed
square, a stacked copy and a control square:

| Cut type | Stacked pair | One copy |
| --- | --- | --- |
| Profile outside, profile inside, pocket, V-carve (90° V-bit), inlay pair | no motion | cut |
| On path, engrave, drill | cut twice | cut once |

The result was the same with two objects and with one SVG path drawn twice.

### Decision

1. **Merge on filled cuts.** On profile outside, profile inside, pocket, V-carve and inlay pair,
   exact copies of a closed outline are merged before any planner reads the operation's contours
   (`src/core/cnc/cnc-stacked-copies.ts`, called from `collectLayerContours`). The compile,
   compilation artifact, lead walls and narrow-feature check therefore all see one copy, as the
   cut does. The first copy is kept and takes over the manual tabs of the copies it absorbs.
2. **What counts as exact.** Copies trace the same closed ring at the emitter's 0.001 mm
   resolution, so they would emit the same G-code. Like Delete Duplicates (ADR-480), a copy may
   start at another vertex or run the other way. Two nonzero (converted font) contours must also
   run the same way, as Delete Duplicates holds. Open paths and near copies are not merged.
3. **Keep every copy where it is cut again.** On path, engrave and drill follow the outline itself
   and cut the copy a second time. A stacked copy there can be a deliberate spring pass, so those
   operations keep every copy.
4. **Say so.** Each operation that merged copies records the count in the compile sidecar
   (`mergedStackedCopies`). Job Review reads the count from the exact compiled Job, archived
   recovery included (`cnc-stacked-copies-merged`). The message says how many copies are cut once
   and why, as a warning, never a block (AGENTS.md).

### Consequences

- A stacked closed shape on a filled CNC cut is now cut once, exactly as a single copy is, where
  before it was silently left uncut. Three or more copies, which even-odd already cut once, now
  give the same toolpath and also get the note.
- Laser output is unchanged. Item 5's raster and trace warning still returns early for CNC.
- ADR-576's angle check reads the same pool, so it still sees what the medial planner carves. A
  stacked pair on V-carve with an angleless V-bit used to cancel, so the bit was unused and not
  refused. The pair is now carved, so that bit is refused.
- Near copies (offset by more than 0.001 mm) still overlap even-odd, and nothing warns about them.
  Merging them would change geometry the operator drew. That stays a follow-up.
- Code evidence only (`cnc-stacked-copies.test.ts`); not air-cut or material-tested.
