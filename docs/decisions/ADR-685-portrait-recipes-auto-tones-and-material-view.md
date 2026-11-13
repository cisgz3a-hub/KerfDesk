## ADR-685 - Portrait recipes, Auto tones and a material view in Photo engraving

**Status:** Accepted; code, unit, compile and perceptual evidence only. No material was engraved and
no controller was operated. | **Date:** 2026-11-01

### Context

The maintainer asked for realistic portrait burns, an audit of the current photo tools and a look at
how other software does it.

**Other software.** LightBurn ([Image Mode](https://docs.lightburnsoftware.com/legacy/UI/CutSettings/CutSettings-Image),
[Shape Properties](https://docs.lightburnsoftware.com/latest/Reference/ShapeProperties/)) offers
dithers, gamma/brightness/contrast and Enhance (unsharp mask with denoise) per image, and says the
ideal line interval gives "lines that just touch, without overlapping"
([Working With Images](https://docs.lightburnsoftware.com/2.1/Collections/WorkingWithImages/)).
It has no material presets for photos. ImagR ([Material Presets](https://imag-r.com/toolset/materialpreset))
and PhotoGrav ([Concepts](https://documentation.help/PhotoGrav-3.0/ug_append_4.htm)) are built
around a material choice: it sets polarity and mirroring (ImagR: invert for black slate, painted tile
and anodized aluminium; mirror and invert for acrylic and glass; no change for wood, cork, leather and
white tile), applies tuned tone processing, and PhotoGrav simulates the burn on the chosen material.
Their tuned parameters are not published and are not copied.

**Audit of KerfDesk's tools.** `src/__fixtures__/perceptual/portrait-burn-view.ts` compiles the
astronaut's head (192 x 192 px, 1:1 at 10 lines/mm) through the shipping compiler, draws each mark
as a round dot and scores what a viewer sees (1.2-cell Gaussian) against the photo's linear light,
in CIE L*. Burned material is black and the surface white; a material's own darkening is ADR-670's
tone calibration. Results (`_portrait-burn-audit.test.ts`, `PORTRAIT_AUDIT=1`):

| Dither | Ideal 1-cell marks: bias / error | 1.6-cell spots: bias / error | Detail | Highlight speckle |
| --- | ---: | ---: | ---: | ---: |
| Blue Noise | +15.3 / 15.3 L* | -0.4 / 2.2 L* | 0.923 | 12.5% |
| Floyd-Steinberg | +15.3 / 15.3 | -0.5 / 2.5 | 0.908 | 12.8% |
| Stucki | +15.2 / 15.2 | +0.4 / 2.9 | 0.877 | 11.9% |
| Jarvis | +15.1 / 15.2 | +2.1 / 3.2 | 0.881 | 11.8% |

"Detail" is the correlation of the fine band (blur 1.2 minus blur 4 cells) with the photo's;
"highlight speckle" is the share of highlight cells (source luma 215 or more) that burn a dot. A 1.6-cell spot is the
4040's 0.16 x 0.18 mm spot on a 0.1 mm interval (ADR-670).

Findings:

1. The dots are placed well. With realistic spot spread every photo dither lands within 2 L* of the
   photo on average, and Blue Noise holds the most detail. Gamma above 1 only lightens further
   (Jarvis bias +9.1 L* at gamma 1.4).
2. What spoils realism is speckle. About one highlight cell in eight burns a lone dot, and a spot
   wider than its cell turns those into visible freckles on skin and background.
3. The dialog could not show either effect. Its preview draws each mark one cell wide in black and
   white, so the darkening from spread, and the speckle, are only seen after burning. With a tone
   calibration it looks lighter still, because it shows fewer dots without their spread.
4. Every choice is made from scratch: marking, dither, tones, sharpening.

### Decision

1. **Auto tones** (`core/raster/portrait-auto-tones.ts`). A button in Photo tones sets brightness,
   contrast and gamma from the photo's histogram, in the existing controls' conventions
   (`luma-adjust.ts`), so no field, schema, compile or emitter change is needed. The darkest and
   lightest 0.5% of the counted pixels become solid and blank (a linear stretch, capped at the
   contrast control's 2x). Gamma then returns the median tone to where it was. Pure white (255) is
   not counted, because a removed or transparent background imports as white and would hide the skin
   highlights. A photo with no spread of tones gets no change.
2. **Material recipes** (`ui/raster/photo-recipes.ts`). A **Material recipe** list at the top of
   Photo engraving: wood, leather or cork, white tile or coated metal (dark marks), black slate or
   stone, black anodized aluminium or painted surface, and clear acrylic or glass from the back.
   A recipe sets the marking (light marks for slate, anodized, painted and back-engraved clear
   material, after ImagR's rules), Blue Noise (finding 1), Auto tones and ADR-671's suggested light
   sharpen (30% at 0.7 lines). For clear material it says to flip the photo horizontally on the
   canvas. The window never changes placement (ADR-581 Decision 7). A recipe sets no power, speed,
   DPI or tone calibration. Those depend on the machine and material (ADR-581 Decision 2), and a
   calibration whose marking no longer matches is flagged as before (ADR-670). Recipes are not saved;
   Apply writes the resulting settings exactly as hand-set ones.
3. **On material preview.** The preview gains a **Dots / On material** view; choosing a recipe
   turns it on. On material draws each compiled mark as wide as the laser spot
   (`core/raster/beam-spread.ts`), in the recipe's surface and mark colours. The spot is the machine
   profile's `laserSubProfile.spotSizeMm`, drawn round at the geometric mean of X and Y, over the
   compiled cell size. Each cell is split into up to 3 x 3 sub-cells, and the spread work is capped
   at 120 million kernel steps. A sub-cell keeps the product of (1 - mark x share) over every spot
   that reaches it. The spread runs at full compiled resolution before the display reduction, so a
   solid field stays solid. A Grayscale mark spreads in proportion to its power. Without a known spot,
   marks are drawn one cell wide and the note says so. The worker computes this only when asked,
   and budgets 12 more bytes per display pixel for it. The dot view, compile, output and Job Review
   are unchanged.
4. **Spot-size DPI hint.** When the profile knows its spot, the resolution section names the
   interval where lines just touch (the spot's Y size, as LightBurn describes it). If the chosen
   interval is finer, it says each dot overlaps its neighbours and points to Interval Test.
5. The worker adds the source's 256-level histogram to every preview result (1 KB, transferred).
   Auto tones uses it, so the main thread never decodes the photo.
6. The guide now says that Blue Noise holds the most facial detail in these measurements, with
   Jarvis and Stucki as alternatives.

### Measured effect

Auto tones on the astronaut's head computes brightness 5.7, contrast 12.8, gamma 0.64. With
1.6-cell spots:

| Dither | Highlight speckle, before -> after | Bias, before -> after | Detail, before -> after |
| --- | ---: | ---: | ---: |
| Blue Noise | 12.5% -> 3.6% | -0.4 -> -1.2 L* | 0.923 -> 0.921 |
| Jarvis | 11.8% -> 1.9% | +2.1 -> +0.9 L* | 0.881 -> 0.902 |

The trade is deliberate and stated. Mean error against the photo rises from 2.2 to 6.1 L* (Blue
Noise) because Auto tones stretches contrast. Lighter tones go blank and darker tones solid, which
is what clears the speckle and gives a material with less range than a screen more punch. That is
why Auto tones is a button and part of a recipe, never a default. Whether it reads better on a given
wood or slate is a burn test.

Beam-spread model against exact supersampled round dots on the same face (mean |delta L*|):

| Spot | 1 sub-cell | 2 | 3 |
| --- | ---: | ---: | ---: |
| 1.6 cells (Blue Noise / Jarvis) | 2.88 / 1.86 | 0.96 / 0.66 | 0.50 / 0.38 |
| 2.3 cells | 7.96 / 4.12 | 1.49 / 1.10 | 1.16 / 0.93 |
| 3 cells | 3.38 / 3.26 | 0.84 / 1.06 | 0.67 / 0.84 |

One sub-cell treats spots that meet in a cell as independent and underestimates darkening. Three
sub-cells stay within about 1.2 L* of exact. A simpler model on the averaged display tone,
`1 - (1 - c)^area`, was rejected: it assumes random dot positions, so it shows a solid fill about 13%
short of solid.

### Verification and limits

- `portrait-auto-tones.test.ts`: tails become solid and blank in the shipping tone curve, monotonic,
  median held, pure white ignored, stretch capped, a full-range photo nearly unchanged, empty or flat
  histograms declined.
- `beam-spread.test.ts`: spot area, blank stays blank and solid stays solid, a lone dot reaches its
  neighbours, a 50% checkerboard burns darker than half, Grayscale proportionality, rows emitted
  once and in order.
- `photo-material-preview.test.ts` and `photo-engraving-preview-worker.test.ts`: histogram counts and
  transfer, material view only on request, darker than the dot view on the same grid with a known
  spot, one-cell marks and the notice without one.
- `PhotoEngravingDialog.recipes.test.tsx`: a slate recipe applies light marks, Blue Noise, auto
  tones and sharpening and turns the material view on, a recipe leaves DPI, power and speed
  unchanged, the clear-material recipe asks for a horizontal flip, and Auto tones waits for the
  preview and leaves dither and marking alone.
- `raster-portrait-burn.test.ts`: the measured speckle, tone and detail effects of Auto tones, the
  spread model against exact dots, and Blue Noise against Jarvis, through the shipping compiler.
- `e2e/photo-engraving-recipes.e2e.ts`: in the browser, Auto tones becomes available, the wood
  recipe sets Blue Noise, tones and sharpening and draws the preview in wood colours, the slate
  recipe sets light marks, and Apply closes with no page errors. The existing
  `photo-engraving.e2e.ts` still passes.

The material view models geometry, not chemistry. Wood grain, char, heat build-up, a spot that is
not round, or a profile whose spot size is wrong all change a real burn. The recipe colours are a
display guide. Frame, Start, power, speed, the compiler, the emitter (`EMITTER_REVISION`), Job
Review, licences and output policy are unchanged.

**Amendment 1 (2026-11-02):** [a recipe's Auto tones wait for the preview, read only the pixels
that burn, and light marks say how to keep a background](ADR-685-amendment-1-recipe-tones-wait-for-the-preview.md):
fixes rolling audit v9 R8-P2-3, R8-P3-1 and R8-P3-2.

**Amendment 2 (2026-11-12):** [Auto tones round toward the clip](ADR-685-amendment-2-auto-tones-round-toward-the-clip.md):
fixes Oracle audit O6-P3-2.

**Amended by [ADR-711](ADR-711-photo-test-card-finds-power-and-speed.md) (2026-11-13):** a recipe
still sets no power or speed, but the window can now apply the power and speed the operator
picked from a burned Photo Test Card.
