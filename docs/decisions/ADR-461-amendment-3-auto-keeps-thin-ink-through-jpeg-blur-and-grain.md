## ADR-461 Amendment 3 - Colour layers Auto keeps thin ink that JPEG, blur or grain left barely flat (2026-10-28)

**Status:** Accepted on 2026-10-28 |
**Amends:** ADR-461 decision 2 (Auto's 0.2 % flat-area floor and its mixture test) and decision 6
(each colour's starting power comes from its own darkness, read from the label's mean colour)

### Context

Quality audit Q1, report Q5 (`docs/audits/2026-10-27-quality-q1/Q5-trace-real-images.md`),
finding **Q5-P2-2**, raised to **P1** by the refuter. Colour layers on Auto, the preset default,
dropped the black text of a flat-colour logo once the logo had been through an ordinary JPEG, a
slight blur or grain, and traced the text on another colour's layer. The text then burned at that
layer's power, and the dialog gave no warning.

- **Cause.** Decision 2 keeps an automatic colour only when it holds at least 0.2 % of the *flat*
  area, a flat pixel being one whose 4-neighbours are all within OKLab 0.05. That premise ("JPEG
  noise and paper texture stay below it") fails for thin dark ink:
  - OKLab stretches the darks: one sRGB step moves L by about 0.0045 near `#1e1e1e`, against
    0.003 near paper, and sRGB 0 to 5 alone spans L 0 to 0.115. JPEG's ringing inside a 4 px
    stroke therefore makes most of it non-flat.
  - A sigma 1 blur leaves no flat core in a 3 to 5 px stroke at all.

  In the auditor's logo, black's flat share fell from 0.633 % (clean) to 0.188 % (quality 60),
  0.115 % (quality 35), 0.136 % (sigma 12 grain) and 0.005 % (sigma 1 blur), under the floor.
- **Harm.** In the refuter's saturated logo (Arial 40 px text, 2.3 % of the image), every
  remaining layer started 1.2 to 1.45 times higher (the blue square 69.1 % to 100 %). In the pale
  logo (`#f5d76e`, `#8ec5ff`, black text), the text burned at 41.4 to 44.9 % instead of 100 %.
  This happened from JPEG quality 75 (the IJG default) down. A requested Colours count kept the
  text, because it clusters every pixel equally.
- **Promises.** The Colours hint says "Auto picks the colours the artwork really uses"
  (`ColourLayerTraceSettingsControls.tsx`), the swatch note says "Darker colours start at more
  power", and decision 6 sets power from each colour's own darkness.

### Decision

1. **A cluster under the flat-area floor is still a colour when it is distinct thin ink**
   (`colour-palette.ts`, `distinctLowFlatColours`). It is kept when all three hold:
   - counting every pixel at full weight, it covers at least 0.2 % of the image (the same floor,
     read over all pixels instead of flat ones);
   - it lies at least 64 sRGB bytes (Euclidean) from every flat-area colour. Closer, it is a
     shade of that colour: a JPEG overshoot, or grain piled up at black. The distance is measured
     in sRGB bytes rather than OKLab because JPEG and grain noise are even in bytes, while OKLab
     puts bytes 0 and 30 0.23 apart;
   - it is no edge blend of two colours among the flat-area colours and the other such clusters.
     A blurred stroke's ramp is a blend of the stroke's core and the paper, so the core is kept
     and the ramp is not.

   The edge-blend test is decision 2's mixture test (within 0.3 |ab| of the sRGB segment ab,
   strictly between its ends), plus one physical constraint. An edge blends its two colours in
   sRGB (on the segment) or in linear light, which is lighter because sRGB encoding is concave.
   So a colour lying darker than the segment, along the grey axis, by more than 0.1 |ab| is no
   edge blend. Without that constraint, a blurred thin black stroke's grey (`#474747` in the
   regression) sits inside the wide red-to-blue tube and is dissolved again.
2. **The rescue is additive.** The flat-area floor, the 3 % in-between dissolve and the 0.08 merge
   run exactly as before on the colours that pass the floor. Rescued colours skip the in-between
   dissolve, which tests a symmetric tube; they then take part in the existing Lloyd refinement
   and merges.
3. **A label's colour counts its interior pixels fully** (`colour-quantize.ts`,
   `interiorWeights`). For an automatic palette, a label's final colour was the mean of its pixels
   with non-flat pixels at a tenth. A pixel whose 4-neighbours all carry its own label lies on no
   seam, so it is its colour plus noise, not an edge mixture; it now counts fully. A blurred thin
   stroke then takes its colour from its core rather than its edge ramp, and decision 6's
   darkness, and so every other layer's starting power, follows. A requested count already
   counted every pixel and is unchanged.

### Consequences

Measured through the Trace dialog's public entry (`traceImageToColoredPaths` with the dialog's
option merge), main against this amendment:

| Scene | main | With this amendment |
|---|---|---|
| Auditor's logo, 480 x 264, five inks, text 2 %: q60, q50, q35, sigma 12, blur 1 | 4 layers, text on blue, blue 100 % | 5 layers, text 100 %, blue 65.8 to 67.1 % (clean 67.1 %); blur: text `#3b3b3b`, blue 80.5 %, subpaths 221 to 128 |
| Refuter's saturated logo: q75 to q35, blur 1, sigma 12 | 4 layers, blue 100 % | 5 layers, 93.7 to 96.3 % of the text on its own layer at 100 %, blue 67.1 to 68.4 % (clean 68.3 %); blur: 76 % |
| Refuter's pale logo: q75 to q35, blur 1, sigma 12 | text at 41.4 to 44.9 % | text 100 %, 95.5 to 98.5 % on its own layer; light blue 25.0 to 25.3 % (clean 25.1 %); blur: 28.1 % |
| Grey logo (`#969696`, `#c8c8c8`, `#141414` text): q75, q35, blur 1, sigma 12 | text on the grey layer at 66 to 68.7 % | text 100 % |
| Navy block and `#141414` text: q75, q35, blur 1, sigma 12 | text on navy; navy 100 % | text 100 %, navy 78.4 to 90.4 % |
| Thin red text on a blue and yellow logo: q60, blur 1 | red text on blue | red layer kept (90.7 %, 78.9 %) |
| 1.2 px black hairlines beside a blue block | on the blue layer even clean | own layer (`#292929` clean) |

Unchanged in layer count and subpaths: the astronaut photograph (512 x 512; clean, q35, sigma 12;
8 layers), the Arch House drawing (clean, q35, blur 1, sigma 12, photo-like), a white-to-navy
gradient (6 layers), bold black text at q75 and q35, and a large black area with a red disc at
every condition including sigma 20 grain and q10. Without the 64-byte shade rule, that last scene
gains a third, `#030303` layer from grain piled up at black, which then takes 100 % and drops the
real black to 90.6 %.

Label colours on noisy or blurred images move by a few sRGB bytes (Arch House `#204e6c` to
`#214b66`; the clean auditor logo's black `#1c1c1c` to `#1b1b1b`); clean flat art keeps its
colours. The time per trace is unchanged within noise (astronaut with grain 522 to 481 ms, Arch
House 132 to 139 ms, the auditor logo 60 to 65 ms).

Limits:

- **The eight-cluster budget.** Auto still clusters at most eight colours before any floor. When the
  artwork itself fills them, as with a radial gradient behind black text, a degraded thin ink that
  counts a tenth per pixel may win no cluster, and no rule here can keep it. The same happens to
  per-channel sigma 12 grain on navy art, which spends the clusters on tints of the paper. Setting
  Colours to a number clusters every pixel equally and keeps the ink.
- **A blurred stroke reads lighter than its ink.** Under a sigma 1 blur, the auditor's text reads
  `#3b3b3b` and the refuter's `#2f2f2f`, against `#1a1a1a` ink. It still starts at 100 %, but the
  other layers start up to 1.2 times higher than on the clean image (the blue square 80.5 % against
  67.1 %). 1.2 px hairlines under the same blur trace as `#8f8f8d`, so they now get their own
  grey layer at 66 % instead of the blue layer's 100 %.
- **Small marks.** With the text on its own layer, its boundary sits at its true half-coverage edge.
  At q75 to q50 the dot of the refuter's "i", a 4 x 4 px square, then falls under the Remove
  specks default (12 px) and is absorbed (3.4 px² of the text's interior); on the blue layer its
  looser boundary had kept it. This is the known small-mark trade-off of ADR-434 (Q4-P2-3), not
  the palette.

Tests:

- `colour-layer-thin-ink.test.ts` runs a flat-colour logo (yellow band, red disc, turned blue
  square, green triangle, and slanted "KERF LINE" in 3.2 px strokes, 1.5 % of the image) clean,
  through JPEG quality 75 and 60, a sigma 1 blur and sigma 12 grain.
  - **Assertions.** Five layers; at least 95 % of the text's core on one layer that covers none
    of the square; that layer at 100 %; the square under 90 %.
  - **On main.** All four degraded cases fail.
  - **Guards.** Bold black text after a blur and after JPEG quality 35 stays two layers: this
    fails without the edge-blend test. A large black area under sigma 20 grain stays two layers:
    this fails without the 64-byte shade rule.
  - **Mutation checks.** Removing the darker-than-segment constraint, or the interior weights,
    fails the blur case.
- `colour-layer-degrade.test-support.ts` supplies the degradations.
  - **JPEG.** A baseline JPEG round trip: JFIF YCbCr, 4:2:0 chroma with libjpeg's triangle
    upsampling, the 8 x 8 DCT, and the ITU-T T.81 Annex K tables with IJG quality scaling.
    Against libjpeg (sharp 0.35.5) on the auditor's logo it differs by a mean 0.35 to 0.42
    levels at quality 35, 60 and 75, with the same mean error against the clean image.
  - **Blur and grain.** A Gaussian blur, and seeded grain drawn once for R, G and B.
- The existing palette, alpha, detail, edge-case, seam, power and commit tests pass unchanged,
  including decision 2's guards against grain colours and anti-aliased mixtures.

These are software tracing checks against synthetic and degraded images, not a material burn.
