# KerfDesk Layout, Nesting, Tiling, and Generators Sector Acceptance

**Date:** 2026-07-13

**Baseline:** 2026-07-11 competitive audit, shipped sector score **6.5/10**

**Candidate stack:** PR #58 + PR #70 + PR #71 + PR #72 + `codex/layout-9-outline-nest`

**Status:** Candidate evidence complete; not yet shipped on `main`

## Verdict

The shipped audit found tiling and box-fit tools but no automatic nesting. The Laser 9 candidate
added general Grid and Circular Array commands, deterministic MaxRects Quick Nest, board/workspace
bins, padding, 0/90-degree rotation, locked obstacles, rigid groups, and one-step undo.

This ticket adds an offline **Outline** method that compacts actual closed contours, including
concave parts and parts with holes. It can complete nests that bounding rectangles cannot fit,
while retaining the existing **Fast** rectangle method for large or mixed raster selections. The
stacked candidate earns **9.1/10** for Layout, Nesting, Tiling, and Generators. Shipped `main`
remains at 6.5 until the stack merges and is rerun there.

## Competitive Boundary

LightBurn documents built-in Quick Nest for fast layouts and its SVGnest handoff for tighter
concave/complex packing. KerfDesk now covers both use cases offline in one dialog and preserves the
original editable objects: [LightBurn Nest Selected](https://docs.lightburnsoftware.com/latest/Reference/NestSelected/).

VCarve Pro remains deeper at specialist sheet optimization, with arbitrary rotation steps,
mirroring, parts inside holes, custom boundary layers, per-part copy counts, and multiple nesting
sheets: [VCarve Pro Nest Parts](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/page/single-page/index.html#nest-parts).

## Evidence

| Capability | Evidence | Result |
| --- | --- | --- |
| Grid Array | Rows, columns, X/Y spacing, 500-copy bound, groups/layers preserved | Accepted in PR #58 |
| Circular Array | Count, center, radius, start angle, rotate-copies option | Accepted in PR #58 |
| Fast Nest | Deterministic MaxRects, workspace/board bin, padding, 0/90 rotation | Accepted in PR #58 |
| Outline Nest | Closed-contour collision and candidate compaction using the existing permissive Clipper boundary | Accepted |
| Concave efficiency | Complementary 40 x 40 triangles fit one 40 x 40 sheet although their rectangles cannot | Accepted in core, state, and Chromium |
| Hole preservation | A smaller part nests inside a ring without intersecting ring material | Accepted |
| Part spacing | Inflated outlines retain requested edge-to-edge clearance | Accepted |
| Locked artwork | Locked objects remain unchanged and act as conservative obstacles | Accepted |
| Groups and layers | Selected groups move rigidly; object ownership and layer bindings remain intact | Accepted |
| Mixed geometry | Raster, open, invalid, or over-budget geometry uses conservative bounds | Accepted |
| Honest fallback | Success result and toast disclose the number of units using rectangular bounds | Accepted |
| Failure boundary | A Clipper exception returns the safe rectangular result instead of escaping | Accepted |
| Performance | Deterministic 40-part outline corpus completes under the 2-second gate | Accepted |
| Large corpus | More than 150 units automatically use bounded Fast mode | Accepted |
| Undo and persistence | Nest is one undo step; browser save retains independently editable objects and transforms | Accepted |
| Board fill/layout | Grid and fill layouts clone selected designs inside a captured board | Accepted |
| CNC tiling | Overlap, registration holes, clipping, per-tile preflight, and multi-file export | Accepted |
| Box Generator | 54-spec property corpus, exact assembly, clearance, relief, lids, dividers, coupons | **1,114/1,114** |

## Verification

- Focused new implementation: **4 files, 14 tests passed**.
- Layout-sector battery: **12 files, 55 tests passed**, including forced Clipper failure.
- Box Generator benchmark: **1,114/1,114 checks passed**.
- Browser acceptance: existing Array -> Nest -> Preview -> Save workflow passed.
- Browser acceptance: outline-only 40 x 40 adversarial fixture nested and saved successfully.
- TypeScript and focused ESLint: passed.
- Full `pnpm release:check`: passed in **512.5 seconds**.

## Why 9.1

The candidate covers the complete everyday material-layout loop: duplicate regular patterns, pack
rectangular or real-outline parts, use a workspace or measured board, preserve spacing and groups,
avoid locked material, tile repeated designs, split oversized CNC work with registration, generate
production-ready boxes, undo, save, reopen, preview, and output. The difficult geometry is tested
at pure-core, state, and real-browser levels, and every fallback is conservative and visible.

The rating remains below dedicated nesting leaders because KerfDesk does not yet search arbitrary
rotation increments or mirroring, assign per-part copy quantities inside Nest, or manage multiple
material sheets in one project. Those are the next depth upgrades, not correctness failures in the
current single-sheet workflow.

## Score Boundary

- **Shipped `main`: 6.5/10** until the candidate stack merges and passes on `main`.
- **Stacked software candidate: 9.1/10** after the full release gate passes.
- This score does not increase CNC CAM, Rotary/Camera, Machine Recovery, or hardware sectors.
