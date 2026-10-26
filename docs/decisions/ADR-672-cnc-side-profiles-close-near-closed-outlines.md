## ADR-672 - CNC Outside and Inside profiles close near-closed outlines and name the open paths they cut on the line

**Status:** Accepted; software-verified through emitted G-code and the real Job Review model,
hardware qualification pending. | **Date:** 2026-10-26

Fixes meta audit v1 M6-P1-2 (`docs/audits/2026-10-23-meta-v1/M6-meta-clean-and-refuted.md`), which
an independent refuter and the coordinator confirmed on main `adf300522`. It changes emitted motion
in one case: an outline drawn as open paths whose ends meet within 0.5 mm, on an Outside or Inside
profile. The new Job Review lines are advisory and never refuse Frame, Start or Save (ADR-565).

### Context

Only a closed shape has an outside and an inside, so `profileToolpathPolylines` offsets closed
contours and cuts every open one on its line. An outline that is open by a hair therefore came out
one cut width off size. With the shipped 1/8" end mill:

- A 40 × 30 mm rectangle drawn as an SVG path ending 0.05 mm (or 0.001 mm) short of its start, on
  a Profile Outside layer, was cut at X 10 to 50, the drawn line. Closed, it is cut at X 8.413 to
  51.588. The part came out 3.175 mm small in X and in Y.
- The same rectangle as four DXF LINEs whose last corner misses by 0.01 or 0.2 mm was cut on its
  line too. (Exactly touching LINEs have been joined on import since ADR-626 Amendment 8.)
- On a Profile Inside layer the hole came out 3.175 mm too large.
- `prepareOutput` advisories and `runCncPreflight` were empty. Job Review said nothing for an Inside
  profile or for a gap at least as wide as the bit. For a narrower gap on an Outside profile it gave
  only ADR-433's "1 gap … stays uncut" line, which describes a sliver, not a part one cut width small.

CNC audit v1 F3 had dropped this as a documented WORKFLOW fallback, and `profile-paths.ts` said
open paths are cut on the line "matching Easel". The audit found no Easel documentation for that.
An Easel forum thread quotes Easel asking the user to join open paths before import. The laser twin
(`line-open-outline`, ADR-626 Amendment 8) already warns, and its comment said CNC did too, which
was true only for the closed-only cut types (V-carve, Pocket, Drill).

### Decision

1. **Near-closed outlines are closed** (`core/cnc/cnc-profile-outline-join.ts`). On a Profile
   Outside or Profile Inside layer, the open paths of one artwork whose ends each meet exactly one
   other end within 0.5 mm, closing a loop, are joined into one closed contour. This uses the
   pairing rule of Join paths (`joinCurveEndpointsWithin`, ADR-350): a T-junction or three ends at
   one point stays apart.
   - 0.5 mm is the gap ADR-626 Amendment 8 reads as an outline and the gap Fill offers to close
     (`OPEN_OUTLINE_GAP_MM`).
   - Every bit already sweeps a gap that narrow, so the closing step adds no cut the bit would not
     make anyway. It changes which side the cut lies on.
   - The join runs in `collectLayerContours`, so compile, the ADR-433 check, the job's kept walls
     (ADR-250 Amendment 3) and the layer note all read the same contours.
   - A joined contour keeps its first piece's artwork and the manual tab anchors of all its pieces.
   - Chains that do not close are left as drawn: joining them would only bridge gaps along a path
     that is still cut on its line.
   - On path, Engrave and every other cut type are unchanged.
2. **Job Review names what was closed** (`cnc-profile-outline-closed`). Example: `Layer "Cut": 1
   outline is drawn as open paths whose ends meet within 0.5 mm; it is closed and cut outside its
   line as a closed shape.`
3. **Job Review warns about what is still cut on the line** (`cnc-profile-open-path-on-line`). It
   gives the count, the side, and the size error at the operation's cut width at full depth (the
   width the offset would have moved the cut by). Example: `Layer "Cut": 1 open path is cut on its
   line, not outside it: only a closed shape has an outside. A part it outlines comes out 3.17 mm
   smaller than drawn (one cut width). Close the outline with Tools > Join paths, or choose On path
   for this layer.` An Inside layer says a hole comes out larger.
4. **The evidence travels with the Job.** Compile records per-layer counts and the cut width in
   `CncCompilationSidecar.profileOpenPaths`. Preflight reads them from the exact compiled Job, as
   `cnc-open-contours-omitted` does, so fresh and archived review agree. A derived recovery Job keeps
   the entries of the layers it still cuts.
5. **The layer card says it at design time.** `CncOpenPathNote` now also shows on an Outside or
   Inside layer that holds open paths, counted after the join.
6. `EMITTER_REVISION` advances to `cnc-profile-closes-open-outlines-20261026-v31`. v30 is taken by
   PR #1440; if that PR has not merged first, the one that merges second renumbers.

Not chosen:

- **Refusing the job.** An open path cut on its line is still a truthful program. ADR-565 keeps
  policy findings as warnings.
- **Offsetting open paths to a side, as Vectric is said to do for open vectors.** F3 reported this
  for Vectric, but it was not re-checked against Vectric's documentation. Which side of an open path
  is "outside" depends on its direction, which imported artwork does not choose on purpose.
- **Joining across artworks.** A joined contour must keep one owner for the fresh-trace check and
  the omitted-artwork selection. Outlines split across artworks are left to Tools > Join paths, and
  the warning names them.

### Consequences

- A near-closed outline on an Outside or Inside layer comes out its drawn size, where before it was
  one cut width off. The ADR-433 sliver line for that gap disappears, because the gap is closed.
- Any open path still cut on its line on such a layer draws a warning that says how far off size its
  part or hole comes out. An open line that outlines nothing (a single stroke) draws the same
  warning, since the check cannot tell a stroke from a broken outline.
- Jobs without open paths on Outside or Inside layers emit the same bytes.

### Verification

- `src/io/gcode/emit-gcode-cnc-profile-open-outlines.test.ts` imports real SVG and DXF artwork,
  emits G-code through `emitGcode` and reads back the cut's X extent:
  - An SVG outline open by 0.05 mm is cut at X 8.41 to 51.59 on Outside, the same as the closed
    control, and at 11.59 to 48.41 on Inside.
  - DXF plates whose corner misses by 0.01, 0.2 and 0.45 mm are cut 43.175 mm wide (40 mm plus the
    cut width).
  - A 1 mm gap on Outside and a 2 mm DXF gap on Inside are cut on the line and draw the size
    warning, worded for one path and for two.
  - On path and a lone open line are unchanged.
- `src/ui/laser/job-review/cnc-part-size-review.test.ts` runs `prepareCurrentStartJob` and
  `buildJobReviewModel`. The 0.05 mm outline shows the closed-outline line and no ADR-433 gap line.
  A 5 mm gap shows the "3.17 mm smaller" warning.
- `src/ui/layers/CncOpenPathNote.test.tsx`: an Outside and an Inside layer with an open path show
  the note, and the same layer with the path closed shows none.
- No hardware run was made.
