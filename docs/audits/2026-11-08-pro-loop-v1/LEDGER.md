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
| 7 | Bidirectional scan offset | [L7](L7-scan-offset.md) | 1 | 0 | 1 | 0 | 0 | yes, after the maintainer chose LightBurn's rule (#1623) |
| 8 | Marlin, Smoothieware, FluidNC, grblHAL | [L8](L8-other-controllers.md) | 0 | 0 | 0 | 0 | 0 | — |
| 9 | Material Test grid | [L9](L9-material-test.md) | 0 | 0 | 0 | 0 | 0 | — |
| 10 | Rotary scaling | [L10](L10-rotary.md) | 0 | 0 | 0 | 0 | 0 | — |
| 11 | Focus and interval tests | [L11](L11-focus-interval-tests.md) | 0 | 0 | 0 | 0 | 0 | — |

## Confirmed findings

| ID | Severity | Summary | Fix |
|---|---|---|---|
| L6-P2-1 | P2 | Depth-map reliefs finished 10–20× rougher than the same STL surface (42° median 0.154 mm against 0.008 mm); KNOWN rolling-v2 16-P2-1 / CNC v1 F6-P2-1, re-measured on main | ADR-580 Amendment 2: height maps carve their pixel-centre surface (42° median now 0.009–0.016 mm) |
| L6-P3-1 | P3 | 3D rest finishing emitted one G1 per half cell; KNOWN CNC v1 F6-P3-2 | one G1 per kept stretch of a move, same path |
| L7-P2-1 | P2 | Reverse-only scan compensation left a calibrated fill or image half its table value off the design and off vector cuts; LightBurn moves every row half the gap | ADR-052 Amendment 2 (#1623): every row of a two-way scan moves half the stored value along its own travel |
| L3-P3-1 | P3 | A Scan Line fill whose edge lies on its grid burns its first line on that edge and stops one interval short of the opposite edge | open: changes every Scan Line fill; no primary source on LightBurn's grid phase |

Emitter revision: `scan-offset-half-each-row-20261111-v45` (#1623, landed after v44; v43 was held for it and never shipped).

## Next loop

The 3D development list in [L6](L6-cnc-3d.md) (relief raster angle first), F6-P3-1's rest budget,
then a second pass over the areas this round found clean, with new inputs.
