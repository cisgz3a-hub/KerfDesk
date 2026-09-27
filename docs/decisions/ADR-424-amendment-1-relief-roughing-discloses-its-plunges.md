## ADR-424 Amendment 1 - Relief roughing discloses the plunges it keeps on loops shorter than one cut width (2026-09-27)

**Status:** Accepted; software-verified through unit, compile/emit and Job Review tests and a
stock simulation of the emitted G-code; motion unchanged, hardware qualification pending. |
**Date:** 2026-09-27

Amends ADR-424 items 4 and 5, using the disclosure ADR-471 (PR #975) built for the generic
contour ramp. The Frame-first Start contract (ADR-228, PROJECT.md non-negotiable 21) is
unchanged: the Job Review finding is an advisory, never a refusal, and no motion changes.

### Context

ADR-424 item 4 plunges a relief roughing chain whose first loop is shorter than one cut width,
even with a ramp angle set: the loop is too tight to ramp round. Item 5 records the angle on the
roughing group, so its G-code header reads `; cnc entry: contour-ramp; max-angle-deg: N` over
those straight plunges, and nothing said which passes plunged. ADR-471 added the means to say
so for contour ramps (an `entryPlunge` marker on the contour pass, a header advisory and the Job
Review advisory `cnc-ramp-entry-plunge`) and listed relief roughing as not yet using it.

Reproduced on main 52cb50cce with PR #975 applied: compiled with `compileCncJob`, emitted with
`cncGrblStrategy`, and the emitted G-code replayed through a flat end mill stock simulation
(0.05 mm cells). 3.175 mm end mill, 1.5 mm per pass, 40% stepover, the default 0.5 mm allowance
and a 5 degree ramp; each relief 30 mm square and 3 mm deep:

| Relief | Roughing passes | Ramped | Straight plunges into stock | Header |
|---|---|---|---|---|
| 5.5 mm square hole | 2 | 0 | 2 (first loops 1.1 mm): 1.5 and 0.85 mm | ramp claim only |
| 6 mm square hole | 2 | 0 | 2 (2.7 mm loops): 1.5 and 0.85 mm | ramp claim only |
| 9 mm square hole | 2 | 1 | 1 (2.5 mm loop): 1.0 mm | ramp claim only |
| 28 mm spherical bowl | 2 | 1 | 1 (1.1 mm loop): 0.87 mm | ramp claim only |
| 8 mm boss on a floor | 8 | 3 | 5 (loops 1.1 to 2.7 mm): 1.5 mm and four of 1.0 mm | ramp claim only |
| 7 mm hole; flat floor | 2 each | 2 each | 0 | ramp claim only |

Every plunge met uncut stock under the whole cutter. Job Review listed nothing. Without a ramp
angle every pass plunges and the group claims no ramp, so there is nothing to disclose.

### Decision

1. **The pass says it plunged.** `openChain` (`relief-roughing-motion.ts`) marks a chain when a
   ramp angle is set, the level has stock to descend through (its slice top stands above it),
   and the first loop is shorter than one cut width. The chain stays the same contour pass, with
   `entryPlunge: true`, which the compiler's placement keeps. A chain without a ramp angle, or on
   a level with nothing above it to descend through, is not marked.
2. **The header counts them.** The roughing group's header adds ADR-471's line under its ramp
   claim: `; cnc entry-advisory: N passes plunge: path shorter than one cut width`.
3. **Job Review words it for relief.** `rampEntryPlungesByLayer` reports a layer's relief
   roughing apart from its other passes, and the advisory reads, for example:
   `Layer L1: 2 relief roughing passes plunge straight down instead of ramping: a loop shorter
   than one cut width is too tight to ramp round. Set Ramp entry to 0 to remove this notice.`
   It names the field the layer's card shows for the angle relief roughing reads: Ramp entry on a
   profile, pocket or engrave layer, Roughing ramp on any other. ADR-471's wording fits relief
   except for the field: on a V-carve layer, Ramp entry sets the V-bit angle
   (`vCarveRampEntryDeg`), so setting it to 0 would never remove the notice, and inlay and drill
   layers show no Ramp entry row. The rule behind the card's Roughing ramp row
   (`cutTypeShowsRampEntry`) moved from `CncReliefStrategyRows.tsx` to
   `src/core/cnc/relief-ramp-field.ts`, so the card and the notice share it. The code stays
   `cnc-ramp-entry-plunge`: an advisory, not a compile-integrity code.
4. `EMITTER_REVISION` advances to `relief-ramp-plunges-disclosed-20260927-v1`.

Not chosen: dropping the group's ramp claim when all its passes plunge, as ADR-273 Amendment 1
does for relief finishing. Relief roughing does ramp wherever its first loop allows, and ADR-471
keeps the claim with a count for contour paths that all plunge. A 6 mm hole therefore reads
`passes: 2`, the ramp claim, and `2 passes plunge`. Lapping the short loops (ADR-278's rule) was
weighed and declined by ADR-424 and again by ADR-471.

### Consequences

- The header and Job Review now account for every straight plunge relief roughing keeps under a
  ramp: in the probe the advisory count equals the plunges into stock in all five plunging cases.
- Of the probe's 16 programs (the seven reliefs above and a 5 mm hole too small to rough, each
  with and without the ramp), the five that plunge under a ramp each gain exactly that header
  line and are otherwise identical; the other 11 are byte-identical.
- Job Review's operation line is unchanged: it still reads `ramp entry 5°` for relief roughing,
  which records the ramp it cuts; the advisory lists the passes that plunge instead.
- Not changed: tiled output rebuilds clipped contour passes without the marker, so tiled relief
  roughing, like a tiled contour ramp (ADR-471), carries no plunge count.

### Verification

- `relief-roughing-motion.test.ts`: beside a ramped 20 mm square, only the chain on a 2 mm loop
  is marked, with the same motion it gets without a ramp; no marker without a ramp angle or where
  the slice top is the level's own depth.
- `compile-cnc-relief-entry-plunge.test.ts`: a 12 mm relief round a 6 mm hole, 3 mm deep, with a
  5 degree ramp. Both roughing passes are marked; the header's entry lines are exactly the ramp
  claim and `2 passes plunge`; the roughing section has two straight plunges at the plunge feed.
  Without a ramp nothing is marked or claimed and the motion is the same. The advisory names Ramp
  entry on an on-path layer and Roughing ramp on a V-carve layer, and is not a compile-integrity
  code. A layer's relief plunges are reported apart from its other passes.
- Against the code before this amendment, the four tests that check the marker, the header, the
  advisory and the grouping fail; the two that check for no marker pass either way.
- NOT verified: air cuts, material cuts, or any hardware. There is no machine for this project.
