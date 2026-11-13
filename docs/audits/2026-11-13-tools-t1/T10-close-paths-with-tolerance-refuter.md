# T10 Close Paths with Tolerance — refuter report
Tree: origin/main @ 856cb3ae1 (`C:\Users\stolk\kd-t1\t06-main`, read only). Command id: `tools.close-paths-with-tolerance`.
Scratch: `C:\Users\stolk\kd-t1\zz-t10r\` — `t10r.test.ts` (my own script; none of the auditor's scripts were re-run), `vitest.config.mts`, log `t10r.log`. Run from the tree root: `NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config ../zz-t10r/vitest.config.mts --maxWorkers=1` (7 tests pass, about 16 s, free memory 2.7 GB).

My method differs from the auditor's: deviation is a two-way densified (0.05 mm) point-to-polyline distance between the flattened curves before and after. G-code length comes from my own G1 reader (mode-tracking regex, not `zz-t07/decode.ts`). Geometry comes from the app's own producers: `exactHoleCurve` (Part generator holes), `insertCurveNode`/`deleteCurveSegment` (node editor), `optimizeObjectPaths` (Optimize Shapes). It then goes through the real store action `closeSelectedPathsWithTolerance` → `prepareOutput` → `emitPreparedGcode` and its `preflight`.

## Verdicts

### T10-P2-1 — CONFIRMED, P2 stands, but the reach is not what the report says
The mechanism is real and I reproduced it on my own. `meetCurve` (`close-within-tolerance.ts:102-121`) sets `start` and the only segment's `to` to the same point. `endpointArc` (`curve-path.ts:312`) then returns null, and `flattenArc` (`curve-path.ts:196-197`) emits only `[segment.to]`.

- **Single arc 10°→350°, r 20, tol = gap:** curve, compiled and G-code length 118.663 → **0.000**. The compiled polyline has 2 points and the compatibility polyline still holds 125.570. Bridge on the same arc: 125.609, deviation 3.448 ≤ gap/2. The 2°→358° arc behaves the same (124.247 → 0).
- **Store and G-code (test D, tol 8):** toast "Closed 1 path.", G1 length 118.634 → **0.000**, one undo step. The object `bounds` still show the full 40×40 circle.

**How a user gets a single `elliptical-arc` subpath today:**
- **SVG `A` → cubics, confirmed (READ).** `parse-path-d.ts:329` does keep `elliptical-arc`, but every SVG subpath then goes through `transformSvgCurveSubpath`, which turns each arc into `arcToCubics` (`svg-curve-transform.ts:33-58`).
- **DXF ARC, bulge and CIRCLE → cubics, confirmed (READ).** They go through `parametricEllipseCurve` (`dxf-native-curves.ts`). The packed DXF transfer only preserves what the parser made.
- **Optimize Shapes: auditor's route is incomplete.** With the default **Smooth on**, open arcs come out as `c`/`ce`/`cee` or as 2-5 arcs, as the auditor found. With **Smooth off**, which is a checkbox in the dialog, an open arc up to about 150° is fitted as **one** `elliptical-arc` segment, in both fit modes (test C: sweeps 90° and 150° → `e`). From 179° to 350° it gives 2 or more segments (`ee`, `el`, `eel`).
  - Run end to end (F1): an open r 1 mm 150° hook, Optimize Shapes with Smooth off, then move-ends at tol 2. Toast "Closed 1 path.", G1 **2.541 → 0.000**, preflight `empty-output`.
- **Part generator and sketch circles.** Both are two half-circle arcs (`part-generator-geometry.ts:96-120`, `sketch-path-geometry.ts` `circlePath`), on `imported-svg` objects, which `isPathEditable` accepts.
  - Deleting one half with the node editor's `deleteCurveSegment` leaves a single half-circle arc. Run end to end (F3, a 6 mm hole, tol 6): toast "Closed 1 path.", G1 **9.402 → 0.000**.
  - I did not check whether the node editor UI allows editing a generated part. I called the core function directly.
- **Trim, Extend and node splitting.** These keep the arc kind (`trim-curve-split.ts:103`), so they can leave single-arc pieces of the above (READ). Bulged polygons and stars (`bulge-outline.ts`) are closed shapes and not path-editable until converted (READ).
- **No in-app producer found for the auditor's headline case** (one arc sweeping about 350°, gap a few mm, 122 mm lost). Every producer I found splits arcs at or below about 180°, or uses cubics. That case needs a project file with such a segment (the validator accepts one).
- **So collapse needs tolerance ≥ the arc's own chord.** In practice that means short arcs (hooks, small pieces) or large tolerances, not big near-circles.

**Are two-arc near-circles affected?** They do not collapse: only a subpath whose only segment is an arc does. "2 arcs 10..180..350", "3 arcs", node-edited Part holes (`eee`) and every Optimize multi-arc output kept their length. They are not always within gap/2, though: see T10R-P2-1.

**Is it flagged?**
- **Canvas:** it flattens the same curve (`display-polylines.ts` → `flattenColoredPathCurves`), so the arc visibly disappears (READ). The selection box (`bounds`) still shows the old outline.
- **Only cut in the job:** preflight reports `empty-output` with the text "Internal error: G-code generation produced no cuts." That is misleading, because it is not an internal error.
- **Other cuts in the job:** preflight shows nothing (test D with a square: 198.634 → 80.000, no issues).

**Default mode:** "Adding a closing line" (bridge) is the default (`ClosePathsToleranceDialog.tsx:61`, `useState('bridge')`), and the choice is not remembered between openings.

**Severity:** it remains P2. It is a wrong result the user is likely to notice: the cut vanishes on the canvas, one Undo restores it, and it needs the non-default mode. The reach is narrower than reported: short single arcs, or a tolerance at least the chord.

## Extra findings

### T10R-P2-1: "Moving both ends together" bends an end arc near a half circle by 6-22 times the gap: a D shape open by 0.5 mm burns its curve up to 2.5 mm inside the art
- **Severity: P2, borderline P1.** It moves the burned outline well beyond the typed tolerance, at the default tolerance of 0.5 mm. It changes the burn without anything obvious on screen: a 1-2.5 mm flattening of an arc. It also contradicts the auditor's "Not a defect" claim and the October v7 L6 audit note that the move is "half the gap and bounded by the typed tolerance". P2 rather than P1 because it needs two non-default choices: move-ends, plus arc geometry from Optimize Shapes with Smooth off, Part or sketch circles, or Trim pieces.
- **Not known:** no ledger or audit entry found (searched `docs/audits` for move-ends and close-with-tolerance arcs).
- **Where:** `src/core/geometry/close-within-tolerance.ts:107-118`.
  - `meetCurve` moves the start of an `elliptical-arc` first segment, or the `to` of a last one, but keeps the arc's radii and flags. `endpointArc` then re-solves the centre for the new chord.
  - When the chord shrinks, the centre shift is about `tan(halfSweep)/2` times the chord change. That shift is unbounded as the arc approaches 180°, because the radius stays fixed.
  - The compatibility polyline is only shifted at its two ends (`meetPolyline`), so the object `bounds` no longer match the burn.
- **Repro:** `zz-t10r\t10r.test.ts`, tests E, E2 and F. Results are in `t10r.log`.
  - **E, D shape built directly:** a half-circle `elliptical-arc` A→B, then a line B → A + (g, 0), so the path stops g short along the chord. Tol 0.5, move-ends. Bridge stays within gap/2 in every case. The ratio grows toward 180°: 170° gives 3.7-5.4×, 150° about 1.9×, 120° 1.0×.

    | Radius | Gap | Deviation (move-ends) | gap/2 | Ratio | Arc apex |
    |---|---|---|---|---|---|
    | r 10 | 0.5 | **1.581** | 0.25 | 6.3× | y −10.000 → −8.424 |
    | r 25 | 0.5 | **2.510** | 0.25 | 10× | — |
    | r 25 | 0.1 | **1.127** | 0.05 | 22.5× | — |

  - **E2 / F2, from a traced polyline D** (r 10 half circle plus diameter, open 0.4 mm at the corner). Optimize Shapes with Smooth off gives `ell`, with a first arc of r 10.000.
    - Close at the default 0.5, move-ends: the compiled arc's lowest point is y **41.259** against a true 40.000. That is 1.274 from the traced source, for a gap/2 of 0.200. The object `bounds` still say 40.013.
    - Bridge: lowest y 40.013, deviation 0.200.
  - **Plain near-circles also go past gap/2** when an end arc is at or above about 150°:
    - "2 arcs 10..190..350": 4.749 vs 3.473.
    - Optimize output, Smooth off, at 300° / 330° / 270°: 12.587 vs 10.000, 6.043 vs 5.176, 18.038 vs 14.142.
- **Oracle:**
  - Analytic: the ends move by gap/2 and the rest of the outline should not move further than that. Bridge, cubic move-ends (control points translate with the ends) and arcs at or below 120° all meet that bound in the same runs.
  - Arc geometry: a fixed radius r over chord c has a centre offset `sqrt(r² − c²/4)`. For r 10 with c going 20 → 19.75, that is 0 → 1.57 mm, which matches the measured 1.581.
- **Suggested fix:** the same fix as T10-P2-1. In `meetCurve`, turn an `elliptical-arc` first or last segment into cubics (`arcToCubics`) before moving the end, then translate the adjacent control point with the end as the cubic path already does. Add a D-shape test asserting deviation ≤ gap/2 + flattening, and recompute `bounds` from the curves.

## Totals
T10-P2-1: CONFIRMED (P2; reach narrower than reported: no in-app route to a near-full single arc; reachable through Optimize Shapes with Smooth off on short arcs, and Part or sketch half circles; default mode is bridge; preflight flags it only when it was the only cut, as "Internal error").
Extra raised 1: P1 0; P2 1 (T10R-P2-1, same root cause and fix as T10-P2-1); P3 0.
