# Pro loop v1 — L8 Marlin, Smoothieware, FluidNC and grblHAL output

- **When:** 2026-11-08   **Tree:** `devin/audit-loops-20261108`
- **Scope:** `src/core/output/marlin-strategy.ts`, `marlin-fan-*.ts`, `smoothieware-strategy.ts`,
  `grbl-laser-arc-moves.ts`; the L1 matrix (rectangle + circle Line, rectangle Fill, Min power)
  re-run on five controllers
- **Lenses run:** L2, L3.
- **Counts:** 0 raised.

## Results

| Controller / dialect | Power words | Travel | Notes |
|---|---|---|---|
| Marlin inline (`$30`-equivalent 255) | `M3` with per-move `S128` at 50 % | `G0 … S0` | as Marlin's LASER_FEATURE inline mode expects |
| Marlin fan-MOSFET | `M106 S128` before each burn, `M107` before each travel | `G0` with the laser off | no per-move S, as the fan output allows |
| Smoothieware | `S0.500` at 50 % (Smoothie's 0–1 scale) | `G0 … S0` | `fire off` and `M221 S100 P0` in the header reset test fire and the power override |
| FluidNC, grblHAL | `M4`, S500 | `G0 … S0` | circles go out as `G2` arcs (ADR-432): centre and radius check to 0.005 mm, and each contour closes on its start |

The loop's GRBL model flagged `M106`/`M107`, Smoothie's `M221 S100` and arc length only because it
models neither fan power nor arcs; each was checked by hand above.

## Verified clean

Power scaling, travel power-off and contour closure on all five.
