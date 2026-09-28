## ADR-534 - Sub-pixel edges on the alpha route and Cutoff > 0 bands (2026-09-27)

**Status:** Accepted | **Date:** 2026-09-27

Amends the sub-pixel crack field of ADR-128 for the two routes that had none: Trace Transparency
(the alpha route) and brightness bands with Cutoff > 0. It uses the walker-only crossing hook of
ADR-533, so the mask, cleanup and topology are unchanged. Opaque sources on the default band
(Cutoff 0) keep their field unchanged and trace to the same bytes.

### Context

`crackFieldForTrace` returned null wherever no single iso-line exists: the alpha mask and any band
lo <= luma <= hi. The walker then puts every vertex at the crack midpoint, so these traces fall back
to binary accuracy. A disc cut out by alpha, or either edge of a band ring, measured about 0.24 px
vertex RMS at the crack-chain layer, against about 0.055 px where a field exists (backlog item G1a).

### Decision

1. **Band crossing** (`crack-iso-levels.ts` `bandCrossing` / `bandCrackField`). Ink is a band. Each
   crack takes the band edge its paper sample lies beyond: paper above hi crosses at hi, and paper
   below lo crosses at lo with the polarity reversed. A crack whose ink sample lies outside the band
   (a cleanup flip) keeps the midpoint. A crack cannot straddle both edges and still be a band crack,
   so no crossing is ambiguous. Saturated steps keep the midpoint, and t is clamped to 0.1-0.9, as
   on the threshold route.
2. **No level for saddles.** A band has no single level, so `thresholdAt` is NaN. The saddle decider
   then settles every corner on the mask alone, exactly as it did with a null field. Cleanup still
   receives no field on these routes.
3. **Alpha route** (`walker-crack-field.ts` `alphaBandField`). The alpha mask is the band cut of
   255 - alpha, with the same Cutoff/Threshold, so the same band crossing applies to that plane.
   With Cutoff 0 and Threshold 128 the level is 127.5-128: 50% alpha coverage for fully opaque
   ink. Semi-transparent ink crosses at alpha 127, not at half of the ink's own alpha, so its edge
   sits inside the ink. On an alpha disc r=40 whose ink alpha peaks at 200 (Sharp, crack-chain
   layer), mean bias moves from -0.136 to -0.170 px while RMS improves from 0.271 to 0.182 px; a test
   records it. Reading a local alpha plateau, as ADR-533 does for luma, would fix this and is left
   open.
4. **Luma bands** (Cutoff > 0) get `bandCrackField` on the leveled luma the band was cut from.

### Measurements

Crack-chain layer, vertex radial error against the analytic edge (bias / RMS px), base a10013827
-> this change. The fixtures are synthetic, 8x8 supersampled coverage (`crack-iso-levels.test.ts`):

| fixture | base | now |
| --- | --- | --- |
| alpha disc r=40, Sharp, Trace Transparency | -0.0133 / 0.2404 | -0.0021 / 0.0546 |
| band ring 255/105/15, Cutoff 60, Threshold 180: outer edge | 0.0010 / 0.2430 | -0.0003 / 0.0548 |
| same ring: inner edge (reversed polarity) | -0.0352 / 0.2409 | -0.0087 / 0.0557 |

Final-polyline disc bias on the alpha route: 0.048 / 0.079 -> -0.006. Final-polyline vertex RMS
(about 0.11-0.14 px on every preset) comes from the finishing stages, which this change does not
touch.

### Bake-off

Opaque default-band sources are byte-identical: all 63 O-default (Line Art) output files match
base a10013827 by sha256 on owl, hummingbird and the analytic set. The bake-off has no alpha or
Cutoff > 0 contestant. The synthetic fixtures above are the measure for this route.

### Consequences

- Transparent cut-outs and Cutoff > 0 band traces get the same edge accuracy as threshold traces.
- Two tests that asserted a null alpha field now assert the intended field
  (`faint-line-recovery.test.ts`, `trace-image-auto-detail.test.ts`). The faint-line test checks
  that both preparations carry the alpha band field (thresholdAt NaN) and the same crossing on
  every edge crack of a fixture with a transparent margin and a soft alpha column.
