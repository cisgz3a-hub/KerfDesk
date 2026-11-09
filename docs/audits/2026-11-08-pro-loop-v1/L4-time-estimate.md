# Pro loop v1 — L4 Time estimate

- **When:** 2026-11-08   **Tree:** `devin/audit-loops-20261108` (after the L6 fix)
- **Scope:** `src/core/gcode-time/**`, `src/core/motion-planner/**`
- **Lenses run:** L2 (GRBL `planner.c`), L3 (the app's estimate against an independent planner on the
  same emitted program).
- **Counts:** 0 raised.

## Headline

On 62 emitted programs (every laser and relief program loops 1, 2, 3 and 6 produced) the app's
estimate, with the device's own timing options, lies 0.2–0.9 % above an independent GRBL planner
model with unlimited look-ahead. That is the right side to err on: the real planner holds 16 blocks,
not unlimited.

## The independent model

`audit/loop-v1/planner.ts`, written from GRBL 1.1 `planner.c` @ `bfb67f0c7963`: per-block
acceleration limited by each axis's share of the move, Sonny Jeon's junction deviation with
`sin(θ/2) = √(½(1 − cos))` on the negated dot product and the junction vector's acceleration, entry
speeds capped by both blocks' nominal speeds, a backward then forward pass, trapezoids, rest at start
and end, and a planner drain at `G4`. G0 runs at `maxFeed`, as the app assumes for `$110`.

## Results (default profile: 500 mm/s², 0.01 mm junction deviation, 6000 mm/min)

| Program family | App / model | Note |
|---|---|---|
| Line, Fill, Offset, Island fills, tabs, leads, perforation | 1.002–1.008 | |
| Images (every dither), 2 lines/mm | 1.003–1.009 | |
| Floyd–Steinberg, 10 lines/mm | 1.056 | 1.002 with the 16-block window off: the window is the difference, as on the controller |
| Cross-hatch at 45° | 1.028 | the app plans a Cartesian machine at the profile acceleration in every direction; GRBL allows up to √2 more on a diagonal. ADR-675 chose this so the estimate errs long |
| Relief roughing and finishing (CNC) | 1.005 | |

An early run without the device's timing options was up to 25 % long, because a G0 then counted as a
planner stop. The app passes those options (`deviceProgramTimingOptions`, ADR-255 Amendment 3), so
that was a harness mistake, not an app defect.

## Verified clean

Planner kinematics, junction law, laser-mode G0 blending under `$32=1`, the 16-block window's effect.

## Not verified

Serial delivery time at 115200 baud (ADR-244), CoreXY per-motor limits (ADR-675) and controller
families other than GRBL 1.1.
