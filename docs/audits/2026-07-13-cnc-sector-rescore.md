# CNC Sector Rescore

Date: 2026-07-13

## Verdict

The five-ticket CNC program materially changes the 2026-07-11 audit result, but it does not justify saying every CNC sector is above 9 yet.

| Rating | 2026-07-11 | Candidate | Result |
|---|---:|---:|---|
| CNC 2D/2.5D CAM | 7.5 | **9.1** | Clears the 9.0 target on the verified candidate stack. |
| Advanced CNC and 3D | 7.5 | **8.8** | Improved substantially; still below target. |
| CNC end-to-end stack | 7.5 | **8.9** | Hardware and advanced-strategy gaps keep the combined workflow below target. |

These are candidate scores for the stacked branches, not shipped-main scores. They become eligible for the main audit only after the PR chain merges and the same acceptance workflows pass on the resulting `main` revision.

## Evidence added

1. Native G2/G3 helical pocket entry with fit validation, preview, estimates, tiling behavior, and fail-closed preflight.
2. Two-bit pocket rest machining based on modeled rough-tool swept stock, with deterministic tool ordering and an explicit tool change.
3. Bounded-engagement adaptive clearing with native helical entry, cleanup contours, independent stock-removal verification, and fixed-budget refusal.
4. Straight-sided inlay-pair automation with linked female/male radius compensation, per-side allowance, mirrored placement, pocket-first ordering, and insert tabs.
5. Persisted drag-placeable profile tabs with compiled-position parity, mixed-layer safety, undo, project round trip, and browser acceptance.

Every ticket passed focused tests, browser acceptance, and the full repository release gate. The individual records are:

- `2026-07-13-cnc-helical-entry-acceptance.md`
- `2026-07-13-cnc-rest-machining-acceptance.md`
- `2026-07-13-cnc-adaptive-clearing-acceptance.md`
- `2026-07-13-cnc-inlay-automation-acceptance.md`
- `2026-07-13-cnc-drag-tabs-acceptance.md`

## Why CNC 2D/2.5D clears 9.0

The core workflow now covers profiles, compensated inside/outside cuts, pockets, engraving, drilling, V-carving, native arcs, depth ladders, ramps, verified helical entry, two-tool rest machining, bounded adaptive clearing, linked straight inlays, automatic and draggable tabs, stock and bit setup, probing, tiling, surfacing, preview, estimates, output, and integrated machine control. The new features are wired through the existing deterministic compiler and preflight paths rather than existing as isolated generators.

## Why advanced CNC remains below 9.0

1. Adaptive clearing deliberately rejects islands and very large verification grids; it is not a general medial-axis/trochoidal planner.
2. Helical entry rejects disconnected pockets and islands instead of choosing one verified entry region per component.
3. Rest machining and helical entry remain mutually exclusive.
4. Inlay automation is straight-sided only; tapered V-inlays still need glue gap, surface clearance, and plug-stock modeling.
5. Relief CAM still needs broader strategy controls and golden/hardware correlation evidence.
6. Representative physical-machine campaigns for probing, tool changes, recovery, feeds, and strategy output remain incomplete.

## Next CNC target

The shortest defensible route above 9 is a combined advanced-CNC acceptance release:

1. component-aware helical entry for disconnected pockets;
2. island-aware adaptive clearing with bounded engagement proof;
3. compatible rough-rest plus helix sequencing;
4. tapered V-inlay pocket/plug automation;
5. fixed-fixture hardware runs on at least two GRBL-family routers, including probing, tool change, pause/recovery, and dimensional verification.

Until that evidence exists, the correct statement is: **KerfDesk's candidate core CNC CAM is above 9; its advanced and end-to-end CNC sectors are not yet above 9.**
