## ADR-488 - Admitted hairline loops keep a compact outline instead of the raw crack chain (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

Amends the tiny-contour fallback that the 2026-09-09 tracing remediation (TR-011) added to the
contour finishing tail of ADR-128. The finishing tail itself, trace routing, the area policy,
topology repair, G-code and the Frame-first contract are untouched.

### Context

`finishLegacyLoop` simplifies each smoothed closed ring with the preset's tolerance (0.45 px x
Optimize scale x pixel scale). Douglas-Peucker anchors a closed ring at its first point and the
point farthest from it. A sliver thinner than about twice the tolerance therefore reduces to those
two anchors, and the tail returns nothing. Examples are a 1 px diagonal hairline, a white 1 px slit
in black, and an anti-aliased line that thresholds to a thin sliver. TR-011 made `finishLoopSteps`
keep such an admitted loop rather than erase it, so the stroke survives. It keeps it as the raw
mid-crack chain at 0.5 px spacing.

The hairline probe (2026-09-27) measured the cost. A binary 1 px 45 degree line 80 px long traced
as one correct loop, but with 457 points in Smooth (the tolerance is 1.8 working px at 2x). A white
slit in black took 229 points in Smooth. In Sharp, an anti-aliased diagonal next to a square took
221 points: the square moves the threshold so that the band comes out thinner than twice Sharp's
0.217 px tolerance. The output was right in shape but 25 to 90 times the moves it needed, and
Optimize did nothing for these loops.

### Decision

- The fallback line in `finishLoopSteps` calls `admittedLoopFallback`
  (`src/core/trace/admitted-loop-simplify.ts`) in place of keeping the raw chain as it is. The
  helper still starts from the measured crack chain, so the stroke is never lost.
- Both caps are pinned. They are the chain's extremes along its long axis (the point farthest from
  the first point, then the point farthest from that one), with their ring neighbours. Each side of
  the sliver is then simplified on its own, and neither end can taper to a point. An accepted
  polygon must also have at least 4 distinct vertices.
- The tolerance steps down from the finishing tolerance in quarter-octave steps to 1/16, the same
  floor as the topology repair's four halvings. Whole halvings are too coarse. With a square beside
  a 1 px diagonal, Smooth's 2x sliver is beaded. Without pinned caps, the halvings jump from a
  collapsed polygon (2 points) to one that keeps every bead (228 points, 123% of the area). Only
  the 0.76 px step between them gives a band. With pinned caps, the full tolerance already gives a
  6-point band there. On a 30 degree hairline beside a square, the first area-true band is at a
  quarter step (22 points), where the nearest halving keeps 86.
- The first step whose polygon keeps the chain's area within 15% wins. Crack chains of these
  slivers are sawtooth or beaded, so their compact polygons swing by up to about a quarter of the
  area. For the clean 1 px 45 degree line at 2x, the best band holds 112% of the area.
- The polygon replaces the chain only when it has at most half the chain's points. Chains shorter
  than 32 points (16 px of crack boundary) always keep the raw chain. These are specks and dots that
  are already a handful of moves. Simplifying them saved about 6 points each on roughly 1000 owl and
  hummingbird dots, but cost 0.0005 IoU in Smooth. Every rejected case returns the raw chain exactly
  as before.
- The polygon is a `ContourRefinement` whose baseline is the raw chain. Topology repair refines it
  at finer tolerances, then falls back to the raw chain, then to the source, like every other loop.
- The fallback serves every route by which the tail returns nothing. These are: `finishLegacyLoop`
  simplification below 3 points, `finishLegacyLoop` straight-run flattening below 3 points, and
  `fitLoopTail` below 3 points on measured loops (with the legacy tolerance). Including all three
  is deliberate. Each one used to keep the same raw chain, with the same bloat. On the 228-trace
  corpus below, all 10,510 fallback calls came through the first route. None came through
  flattening, the fit tail or the finish without rebuilt corners.
- Loops that the finishing tail completes never reach this code, so their output is unchanged.
  `contour-trace.ts` takes its `MIN_LOOP_POINTS` from the helper's exported constant. The helper
  lives in its own file, with a one-line call site, because other in-flight branches edit
  `contour-trace.ts`.
- Rejected alternatives:
  - Retrying inside `finishLegacyLoop`. It simplifies the already-smoothed chain, then resamples a
    spline at the full tolerance. On thin-bars in Smooth this cut IoU from 0.6495 to 0.6397.
  - The plain whole-halving ladder without pinned caps. It accepted 3-vertex wedges: a 52 degree
    hairline beside a square came out as a triangle holding 92% of the area. It also missed the
    beaded diagonal entirely.
  - A symmetric-difference bound. Beaded and pixel-stepped chains wiggle by as much as their own
    width, so even the straight band that matches the source line differs from the chain by 60 to
    90% of its area.

### Measurements

Serialised-trace hashes (SHA-256 of the traced paths, plus a hash per loop) were taken before
(a10013827) and after. They cover every analytic bake-off fixture and variant plus the owl and the
hummingbird, in Line Art, Smooth, Sharp and Edge Detection: 228 traces. 219 are byte-identical and
9 differ. An instrumented copy of the helper counted 132 accepted polygons, all in those 9 traces.
The per-loop diff shows the following:

- Every loop that left the output was the raw chain of an accepted fallback. No other loop changed,
  so no neighbour was backed off because of a new polygon.
- 131 accepted polygons reached the output. 123 are at the tolerance the ladder found. 8 were
  refined finer by topology repair (5 in hummingbird Smooth and 3 in owl Smooth).
- 1 accepted polygon, in hummingbird Smooth, crossed a neighbour. Topology repair backed it off to
  its baseline, which is the raw chain, so that loop is byte-identical to before.
- No trace changed without an accepted polygon, and no trace with an accepted polygon kept its old
  hash.

Point totals: owl Smooth 226649 to 225769, hummingbird Smooth 179425 to 176291, thin-bars clean
Smooth 866 to 422.

Bake-off (P-default, O-default, O-smooth, O-sharp), before against after. The runs covered the
hairlines, thin-bars, small-features, text-small and text-lowres families, the calibration, the owl
and the hummingbird. Only these rows changed. Sharp is unchanged everywhere, and so is the hairlines
family: none of its loops reach the fallback with 32 or more points.

| Fixture, preset | G1 segments at 0.1 px | IoU | Mean deviation (px) |
|---|---:|---:|---:|
| calibration pixel-aligned upscaled, Smooth | 249 to 15 | 0.99475 to 0.99475 | 0.0719 to 0.0719 |
| thin-bars clean, Smooth | 846 to 402 | 0.64952 to 0.64964 | 0.6460 to 0.6457 |
| thin-bars scan, Smooth | 906 to 469 | 0.61078 to 0.61049 | 0.7632 to 0.7640 |
| small-features clean, Smooth | 397 to 169 | 0.98635 to 0.98635 | 3.4928 to 3.4931 |
| small-features scan, Smooth | 440 to 228 | 0.98930 to 0.98929 | 2.3223 to 2.3224 |
| owl, Line Art | 230206 to 230142 | 0.90501 to 0.90502 | 0.25478 to 0.25478 |
| owl, Smooth | 178344 to 177464 | 0.87869 to 0.87861 | 0.32455 to 0.32470 |
| hummingbird, Line Art | 177949 to 177924 | 0.86163 to 0.86163 | 0.37846 to 0.37846 |
| hummingbird, Smooth | 133730 to 130596 | 0.87683 to 0.87660 | 0.30615 to 0.30663 |

p95 deviation is unchanged within 0.0001 px on every row. Hausdorff distance is unchanged except on
the upscaled calibration, where it goes from 0.318 to 0.320 px. Spurious and missed contour counts
are unchanged.

The committed synthetic tests in `admitted-loop-simplify.test.ts` cover the probe's three cases,
plus the binary diagonal beside a square in Smooth and a 52 degree hairline beside a square. In the
probe's geometry the loops went from these raw-chain counts to these polygon counts:

- binary diagonal in Smooth: 465 to 9
- the same diagonal beside a square: 465 to 7
- 52 degree hairline beside a square: 457 to 7, with both ends keeping at least 2 vertices
- 30 degree hairline beside a square: 445 to 23
- slit: 233 to 7
- Sharp anti-aliased diagonal beside a square: 221 to 7

Each loop's span along its line is unchanged to four decimal places, because the caps are pinned.
The two beside-a-square tests fail on the first version of this change.

### Consequences

- 1 px hairlines, slits and thresholded anti-aliased slivers now cost a handful of moves instead of
  hundreds, and the file size and G-code shrink with them.
- Trade-off, accepted: a few Smooth rows lose a little accuracy. Thin-bars scan loses 0.0003 IoU
  and gains 0.0008 px mean deviation. The hummingbird loses 0.0002 IoU and gains 0.0005 px. The owl
  loses 0.0001 IoU and gains 0.0002 px. The compact bands follow the source line, not every stair
  and bead of the crack chain.
- These loops are straight-segment polygons whose vertices lie on the measured boundary. They get
  none of the preset's smoothing, just as the raw chain got none. A beaded 2x sliver comes out as a
  straight band. That band is narrower in across-extent than the beads (0.94 against 1.55 px for
  the 52 degree hairline) and has the same area within 15%.
- Not addressed here: the 2x supersample route still beads binary 30/60 degree hairlines (Line Art
  105/97 points against 21/25 on the native grid), and a hairline attached to broad ink still loses
  width in the tail (ADR-403 remaining gaps). Both need changes to the supersample route or a
  width-aware finishing tolerance, not to this fallback.

### Amendment 1 - No admitted loop is dropped: the no-orphan invariant (2026-09-27)

**Context.** Item 3 of the clean-room Potrace study's action plan asks for this invariant. The
reports describe Potrace's only drop rule, which removes a path by enclosed area. A nested path
encloses strictly less area than its container, so every dropped path takes its whole subtree
with it, and no surviving path is ever orphaned (report R1 sections 2.5 and 2.6, idea level only;
no Potrace source was read). Our contour lane has more stages than one area rule. If any of them
lost an admitted outer while its hole survived, the hole would paint as ink under even-odd and
nonzero fill alike. The audit of this branch found these places where an admitted loop could
vanish:

- The area gate in `contourPolylinesFromMaskSteps`. It compares each loop's enclosed lattice area
  with `minAreaPx`, so it is monotone down the nesting, the same property as the reports' rule.
  One gap: with `minAreaPx` = 0, a loop enclosing nothing would pass it. The walker never produces
  one.
- `finishLoopSteps`. Since TR-011 and this ADR, a tail that returns nothing falls back to the crack
  chain. One `null` remained: a staircase under 3 points. The walker never produces one either, but
  the call site still filtered `null` out and so could drop a loop silently.
- Topology repair. It returns one ring per contour, and a ring whose orientation differs from its
  source is a conflict that backs off to the source. It never drops a ring.
- Later stages. The SVG serialiser drops closed rings under 3 points or with an area of 1e-6 or
  less. An admitted loop never gets that small, because topology repair gives any zero-area ring
  its source back. Edge Detection drops rings by length, but its rings are stroked, not filled.

**Decision.**

- `isAdmittedLoop` (in `contour-trace.ts`) is the area gate: a loop is admitted when it encloses a
  non-zero area of at least `minAreaPx`. Dropping by this rule removes a loop together with
  everything nested inside it.
- `finishLoopSteps` is total. It returns a finished contour for every admitted loop and never
  `null`: the staircase guard is gone, and every empty tail already goes to the crack-chain
  fallback above. The call site pushes every result.
- `contour-no-orphan.test.ts` checks the invariant, "one loop out per loop in", through
  finishing, the fallback and topology repair. It uses five synthetic nests: an outer with two
  holes, an island in a hole, a 3 px band around a 1 px slit, 1 px concentric rings three deep, and
  a 1 px diagonal ring. Each nest runs at 1x with ink or paper connected at saddles and at 2x, and
  at tolerances from 0.1 to 6 px. The coarse tolerances collapse every sliver to the fallback. For
  each admitted loop, the test checks that exactly one closed ring comes out, in loop order, with
  the source orientation and the source nesting depth, and that the orphan count is 0. It also
  checks that the gate never admits a loop without every loop enclosing it, and it checks that
  depth parity equals orientation in Line Art, Smooth and Sharp traces of the same nests.
- `contour-no-orphan-measured.test.ts` runs the same check on the measured (sub-pixel) finishing
  tail, which the nests above never reach: they are painted at two grey levels, so their cracks
  carry no sub-pixel information. It traces an anti-aliased ring around a disc (outer, hole,
  island) with a crack field, so every loop is finished by the cubic fit. It passes a fine fit, a
  coarse fit (tolerance scale 400) and a fit that returns no cubics at all, and checks one ring per
  loop with the source orientation and depth.

**Measurements.**

- Mutations, each run against the new test:
  - dropping the loops that reach the fallback (the pre-TR-011 behaviour): 26 cases fail;
  - topology repair dropping one ring: 64 fail;
  - a gate that admits holes (or outers) at a quarter of the area: 1 and 2 fail;
  - admitting zero-area loops: 1 fails;
  - dropping a measured loop whose fit collapsed: the measured test fails (1 case), and the
    two-level nest test does not notice it, which is why the measured test exists.
- **No reachable orphan existed on the base commit (f0b28de20).** This amendment hardens and pins
  an invariant the base already held; it does not fix a live defect. The only case that fails on
  the base is the unit test of the gate rule for a zero-area loop, which the walker never produces.
  Every behavioural case passes there, because the fallback above already covered every reachable
  collapse. The mutations above show that the test does guard the invariant.
- Orphan census (rings whose orientation disagrees with their depth parity), before and after:
  **0 in all 39 contour rows**. The rows cover the analytic set, noise192, five edge shapes, the
  owl and the hummingbird in Line Art, Smooth and Sharp. The owl Sharp trace has 10,870 rings.
- ADR-438-style parity hashes, before and after: **78 of 78 byte-identical**. That is 13 cases
  (the five analytic fixtures, noise192, five edge shapes, the owl and the hummingbird) in all six
  presets, serialised canonically with curves and hashed. The oracle was an off-tree scratch
  harness, not committed, modelled on ADR-438's trace-parity approach: a vitest file that traces
  each case in each preset, hashes the canonical serialisation, and compares it with a recorded
  base file. It ran as `NO_ORPHAN=1 NO_ORPHAN_HEAVY=1 npx vitest run --maxWorkers=2
  <harness>.test.ts`, first with `NO_ORPHAN_RECORD=1` on the base and then without it on this
  change. A later reviewer cannot re-run it from this commit; once the ADR-438 parity test lands,
  it is the reproducible check.

**Consequences.**

- The invariant is now stated in the code and pinned by a test, rather than holding by accident.
  Corridor finishing (action-plan item 13) must keep it.
- Scope: the invariant covers the binary contour lane only (`contourPolylinesFromMask`, called by
  the contour and Edge Detection traces). The multi-colour lanes (`colour-layer-trace` and the
  legacy imagetracerjs lane in `trace-to-paths.ts`) and the Region Enhance merge (ADR-113/435) are
  unaudited. Region Enhance keeps or drops each subpath on its own, by box containment
  (`region-merge.ts`), without looking at nesting. So when a re-trace's topology differs from the
  original, for example an outer re-traced across the box border by more than 1 px, a hole could
  keep its re-traced copy while its outer is dropped. That risk predates this ADR and was not
  reproduced end to end; making the merge treat an outer and its holes as one unit is a follow-up.
- Not addressed here: the artwork exporters (ADR-468). Their PDF and EPS
  writers paint every closed ring of a painted item as one compound path under the item's fill
  rule. Their GeoJSON writer groups holes by geometric containment. Neither groups by list order.
  One GeoJSON caveat is recorded for that branch: a ring that collapses on the export grid is
  dropped before nesting.

### Amendment 2 - on top of the compact-curve contour tail (2026-09-27)

Merged onto ADR-439..441, the fallback keeps its place (`retainCracks` in `finishLoop` calls
`admittedLoopFallback`), but Smooth's 2x hairlines are sub-pixel informed and now finish through the
compact cubic fit (ADR-482), which does not collapse them, so the fallback is not reached on these
cases. A ring's cost is therefore counted in its canonical curve's segments, not its polyline (only a
sampling of the curve): the 1 px diagonals are 4 to 6 segments. The 52 degree hairline beside a
square costs 57 cubics (the raw-crack chain it replaced was 457 moves) and keeps both ends; its test
bound is 64 moves, a pin on today's cost rather than the < 40 this ADR measured on the legacy tail.
These are canonical-curve segments, not G-code moves: compilation flattens each cubic to G1 chords
within `DEFAULT_MACHINE_CURVE_TOLERANCE_MM` (0.025 mm, `compilationPolylines`), or arc-fits it (ADR-432),
so the machine move count of a ring depends on its placed size and is at least its segment count.
