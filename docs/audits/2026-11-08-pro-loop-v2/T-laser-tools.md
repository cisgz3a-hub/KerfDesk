# Pro loop v2 — T1–T4 Laser kerf, tabs, automatic overscan, fill styles

- **When:** 2026-11-08   **Tree:** `devin/pro-loop-v2` from `origin/main` `82458c902`
- **Harness:** `audit/loop-v1/r2-tools.test.ts` (kept out of the repository) drives `emitGcode` and
  judges the program with the round's independent GRBL model and a point-to-polygon distance check.
- **Counts:** 1 raised → P3 1.

## T1 Kerf offset

| Case | Result |
|---|---|
| 5-point star (R 20 / r 8), kerf 0.1 mm | every burned vertex 0.099–0.123 mm outside the star: 0.1 along the edges, more only at the sharp tips' joins |
| Same, kerf 0.3 mm | 0.299–0.368 mm |
| Ø0.4 mm shape (smaller than the kerf), kerf 0.1 / 0.3 | an outer shape grows to Ø0.6 / Ø1.0 (burn 1.89 / 3.15 mm = π × Ø) |

## T2 Tabs

Three 1.5 mm tabs on a Ø30 circle with 0.1 mm kerf: three burn runs, gaps of 1.500 / 1.499 /
1.499 mm (chord), total burn 90.365 mm against 2π × 15.1 − 4.5 = 90.376 mm (the 128-gon's chords).

## T3 Automatic overscan

`automatic-overscan.ts` sizes the run-up as v² / 2a + 10 %, with the acceleration along the scan:
a / max(|cos θ|, |sin θ|) on a Cartesian machine and a / (|cos θ| + |sin θ|) on CoreXY. That is the
from-rest distance of a constant-acceleration move, and GRBL's per-axis limit (`planner.c`
`limit_value_by_axis_maximum` @ `bfb67f0c7963`, the same rule loop v1 L4 modelled). Clean by reading.

## T4 Fill styles on a star with a Ø6 hole, 0.5 mm interval

| Style | Furthest interior point from any burn | Burn ends outside the shape |
|---|---|---|
| Scan Line | 0.250 mm (half the interval) | 0 |
| Island | 0.250 mm | 0 |
| Offset | **0.435 mm**, 4.19 mm from the star and 4.25 mm from the hole | 0 |

### T4-P3-1 — Offset fill leaves an unburned thread where the rings from the outline and the hole meet

- **Where:** the laser Offset fill (`fillStyle: 'offset'`); rings sit at 0.25, 0.75, … mm from the
  boundary. Where the outline's rings and the hole's rings meet, the deepest point can stand up to a
  whole interval from the last ring.
- **Anchor:** Twin. Scan Line and Island fills of the same shape keep every interior point within half
  an interval of a burn, and the CNC pocket already closes this gap with a core ring
  (`pocket-paths.ts` `coreRing`, July audit item 1.10).
- **Scenario:** an Offset-filled shape with a hole, 0.5 mm interval: a thin unburned line runs along
  the middle between the outline and the hole wherever the remaining width falls between rings.
- **Evidence:** REPRO (table above).
- **Severity:** P3. Cosmetic, inherent to plain offset filling, and no primary source says what
  LightBurn's Offset Fill does at the centre line. **Fix direction:** add a final path along the
  region's centre wherever the last ring leaves more than half an interval, as the CNC pocket's core
  ring does.

## Verified clean

T1, T2 and T3, and the containment of all three fill styles.
