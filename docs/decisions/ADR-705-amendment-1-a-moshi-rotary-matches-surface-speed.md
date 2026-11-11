## ADR-705 Amendment 1 - A Moshi rotary matches the surface speed (2026-11-11)

**Status:** Accepted. Amends ADR-705 (Moshiboard over a CH341 USB link), decision 3. Applies
ADR-127 Amendment 2 ("Speed is the speed across the material") to the Moshi encoder. Fixes
rolling audit v14 Z3-P1-2. **Simulator-tested only; not qualified on hardware.** | **Date:**
2026-11-11

### Context

A Y-port rotary runs a job in machine space, with Y scaled by k machine mm per surface mm. The
G-code strategy has matched each move's feed to the surface since #1672 (`surfaceMatchedFeed`).
The Moshi encoder wrote one speed per vector group, because a Moshi program has a single speed
header. Strokes round the part therefore moved the surface at 1/k of the layer speed. The audit
measured, on an Ø80 glass at 1500 mm/min with strokes round the part:

- 15.9 % of the set dose in the Creality chuck (40 mm per turn);
- 183.6 % on a geared roller (150 mm per turn, Ø26).

Nothing warned, and the Moshi route has no Job Review. Rotary Setup offers the Y axis for a
Moshiboard (`rotary-axis.ts`), and the usual K40 rotary replaces the Y motor.

### Decision

1. **One program per matched speed.** On a rotary job (`rotaryFeedMatchFor` returns a match),
   each Line or Fill group is split into runs of consecutive moves that share one speed. A run
   starts with a laser-off move to where the head is. Each cut gets
   `surfaceMatchedFeed(layer feed, from, to, match)`, which uses the same rule, taper factor and
   Max feed hold as G-code. That speed is rounded to the nearest whole mm/s in 1..256, the range
   the vector speed byte carries (MeerK40t `builder.py` L376-397). A speed change ends a program,
   as in MeerK40t (`driver.py` `plot_start` L304-313). Travel moves run at their run's speed.
   Image rows run along X and stay one raster program, as on G-code (ADR-492 item 9).
2. **Said, not hidden.** A group that becomes several programs gets a Job warning that the head
   pauses between them. When whole mm/s, the 1 mm/s floor, the 256 mm/s byte or Max feed leaves a
   cut outside 95–105 % of the set dose, the warning gives the range. Warnings never refuse.
3. **Unchanged.** A job without a rotary match gives byte-identical programs (the ADR-705 golden
   still passes). An A or Z rotary is still refused: a Moshiboard has no such axis.
4. **Assumption.** Like the G-code fix, this assumes the board times a move by its commanded XY
   length. No public source documents the Moshiboard's interpolation, and no hardware has
   confirmed it.

### Evidence

- `moshi-rotary-feed.test.ts` decodes the programs and measures each cut's dose from its decoded
  speed and direction. On the Creality chuck (k 0.159) and the geared roller (k 1.84), strokes
  along X, round the part and diagonal all land within 13 % of the set dose; quantisation at the
  chuck's 4 mm/s round the part is the widest. A 5 mm/s layer reports "between 80 % and 100 %"
  (round the part, 0.8 mm/s is held at the 1 mm/s floor). The flat-bed job stays one program at
  the layer speed.
- `emit-moshi-rotary.test.ts` runs the audit's case end to end: a Y-chuck Moshi project through
  `prepareOutput` and `emitPreparedMoshiJob`. All four rectangle strokes land at the set dose,
  where before the strokes round the glass got 15.9 %.

### Consequences

- A Moshi rotary job burns evenly in every direction within the quantisation the warning states.
  It stops between speed runs: a curve round the part becomes many short programs. That costs
  time, and a pause can mark the material where the beam stops and restarts.
- The audit's other fix direction, refusing a Y-port rotary on a Moshiboard, is not taken: the
  matched programs give the dose the layer asks for.
