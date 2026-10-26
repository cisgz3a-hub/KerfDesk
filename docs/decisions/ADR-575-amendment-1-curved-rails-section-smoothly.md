## ADR-575 Amendment 1 - Curved rails are sectioned along a smooth normal (2026-10-23)

**Status:** Accepted. | **Date:** 2026-10-23

This amends ADR-575's `retained-relief-v2` rail strips. It fixes CNC audit v1 finding F6-P3-3
(`docs/audits/2026-10-23-cnc-v1/F6-cnc-relief-3d.md`), which the refuter raised from P3 to P2. No
Frame, Start, output or licence gate is added or removed.

### Context

A single-rail sweep is sectioned at stations: the sampling steps plus every rail vertex and
profile position. Each station's section ran square to the rail segment it lay on, or along the
bisector exactly at a vertex. Near a vertex of a curved rail, within about (w/2)·tan(turn/2), the
inner ends of neighbouring sections then crossed. A rail that turns no tighter than half its width
is single-valued, and the R07 plan (`docs/audits/2026-10-08-cnc-leaders/BUILD.md`) rejects only
folded or multi-valued sweeps. Ordinary rails were still refused as "not single-valued", or as
"folds or collapses", at the shipped 32 sampling steps:

- the app's own four-point curve at widths of 1 to 3 mm;
- quarter arcs of radius 10, 30 and 50 mm at 4, 6 and 10 mm wide, with most chord counts;
- a sine rail whose tightest radius is 8.1 mm, at 6 mm wide.

Changing Sampling steps did not reliably help. A rail vertex a rounding error from a sampling
station (t = 0.75000000000000011 beside 0.75) left a strip with no length, which refused even a
straight rail.

### Decision

1. **Accepted rails keep their sections.** The v2 construction runs first. Every rail it accepts
   keeps the same stations, sections and strips, so every saved v2 field still composes to the
   same values. This keeps ADR-575's load-time proof for retained documents unchanged. v1
   documents keep their historical interpreter, with no fallback.
2. **A refused rail is sectioned smoothly.** If v2 refuses a rail, it is built again. Stations
   closer than 1 µm along the rail merge into one, keeping the rail's ends. Each single-rail
   station's section runs along a smooth normal: at a vertex it halves the turn between the two
   segments, and along a segment it turns evenly between its ends' normals. This reads the rail as
   the smooth curve its points sample. Two-rail sweeps keep their rail-to-rail sections and only
   merge stations. The strip injectivity, orientation and boundary checks are unchanged and still
   decide.
3. **A real fold says why.** If the smooth construction is refused too, the error keeps its
   reason and adds the cause. For one rail: it turns tighter than half its width, or passes within
   its width of itself, so narrow the rail or ease the curve. For two rails: they cross, or one
   turns back on itself.

### Consequences

- Ordinary curved rails, such as the audit's arcs, curve and sine rail, are accepted at the
  default 32 steps, and at 16 and 64. Across a vertex the section runs exactly along the turn's
  bisector.
- Which construction a rail gets depends on whether v2 accepts it, so changing Sampling steps can
  move a rail from one to the other. Both are single-valued sweeps of the same rail. A section's
  ends differ between them by at most half the width times the sine of half the turn at the
  neighbouring vertex.
- An earlier build composes a rail with v2 alone. A saved document holding a rail that only the
  smooth construction accepts is therefore rejected when an earlier build loads it.
- Profile heights, width scaling, the 256-station budget and every CAM path are unchanged.

### Verification

- `relief-rail-arcs.test.ts`: radius 10 quarter arcs 4 mm wide in 7, 9, 16 and 31 chords are
  accepted at 16 and 32 steps. At an inner vertex, the height across the section is the profile's,
  to 1e-6 mm, at the centre line and 1 and 1.5 mm off it. The app curve is accepted at 1–3 mm wide
  and 32 steps. Radius 30 and 50 arcs, and the 8.1 mm sine rail at 4 and 6 mm wide and 32 and 64
  steps, are accepted. The audit's 37.3 mm straight rail with a vertex beside a station is
  accepted. A radius 1.5 arc 4 mm wide and a hairpin are refused, with the cause in the message.
  With the smooth construction disabled, every acceptance test fails.
- `relief-rail-authoring.test.ts` and `relief-rail-bilinear.test.ts` pass unchanged: crossing
  rails, folded and collapsing bilinear strips and non-graph profiles are still refused, with
  their reasons.
