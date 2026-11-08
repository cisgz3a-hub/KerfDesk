# Pro loop audit v1 — ledger

Method and areas: [AREAS.md](AREAS.md).

| Loop | Area | Report | Raised | P1 | P2 | P3 | Known | Fixed |
|---|---|---|---|---|---|---|---|---|
| 1 | Laser G-code core | [L1](L1-laser-gcode-core.md) | 0 | 0 | 0 | 0 | 0 | — |
| 2 | Raster engraving | [L2](L2-raster.md) | 0 | 0 | 0 | 0 | 0 | — |
| 3 | Vector cut and fill | [L3](L3-vector.md) | 1 | 0 | 0 | 1 | 0 | no (maintainer decision) |
| 6 | 3D CNC | [L6](L6-cnc-3d.md) | 2 | 0 | 1 | 1 | 2 | both |
| 4 | Time estimate | [L4](L4-time-estimate.md) | 0 | 0 | 0 | 0 | 0 | — |
| 5 | CNC 2D output | [L5](L5-cnc-2d.md) | 0 | 0 | 0 | 0 | 0 | — |
| 7 | Bidirectional scan offset | [L7](L7-scan-offset.md) | 1 | 0 | 1 | 0 | 0 | no (reverses ADR-052; maintainer decision) |

## Confirmed findings

| ID | Severity | Summary | Fix |
|---|---|---|---|
| L6-P2-1 | P2 | Depth-map reliefs finished 10–20× rougher than the same STL surface (42° median 0.154 mm against 0.008 mm); KNOWN rolling-v2 16-P2-1 / CNC v1 F6-P2-1, re-measured on main | ADR-580 Amendment 2: height maps carve their pixel-centre surface (42° median now 0.009–0.016 mm) |
| L6-P3-1 | P3 | 3D rest finishing emitted one G1 per half cell; KNOWN CNC v1 F6-P3-2 | one G1 per kept stretch of a move, same path |
| L7-P2-1 | P2 | Reverse-only scan compensation leaves a calibrated fill or image half its table value off the design and off vector cuts; LightBurn moves every row half the gap | open: prototyped (all seven twins), withdrawn because it reverses ADR-052's explicit choice and changes 42 pinned assertions; needs the maintainer's go-ahead |
| L3-P3-1 | P3 | A Scan Line fill whose edge lies on its grid burns its first line on that edge and stops one interval short of the opposite edge | open: changes every Scan Line fill; no primary source on LightBurn's grid phase |

Emitter revision: `heightmap-pixel-surface-20261108-v42`.

## Next loop

The 3D development list in [L6](L6-cnc-3d.md) (relief raster angle first), F6-P3-1's rest budget,
and the areas not yet run here: Marlin and Smoothieware output, rotary, and the material-test
generators.
