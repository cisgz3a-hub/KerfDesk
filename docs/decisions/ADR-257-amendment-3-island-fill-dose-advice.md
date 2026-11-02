## ADR-257 Amendment 3 - Island Fill rows are advised by their own runways (2026-11-02)

**Status:** Accepted. | **Date:** 2026-11-02

Amends ADR-257 Amendment 2, Decision 1, which said island fills get Amendment 1's image test but
never gave them advice. `grbl-compatible` keeps M3 for fills, and compiled output does not change.

### Context

Rolling audit v9 finding R2-P2-3 (raised to P1 by its refuter, matching Q1-P2-1 and N8-P2-5).

- An island sweep usually has one span, so Amendment 2's window of `N - 1` moves inside a sweep never
  fits one, and `constantPowerWarnings` returned nothing for all 60 audited combinations.
- Each row is `G0` runway, one `G1` burn, `G0` runway, with a corner or reversal beyond. Island Fill
  caps a runway at half its row (ADR-033), and Overscan 0 gives none, so short rows never reach the
  feed while M3 keeps full power.

Doses from the audit's and the refuter's planner models (GRBL Compatible, 500 mm/s²):

| Overscan | Strokes | 1500 / 3000 / 6000 mm/min | Notice before this amendment |
|---|---|---|---|
| 5 mm | 0.3 mm | 1.64 / 3.29 / 6.58× | generic heat notice |
| 5 mm | 3 mm | 1.00 / 1.08 / 2.13× | generic heat notice |
| 0 | 0.3 mm | 3.09 / 6.17 / 12.34× | none |
| 0 | 6 mm | 1.15 / 1.72 / 3.43× | none |
| 1 mm | 3 mm | 1.00 / 1.22 / 2.44× | none |

The generic heat notice (`fill-heat-risk.ts`) reads the same under M4, where the dose is 1.00×, and
names neither power nor GRBL Dynamic. At Overscan 0 or on rows of at least twice the overscan it does
not fire. The only other notice is about scan edges.

### Decision

1. **The test.** A row is too few moves for the planner's depth to limit it. What limits it is the
   runway: the head holds the feed through the ink only if it can reach it on one runway and stop on
   the other. So the speed that holds is the same `v = sqrt(2·a·D)`, with `D` the shorter of the
   row's two runways from `planFillSweeps` and `a` the saved acceleration along the row. The advice
   fires when the feed exceeds that speed, at every overscan. A feed at or below it has a dose of
   1.000 in the model. Island sweeps with enough moves still get Amendment 2's window test as well,
   and the lower speed is quoted.
2. **One advisory per operation.** Island Fill compiles one group per island, so groups are gathered
   by layer and speed, and the advice quotes the tightest row (least runway, then shortest).
3. **What it quotes.** The remedy is Amendment 1's. The fallback follows from the row:
   - Runway already half the row: lower the speed; more Overscan would be capped.
   - Runway limited by Overscan: raise Overscan to about what the feed needs, capped at half the row
     and the field's 25 mm, with the speed that row then holds if it is below the feed; or lower the
     speed.
   - Overscan 0: raise Overscan, with that speed if needed. No lower speed is offered alone, because
     without a runway the head always starts and stops on the ink. The corner speed would be a guess
     at each junction and is too slow to be a useful answer.
4. **Unchanged.** The generic heat notice stays, word for word, under every dialect. Ordinary Fill
   keeps Amendment 2's test, so its row ends stay with Overscan and its advisory (ADR-495). An
   operation set to a power mode by hand gets no advice. It is advice only, never a Start guard
   (ADR-565).

Only GRBL Compatible fills with M3 by default. GRBL Dynamic, GRBL Raster and Neotronics 4040 Safe
fill with M4, and the 4040 keeps M3 for Line cuts only. A test now fails if another dialect defaults
to constant fills, so its advice gets checked.

### Consequences

- GRBL Compatible Island Fill at Overscan 0 is advised at any practical speed, as Line cuts already
  are for their path ends. The first step it names is usually small: 20 mm rows at 1500 mm/min need
  0.7 mm.
- With the 5 mm default on the 500 mm/s² profile, 1500 mm/min is advised for rows under 1.25 mm. At
  6000 mm/min every row is advised, because 5 mm of runway reaches only 4242 mm/min. Automatic
  overscan goes quiet on rows long enough to carry its runway (20 mm or more at that speed).
- grblHAL and FluidNC get this advice too, unlike Amendment 2's on short rows: a deeper planner does
  not lengthen a runway.
- On the M3 route the heat notice and this advice can both appear. The heat notice is kept as is.

### The model and its limit

The test blends `G0` into a straight `G1`, as the audit's and refuter's models do. That follows
gnea/grbl's source: `plan_buffer_line` (`planner.c`) computes a junction speed from direction alone,
with no case for a rapid, and `gcode.c` forces a laser sync only for a line with no motion. The time
estimate deliberately keeps a stop at that boundary (`junction.ts`, "conservative"), so it reads
higher doses on these rows, and it is not the model used here. On firmware that really stopped
there, a runway would not help and the quoted speed would not hold. This is a model of the saved
profile, not a measurement, and the text says so.

### Verification

- `src/ui/laser/constant-power-island-fill.test.ts`: its dose model plans the real emitted G-code with
  the shipped `planVelocities`, and reproduces the refuter's table across eight stroke and overscan
  rows at three speeds. Advice is checked at overscan 0, 1, 5 mm and Automatic, at 1500 and 6000
  mm/min. Re-running the job at each quoted speed and Overscan gives a dose of 1.000 and no advice.
  Controls: GRBL Dynamic, the 4040, hand-set modes, ordinary Fill, rows the runway does hold, and the
  M4 heat notice's exact words.
- `src/ui/laser/constant-power-island-surfaces.test.ts`: the same job through Save G-code, Start and
  Job Review, and remote review, on GRBL Compatible and GRBL Dynamic.
- Only `constant-power-warnings.ts` changes in production code, so G-code stays byte-identical and
  `EMITTER_REVISION` is unchanged.
- Code and test evidence only. Nothing was burned.
