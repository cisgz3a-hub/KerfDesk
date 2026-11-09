# Pro loop v1 — L10 Rotary scaling

- **When:** 2026-11-08   **Tree:** `devin/audit-loops-20261108`
- **Scope:** `src/core/devices/rotary.ts` (`rotaryYScale`, `rotaryYLimitMm`,
  `rotaryRevolutionTravelMm`), governing ADR-127 and ADR-373
- **Lenses run:** L2 (LightBurn Rotary Mode, GCode).
- **Counts:** 0 raised.

## Result

| Rotary | KerfDesk Y scale | LightBurn |
|---|---|---|
| Chuck | mm per rotation ÷ (π × object diameter) | "For Chuck style rotaries, carefully measure and enter the Object Diameter" |
| Roller with a roller diameter | mm per rotation ÷ (π × roller diameter); the object diameter does not scale output | "For Roller style rotaries, Circumference does not affect output scaling" |
| Roller without one | 1 (surface-calibrated, byte-identical to before ADR-373) | — |

Sources: [Rotary Mode (GCode)](https://docs.lightburnsoftware.com/latest/Reference/RotaryMode/RotaryModeGCode/)
and [Full Wrap Tumbler Engraving](https://docs.lightburnsoftware.com/latest/Guides/FullWrapTumblers/),
LightBurn 2.2 docs, fetched 2026-11-08. Both say mm per rotation is the commanded travel for one
turn of the chuck or of the driven roller, not of the object, which is what
`rotaryRevolutionTravelMm(setup, 'drive')` returns.

The wrap limit, `rotaryYLimitMm` = scale × π × object diameter, is one object revolution in emitted
millimetres, so the bounds check refuses a design taller than the object's circumference.

## Verified clean

The scaling law for both rotary types and the wrap limit. Placement and reverse-axis mirroring keep
their own suites (`emit-gcode-rotary*.test.ts`).
