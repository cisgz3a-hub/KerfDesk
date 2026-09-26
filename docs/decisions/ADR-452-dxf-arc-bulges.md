## ADR-452 - DXF export writes curves as circular-arc bulges (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This amends ADR-431 decision 1 (`bulge-rings.ts`) and reuses the ADR-432 arc fitter. It changes DXF
file export only: no scene, compile, G-code, Frame or Start path reads the new code, and the laser
arc fit's own budget is unchanged, so the Frame-first contract (PROJECT.md non-negotiable 21, ADRs
228, 230, 232 and 237) is untouched.

### Context

Tracer gap audit (2026-09-26), "DXF export turns curves into chords". ADR-431's DXF writer turned
every cubic into LWPOLYLINE chords by midpoint subdivision at 0.01 mm, and every elliptical arc into
chords by the shared flattener; only lines and circular arcs were exact. Potrace 1.16's DXF backend
is documented to write circular arcs, and CAD users expect true arcs: chords make large files, show
as facets, and lose the curve when offset or edited.

The ADR-432 fitter (`core/geometry/arc-fit`) already fits canonical subpaths with lines and circular
arcs under an exact two-sided check, but its budget deducts the sag of the chords a GRBL controller
cuts each arc into (0.002 to 0.008 mm), which a CAD file does not have.

### Decision

1. **Exact-arc budget in the fitter.** `fitArcMoves` takes an optional `{ exactArcs: true }`.
   The deviation bound becomes `ArcFitTolerance = number | { toleranceMm, exactArcs: true }`, a
   type-only widening through `fit-runs.ts` and `biarc.ts`; `primitiveFitsPiece` resolves it and
   deducts `controllerChordSagMm` only for the plain number, so every existing laser caller fits
   exactly as before. The source sampling (0.001 mm) and rounding (0.002 mm) reserves stay; the
   rounding reserve covers the DXF's default 0.001 mm grid (a grid move of at most 7.1e-4 mm per end
   moves a fixed-bulge arc of at most 180 degrees by at most about 1.42 times that).
2. **Bulge edges** (`core/vector-export/bulge-arc-fit.ts`, new). Each run of consecutive cubics and
   non-circular elliptical arcs is fitted with `fitArcMoves` (identity placement, the writer's
   tolerance, exact arcs). A fitted line is a zero-bulge edge; a fitted arc is
   `(clockwise ? 1 : -1) * tan(sweep / 4)` in the scene's Y-down frame, which is the Y-up DXF sign
   (mirroring the numbers keeps the visible turn: a ring clockwise on screen is clockwise in the
   DXF, so its bulges are negative). The fitter caps each arc at 179 degrees, so every fitted bulge
   is inside (-1, 1); it keeps every corner and the run's end at their exact positions. An ellipse,
   including a circle under a non-uniform scale (ADR-431's affine images turn it into an elliptical
   arc), is never written as one circle: its arcs are fitted like any curve.
3. **`bulge-rings.ts`** keeps lines as zero-bulge vertices and circular arcs as their exact bulge,
   now split into equal parts of at most a half circle (|bulge| <= 1) when the arc sweeps more,
   and hands every curved run to the fitter. Ring closure, the closed flag, per-colour layers and
   fill-rule semantics are unchanged (the writer emits rings as before). A tolerance under the
   fitter's 0.001 mm source sampling is raised to it.

Clean room (ADR-120/123): no Potrace source was opened; only its documented DXF behaviour.

### Consequences

- Measured on the tracer test images (1254 x 1254 px at 0.1 mm per pixel, as ADR-431), 0.01 mm
  tolerance, default 0.001 mm grid, measured by a harness outside the repo:

  | Image / preset | Cubics / lines traced | Chord vertices | Arc vertices (bulges) | Chord bytes | Arc bytes | Worst distance (mm) | Write (ms) |
  |---|---|---|---|---|---|---|---|
  | owl / Line Art | 17,285 / 165,571 | 230,206 | 206,670 (14,102) | 5,751,687 | 5,549,521 | 0.00789 | 1,484 |
  | owl / Smooth | 16,736 / 112,562 | 178,344 | 154,299 (14,344) | 4,589,540 | 4,382,500 | 0.00781 | 1,591 |
  | hummingbird / Smooth | 12,468 / 85,647 | 133,730 | 116,014 (9,966) | 3,455,333 | 3,290,887 | 0.00779 | 1,068 |
  | hummingbird / Line Art | 0 / 177,949 | 177,949 | 177,949 (0) | 4,373,218 | 4,373,218 | 0 | 672 |

  "Chord" is ADR-431's writer on the same geometry (its 0.01 mm midpoint subdivision, written
  through the unchanged line path); the worst distance is the two-sided distance between each ring's
  exactly sampled bulges and its densely flattened source, over every ring. The saving is in the
  curved runs only: 23,536 / 24,045 / 17,716 fewer vertices, where the chord writer spent on average
  3.7 to 3.9 vertices per cubic (13,317 / 13,691 / 9,516 of which remain, about 0.8 per cubic, one
  in seven or more of them a line). The traced output is dominated by straight segments, which stay
  one vertex each, so the whole file shrinks 10 to 13% in vertices and 3.5 to 5% in bytes (each arc
  vertex carries a 15-decimal group 42). Hummingbird Line Art traces to lines only and writes the
  same bytes as before.

- Tests: `bulge-arc-fit.test.ts` bounds the two-sided distance between the exactly sampled bulges
  and the true curve by 0.01 mm on cubic circles of both orientations and 400 mm radius, a rotated
  ellipse of elliptical arcs, a circle under shear and non-uniform scale, an S-curve, 0.2 mm and
  0.03 mm circles, a near-straight cubic, a cusp and curves meeting lines at corners; checks the
  vertex count against 0.01 mm chords, bulge signs for both ring orientations, exact corners and
  the half-circle split. `io/dxf/dxf-arc-bulges.test.ts` reads the written text back: group 42
  values are plain decimals, signed with the ring and under 1 in magnitude; the sampled polylines
  stay within 0.01 mm of the source after the grid; the fitted arcs round-trip through `parseDxf`;
  and straight-line input writes a file whose SHA-256 equals the chord writer's at `952fb13e3`.
- Not verified here: opening the files in AutoCAD, LibreCAD or another CAD/CAM program.
- A coarser `precisionMm` (0.01 or 0.1 mm) moves arcs by its own grid error beyond the fit, as it
  already moved chords under ADR-431.
