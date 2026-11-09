# Pro loop v1 — L1 Laser G-code core

- **When:** 2026-11-08   **Tree:** `devin/audit-loops-20261108` from `origin/main` `5f09e1110`
- **Scope:** `src/core/output/grbl-strategy.ts`, `grbl-power-modes.ts`, `grbl-laser-lines.ts`,
  `src/core/devices/gcode-dialects.ts`, `src/io/gcode/emit-gcode.ts`
- **Lenses run:** L2 (GRBL semantics), L3 (twin: layer settings against emitted words), L4 (boundary
  settings). L5–L7 skipped: no new trust boundary; failure paths are the controller rounds' area.
- **Counts:** 0 raised.

## Headline

Thirty-three jobs across ten machine variants came out right on every check the GRBL model makes. No
lit rapid in any profile, including `$32=0` with GRBL Compatible (M3), where a missed `S0` would burn
every travel; S never exceeds `$30`; every program ends `M5`.

## Matrix

A 40 × 30 mm rectangle and a Ø20 mm circle on a Line layer at 50 %, 1200 mm/min, two passes, air on;
the rectangle alone on a Fill layer (40 %, 3000 mm/min, 0.5 mm interval) and on a Line layer with
Min power 20 %. Each against: the default profile, `$32=0`, `$30=255`, `$31=100`, GRBL Compatible,
GRBL Compatible with `$32=0`, air on M8, rear-left and front-right origins, and a 3000 mm/min
controlled laser-off travel feed; plus 100 % at 99,999 mm/min, 0 % power, and 0.1 mm kerf.

| Check | Result |
|---|---|
| S for a percentage | S = P × `$30` / 100 in every case (S500 at 50 % of 1000; S128 at 50 % of 255) |
| `$31` | does not shift S. GRBL maps S in [`$31`, `$30`] to PWM itself: `pwm_value = floor((rpm-settings.rpm_min)*pwm_gradient) + SPINDLE_PWM_MIN_VALUE` ([`spindle_control.c` @ `bfb67f0c7963`](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/spindle_control.c), fetched 2026-11-08), so an app that pre-shifted S would double-apply `$31` |
| M3 / M4 | M4 on GRBL Dynamic, M3 on GRBL Compatible, for cut and fill alike (ADR-257) |
| Rapids under `$32=0` | every G0 carries `S0`; the model found no lit rapid |
| Controlled travel | travels become `G1 … F3000 S0` with the laser-off marker |
| Air | one `M8` before the first burn, `M9` before `M5` at the end |
| Origins | front-left flips Y (scene y 100–130 → machine 270–300 on a 400 mm bed); rear-left keeps it; front-right mirrors X |
| Overspeed | clamped to `maxFeed` 6000 with a `speed-out-of-range` notice |
| 0 % power | no lit move; four `long-blank-feed` notices |
| Kerf 0.1 mm | outline grows 0.1 mm per side (99.9–140.1) |
| Burn length | rectangle exactly 140.00 mm per pass; the circle 0.035 mm short per pass (chord error) |
| End state | `M5`, then `G0 X0 Y0 S0` |

## Refuted

None raised.

## Verified clean

Everything in the matrix. Min power on a Line layer in M4 is not sent, which matches GRBL: M4 already
scales power with speed and has no floor.

## Not verified

Marlin and Smoothieware output, rotary, arcs (`laserArcMoves`) and the 4040-safe dialect; they have
their own regression suites and were outside this loop's matrix.
