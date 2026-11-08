# Pro loop v1 — L6 3D CNC: correctness and maturity

- **When:** 2026-11-08   **Tree:** `devin/audit-loops-20261108` from `origin/main` `5f09e1110`
- **Scope:** `src/core/relief/**` (toolpath side), `src/core/cnc/compile-cnc-relief*.ts`,
  `src/core/toolpath3d/**`, `src/core/sim/**`; maturity against Vectric Aspire's 3D toolpaths
- **Governing:** ADR-412 and Amd 1–2, ADR-421, ADR-423, ADR-424 Amd 1, ADR-580 and Amd 1, the
  2026-10-08 CNC leaders plan (R01–R07, D01, D04)
- **Lenses run:** L1, L2 (Vectric docs), L3 (depth map against STL of the same surface), L4, L7.
- **Counts:** 2 raised (both KNOWN, both re-measured on main and fixed) → P2 1 / P3 1.

## Headline

The 3D area is well built: roughing never cut into the model, STL finishing rides the model within
0.01 mm, and it already covers most of what a hobby relief carver needs (roughing with allowance,
ball and tapered-ball finishing, waterline on steep walls, flats with the roughing bit, 3D rest
finishing, projection of vectors onto the surface, two-sided parts, a carved-stock preview).

Its one serious quality gap was that **depth-map reliefs — the most common relief input — finished
up to 20 times rougher than the same surface as an STL**, whatever scallop was asked for. This loop
fixes that (ADR-580 Amendment 2): the 42° slope's median skin falls from 0.154 mm to 0.016 mm.

## Measurements

24 × 10 mm depth map, 0.1 mm pixels, 10 mm deep: flat, 20° and 42° bands rising along X; its STL twin
is the same three planes. Roughing `em-3175`, 2 mm per pass, 0.5 mm allowance; finishing `bn-3175`,
0.025 mm scallop, Raster. Judged by the loop's own ball drop-cutter on every emitted feed move,
vertically, away from the relief's edges.

| Relief / rows | Before: 20° p50 / 42° p50 (max) | After: 20° p50 / 42° p50 (max) | Lowest point vs sampled surface |
|---|---|---|---|
| Depth map, rows along Y | 0.064 / 0.154 (0.215) | 0.007 / 0.016 (0.061) | −0.001 mm |
| Depth map, rows along X | 0.063 / 0.143 (0.200) | 0.007 / 0.009 (0.034) | −0.001 mm |
| STL twin, rows along Y | 0.004 / 0.008 (0.029) | unchanged | −0.001 mm |

The depth map's sharp 42°-to-top crest falls between pixel centres; the new surface cuts it on the
chord by 0.016 mm (rows along X), which is what the same map always got at one cell per pixel.

## Findings

### L6-P2-1 — Depth-map reliefs finish 10–20× rougher than the same surface as an STL (KNOWN 16-P2-1 / F6-P2-1) — FIXED

- **Where:** `src/core/relief/heightfield-to-heightmap.ts` `sampleTargetCell` took the highest source
  pixel under each CAM cell; `heightmap-tool-offset.ts` `dilatedCell` then lifted every finishing tip
  to at least the lattice kernel over those cells.
- **Anchor:** Twin. ADR-580 Decision 1 carves an STL on its own triangles ("a slope keeps no extra
  stock"); the same surface as a depth map kept (cell + pixel) / 2 × gradient. And the map's own
  result changed with the cell-to-pixel ratio: at one cell per pixel it already was the triangulated
  pixel-centre surface (ADR-412 grid field).
- **Scenario:** any depth map with pixels finer than the finishing cell (a 1/8" ball's cells are about
  0.28 mm at the default scallop): every slope is left proud. A finer scallop does not help.
- **Evidence:** REPRO. `audit/loop-v1/loop6-relief.test.ts` (table above). Regression:
  `compile-cnc-relief-heightfield-surface.test.ts` fails on `origin/main` (the tip stands off a sampled
  ramp by the cells' rise) and passes after the fix.
- **Fix:** ADR-580 Amendment 2. Relief CAM reads an unexcluded height map on its triangulated
  pixel-centre surface (`heightfield-exact-surface.ts`): cells sample it at their centres, and the
  triangles ride in `Heightmap.exactSurface` to the existing mesh contact field. Each quad takes its
  higher diagonal (the upper envelope of both triangulations). Masked-excluded fields and fields over
  1024 × 1024 pixels keep the old cells.
- **Cost:** finishing a 40 mm, 400 × 400 px map took 10.5 s instead of 1.6 s (25 s at 800 × 800);
  roughing stayed under a second. ADR-580 accepted the same order of cost for STLs.

### L6-P3-1 — 3D rest finishing emitted one G1 per half cell (KNOWN F6-P3-2) — FIXED

- **Where:** `src/core/relief/relief-rest-passes.ts` split every kept move into half-cell pieces and
  emitted each piece's end, so a rest path had about 5× the lines of the same finishing path.
- **Anchor:** Twin. ADR-421 item 3 reduces finishing paths because "GRBL's 16-block planner starves on
  long runs of short segments".
- **Fix:** consecutive kept pieces of one move collapse to one G1. The pieces lie on the move's own
  straight XYZ line, so the path is identical. Regression: `relief-rest-authoring.test.ts`.

## Still open (not fixed in this loop)

- **F6-P3-1 (KNOWN):** rest prediction still falls back to full fine finishing above about 23 mm
  square (`relief-residual-stock.ts` `MAX_PREDICTION_WORK = 32_000_000`); disclosed in Job Review.
- **Masked height maps** (`outsideMask: 'excluded'`) still finish on highest-pixel cells: the mesh
  contact field has no model of excluded whole-cell stock.

## Maturity against Vectric Aspire

Reference: Vectric Aspire 12.5, 3D Finish Toolpath
([docs.vectric.com V12.5](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Finish%20Machining%20Toolpath/index.html),
fetched 2026-11-08). It offers a machining limit boundary (model, material, selected vectors or a
level) with a boundary offset, and two area strategies: Offset, and Raster "with control over Raster
Angle - Between 0 and 90°", plus a stepover retract for Offset.

| Capability | KerfDesk today | Status |
|---|---|---|
| Relief sources | depth images (8/16-bit, masks, crop, gamma), STL, vector-built shapes, sculpting, rail/profile, clips | strong |
| Roughing | Z-level offset rings with allowance, fine steps on slopes, ramp entry, flats with the roughing bit | good; no raster (lace) roughing |
| Finishing strategies | Raster, Raster + waterline (automatic for STL) | partial: no Offset/spiral finishing |
| Raster angle | X or Y only (`reliefRasterAxis`) | gap: Aspire allows 0–90°, and 45° / 135° double finishes are common practice |
| Machining limit boundary | none for relief toolpaths (rest finishing selects residual areas automatically) | gap: Aspire restricts any 3D toolpath to vectors, a level or the model, with a boundary offset |
| Cutters | flat, ball, tapered ball, V, engraving; exact contact for each | strong |
| Gouge protection | exact drop-cutter on STL triangles and now on depth-map pixel surfaces | strong |
| Rest finishing | predicted from the actual previous passes | good; size budget (F6-P3-1) |
| Projection | vectors engraved at a vertical depth below the relief surface | good |
| Two-sided | split, flip, registration, stock-thickness follow (ADR-580 Amd 1) | good |
| Rotary / wrapped 3D | offline study only (D04); no executable rotary 3D output | gap |
| Model import | STL only for meshes | gap: Aspire also imports OBJ and others |
| Simulation | removal grid, carved-stock compare, 3D viewer | good |
| Output | point-reduced 3D G1, per-tool sections, M0 bit changes, tiling | good; no arc fitting in 3D (not needed by GRBL) |

### What still needs to be developed, in order of value

1. **Raster angle 0–90°** for relief finishing (and a second finishing pass at the crossing angle).
   The finishing planner already transposes the map for Y; an arbitrary angle needs the map and its
   exact surface rotated (triangles rotate exactly; cells resample from the exact surface).
2. **Machining limit boundary** for relief roughing and finishing: selected vectors, with a boundary
   offset, so detail finishing with a small bit can be confined to one area.
3. **Offset (spiral) finishing** for round and organic reliefs, with Aspire's stepover retract.
4. **Rest-prediction budget** (F6-P3-1), so reliefs larger than about 23 mm get a real rest selection.
5. **Masked height maps on the exact surface:** teach the mesh contact field the excluded whole-cell
   stock, then drop the exclusion carve-out from Amendment 2.
6. **OBJ import** beside STL.
7. **Rotary 3D output** beyond the D04 study, once a rotary machine can be qualified.

No hardware, air-cut or material result is claimed by this loop.
