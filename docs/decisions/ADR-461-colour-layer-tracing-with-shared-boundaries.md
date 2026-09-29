## ADR-461 - Colour layers: trace colour artwork into one layer per colour with shared edges (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This adds a Trace Image preset. Every existing preset, and the Frame-first contract (PROJECT.md
non-negotiable 21, ADRs 228, 230, 232 and 237), are unchanged: a Colour layers trace reaches Frame,
Job Review and Start as ordinary filled vector artwork on ordinary operations.

### Context

Potrace 1.16, the tracer LightBurn licenses, traces a two-valued bitmap, and LightBurn's Trace Image
produces one outline set from a brightness threshold. Neither splits colour artwork into colours.
Other laser and CNC tools do: xTool Creative Space offers layering by colour with a power per layer,
Vectric reduces an image to a small palette, and Inkscape's multi-scan traces once per quantised
colour.

KerfDesk had only imagetracerjs's adaptive multi-colour mode, reachable through the API
(`numberOfColors` above 2 with no fixed palette) but from no preset. Measured on three touching
rectangles (red, green, blue on white, 60 x 40 px) with `numberOfColors: 4`:

| Input | Ink layers found | Subpaths | Overlap between colours | Gap inside the art |
|---|---|---|---|---|
| Hard edges | 2 of 3 (one colour lost) | 2 | 0 px² | 51 px² |
| Anti-aliased edges at quarter-pixel positions | 2 of 3 | 2 | 0.94 px² | 24.75 px² |

Tracing each colour separately, as Inkscape and imagetracerjs do, cannot give neighbours one edge:
each side of a boundary is traced and smoothed on its own, so the two outlines disagree by up to the
tracer's tolerance, leaving slivers of bare material or double burns along every seam. On the owl
drawing (1254 x 1254 px) the mode took 14 to 19 s and emitted 80,860 subpaths.

### Decision

1. **Preset.** A visible `Colour layers` preset (`core/trace/trace-presets.ts`) selects a dedicated
   backend through `TraceOptions.colourLayers` (`isColourLayerTrace`, dispatched with Photo shading
   by `dedicatedTraceSteps` in `core/trace/dedicated-trace-backends.ts`). Its dialog controls
   (`ui/trace/ColourLayerTraceSettingsControls.tsx`) are Colours (Auto or 2 to 8, counting the
   paper), Layers (Cut-out or Stacked), Trace background colour, Remove specks, and a swatch
   preview of the traced colours with each operation's starting power. Boundary Enhance is not
   offered, as for Photo shading: it replaces whole contours, while colour regions share edges.
2. **Palette** (`colour-oklab.ts`, `colour-palette.ts`, `colour-quantize.ts`). Pixels are compared
   in OKLab (B. Ottosson, "A perceptual color space for image processing", 2020), so distance
   approximates visible difference. Weighted Lloyd k-means (S. Lloyd, "Least squares quantization in
   PCM", IEEE Trans. Inf. Theory 28(2), 1982) runs over a 15-bit colour histogram, seeded
   deterministically by weighted farthest-point selection. A pixel whose 4-neighbours differ by
   more than 0.05 is an anti-aliasing or texture mixture, not a colour, and counts a tenth as much
   (the observation Kopf and Lischinski make for pixel art in "Depixelizing Pixel Art", ACM TOG
   30(4), 2011).
   - **Auto** clusters up to 8 colours, keeps only colours holding at least 0.2 % of the flat area,
     dissolves a colour with under 3 % of the flat area that lies on the sRGB mixing line of two
     others (an edge blend), and merges colours closer than 0.08.
   - **A requested count** clusters every pixel equally and merges only duplicates closer than 0.05.
   - **Alpha appearance (2026-09-27 correction).** Colour layers compare visible sRGB over white.
     Straight RGBA is composited once; decoder-tagged `rgbCompositedOnWhite` pixels already contain
     that appearance and are not composited again. Every nonzero-alpha pixel participates, so the
     former alpha-128 cutoff cannot discard a visible grey shape (Amendment 1 lowers the cutoff to
     a quarter opacity rather than removing it). Alpha-zero pixels remain void
     regardless of hidden RGB. Palette selection and sub-pixel boundary placement read the same
     normalized appearance. Working-grid downsampling averages these visible bytes, with a bounded
     two-row cache rather than a second full-source image; entirely transparent cells stay void.
3. **Clean-up** (`colour-label-cleanup.ts`). A 1-px run of an in-between colour along the seam of
   two others goes to the nearer of the two; a pixel without a same-label 8-neighbour takes its
   8-neighbourhood's mode; an 8-connected region under Remove specks (default 12 px, as Line Art) joins the neighbour it
   shares most edge with. Specks go smallest first and a merged region is re-measured as a whole
   (union-find), so two touching specks are judged together and neither is left behind as an
   orphaned speck. The 2026-09-27 correction counts a coherent diagonal as one component, without
   changing corner-touching boundary topology; Amendment 1 keeps dither out of that rule. At Remove specks zero (or a scaled working-grid
   area at most one), all three label-reassignment passes are disabled: a deliberate dot, counter,
   or requested intermediate-colour seam is retained. Palette selection still applies, and shared
   edge extraction and sub-pixel finishing still run. Transparent pixels are never traced.
   - **Paper.** The paper is a colour holding at least half the border pixels that is also
     paper-light: OKLab L at least 0.65 (dark kraft #b08850 is 0.653) and within 0.05 of the
     lightest palette colour. On an exact half-and-half border the lighter candidate is taken. The
     paper is not traced unless asked. A border colour that is dark or not the lightest is artwork,
     so nothing is left out: a white disc on a full-bleed black field traces both colours, and a
     full-bleed red and blue flag traces both whichever colour holds the border (before this rule,
     one row of pixels decided which one was silently dropped). Limit: a light full-bleed field
     (pale yellow, or orange at L 0.73) around darker art is still taken for paper; tick Trace
     background colour to trace it. Partial alpha alone does not disable paper detection. Actual
     alpha-zero pixels retain the existing no-paper inference for transparent artwork, so white
     artwork on transparency is not mistaken for a page.
4. **Shared boundaries** (`colour-regions.ts`). The label map's cracks form a planar graph: lattice
   vertices where three or more cracks meet are junctions, and each crack run between junctions is
   one chain separating exactly one pair of colours. Each chain is extracted once and finished once
   (`colour-chain-offsets.ts`, `colour-chain-geometry.ts`):
   - each crack moves to its sub-pixel edge, reading its two pixels as coverage mixtures of the two
     region colours in sRGB, median-filtered along the run; a junction moves to the least-squares
     meeting point of its chains' end lines, at most 1 px from its lattice vertex;
   - persistent lattice corners (60 degrees over 2 cracks, still 50 degrees over 6) and junctions
     are pinned; the rest is lightly Taubin-smoothed (G. Taubin, "A signal processing approach to
     fair surface design", SIGGRAPH 1995) and fitted with the in-house least-squares cubic fitter
     at 0.3 px (`geometry/cubic-fit.ts`); an exactly straight cubic is written as a line. Closed
     chains shorter than eight cracks retain their measured polygon: they have too few samples
     for the persistent-corner detector, and smoothing plus the fit tolerance can otherwise
     collapse a one-pixel dot or counter to a zero-area line.

   Every colour's outline is assembled from whole chains, forward or reversed, so two neighbours
   share the identical curve: zero gap and zero overlap by construction. At a vertex where a
   colour touches itself only diagonally, the outline turns left first, so the two touching areas
   stay separate outlines meeting at a point.
5. **Output.** One `ColoredPath` per colour, lightest first, with canonical cubic curves and correct
   holes. **Cut-out** gives each colour only its own area. **Stacked** makes each colour also cover
   every darker colour stacked above it, so its outline never follows those colours; the edges are
   the same shared curves.
6. **Commit** (`ui/trace/trace-output-commit.ts`, `ui/state/scene-mutations.ts`). The existing
   per-colour split (`createArtworkOperations`) gives each colour its own fill operation. For a
   laser, each colour's operation then starts at a power set by the colour's darkness
   D = 1 - L (OKLab lightness), with P the power the operation was created with
   (`core/trace/colour-layer-power.ts`). Darkness is read absolutely, against
   R = max(D_max, 0.5), so the darkest colour keeps P only when it is at least mid-dark; a lone
   pale layer is never promoted to full power:
   - cut-out: power = P x max(D / R, 0.25). The floor keeps a pale colour marking.
   - stacked: power = P x max((D - D_lighter) / R, 0.10), where D_lighter is the next lighter
     burned colour's darkness (0 for the lightest). An area is burned by its own operation and
     every lighter one below it, so the doses add up to the cut-out target P x D / R.
   - paper: a near-white colour (L at least 0.97; pure yellow, 0.968, still counts as ink) and,
     with Trace background colour ticked, the lightest traced colour when it is paper-light, get an
     operation with output off and 0 % power. The outline stays for alignment or a cut; burning
     it is the operator's deliberate choice. Light-on-dark art therefore burns the dark field, as
     Line Art does, never a full-power negative. The commit does not carry the detected paper
     itself, so if Trace background colour is ticked on art with no paper (a dark border), a
     paper-light lightest colour is still set to output off: the safe direction.

   A CNC operation's power is not a tone, so CNC operations keep their created power; only the
   paper's output off applies there, the toast does not mention power, and the swatches show no
   percentages. These are starting values the operator reviews and edits; nothing is refused.
   A colour trace that finds nothing (a blank or paper-only image) is not retried with "relaxed"
   settings: the backend reads a missing speck size as its 12 px default, so the retry would
   repeat the same multi-second trace (`hasAggressivePreprocessing` exempts it, as it does Edge).
7. Large images trace on a working grid of at most 4 megapixels and are scaled back to source
   coordinates, as the other backends do.

### Consequences

- The rectangles above: 3 layers, 1 subpath each, 13 segments, all straight lines. Rasterised at
  16 samples per pixel, pairwise overlap is 0 and the union has no gap, with hard edges and with
  anti-aliased edges (away from 0.3 px of the art's outer outline, which the area test covers:
  each rectangle's area is within 1 px² of the exact one). A 20 px anti-aliased disc keeps its area
  within 1 %. The laser move conditioning of ADR-391 at 0.5 mm per pixel leaves the overlap and gap
  at 0. On curved anti-aliased seams (two touching discs over a diagonal band, 72 x 56 px), laser
  conditioning plus compile flattening (`compilationPolylines`) at 0.1 and 0.5 mm per pixel leave
  0 overlapping samples and 0 empty samples more than 2 px inside the ink
  (`ui/trace/colour-layer-seams.test.ts`). Flattening each colour at a different tolerance in the
  same harness gives 1 to 7 bad samples, so the test catches a per-colour divergence.
- Real line art, N = Auto / 2 / 3 / 4, measured in a Node harness while other work shared the CPU
  (Line Art on the same run: owl 4.1 to 5.9 s, 2,187 subpaths, 105,409 curve segments):

  | Image | Time (s) | Layers | Subpaths | Curve segments |
  |---|---|---|---|---|
  | owl (auto picks 2) | 1.6 / 1.8 / 2.0 / 2.0 | 1 / 1 / 2 / 3 | 2,246 / 2,250 / 3,554 / 4,979 | 57,881 / 57,606 / 71,375 / 95,734 |
  | hummingbird (auto picks 2) | 1.3 / 1.3 / 1.5 / 1.5 | 1 / 1 / 2 / 3 | 1,629 / 1,655 / 2,769 / 3,221 | 42,308 / 42,254 / 53,881 / 54,996 |

  With the re-measured speck merge (both versions run back to back in one session): owl 1.3 /
  1.3 / 1.5 / 1.7 s, 2,246 / 2,249 / 3,548 / 4,977 subpaths, 58,195 / 57,922 / 72,387 / 97,715
  curve segments; hummingbird 1.1 / 1.2 / 1.4 / 1.4 s, 1,626 / 1,653 / 2,760 / 3,218 subpaths.
  The old single pass took 1.4 / 1.3 / 1.5 / 1.7 s and 1.1 / 1.1 / 1.3 / 1.3 s in the same
  session. There are fewer subpaths because orphaned specks are gone, and up to 2 % more curve
  segments because touching specks that together reach the speck size now stay as one region.
  Both images keep the same paper colour.

- A requested count is honoured even when k-means splits one ink into two close tones (owl, N = 4:
  #121212 and #1f1f1f, 0.057 apart). The swatch preview shows it; choose fewer colours or Auto.
- Machine conditioning still runs per path after tracing: ADR-391's laser move reduction keeps the
  fitted curves, and CNC fairing (ADR-260) resamples each colour on its own, which can open seams
  up to its tolerance. Colour layers are aimed at laser engraving.
- imagetracerjs's adaptive multi-colour mode stays reachable through the API only, unchanged.
  Retirement plan: no preset or shipped caller uses it (only `trace-pipeline.integration.test.ts`);
  a follow-up can route `numberOfColors > 2` without a fixed palette to this backend and then remove
  the adaptive branch of `buildImageTracerOptions`.
- Tests: `colour-layer-trace.test.ts` (three rectangles, zero gap and overlap by rasterised union
  and pairwise intersection, a two-colour logo with a counter and a dot, sub-pixel edges, a round
  disc, stacked output, determinism through the public entry point), `colour-layer-palette.test.ts`
  (dispatch for every preset, automatic palette through anti-aliasing and grain, requested counts,
  background, transparency, a blank page, light-on-dark art, a full-bleed flag at 30, 31 and 29
  red rows, white and kraft paper), `colour-label-cleanup.test.ts` (two touching specks),
  `colour-layer-seams.test.ts` (curved seams after laser conditioning and compile),
  `colour-layer-power.test.ts` (absolute darkness, near-white and traced paper off, CNC),
  `ColourLayerTraceSettingsControls.test.tsx`, `colour-layer-commit.test.ts`, and
  `colour-layers-real-art.test.ts`, which runs the table above when `COLOUR_LAYER_ART_DIR` names a
  folder holding the two images.

- The 2026-09-27 corrections also have public-entry regressions in `colour-layer-detail.test.ts`
  (horizontal, vertical and both diagonal hairlines at speck areas zero and 12, deliberate dots,
  counters and a third-colour seam) and `colour-layer-alpha.test.ts` (straight/tagged/flattened
  appearance, Keep background, white artwork and holes on transparency, hidden RGB).
  `colour-appearance.test.ts` checks integer and fractional downsampling against independent
  byte averages; `colour-trace-alpha.integration.test.ts` uses the real decoder helper. These
  correctness checks do not requalify the historical real-art timings above or material output.

Not part of this decision: removing imagetracerjs's multi-colour mode; keeping shared seams through
CNC fairing; per-colour operation names; importing a palette from the operator's materials.

### Amendment 1 - dither cleans up again and near-invisible pixels stay void (2026-09-27)

The 2026-09-27 corrections shipped two regressions, found by an audit with synthetic images:

- **Dither became one outline per pixel.** Clean-up moved from 4- to 8-connected regions so that
  1-px diagonal hairlines survive. A checkerboard, or an ordered or error-diffused dither, is then
  one 8-connected region per colour, so neither the mode filter nor speck removal touched it, while
  shared edges are still extracted 4-connected. Two 60 x 60 checkerboard patches beside a black bar
  traced as 1,801 polygons (9,129 points) instead of 1; a Bayer-dithered gradient as 1,082 instead
  of 1; a Floyd-Steinberg gradient as 758 instead of 3. Each is a slow, blotchy laser job.
- **Faint shadows became layers.** With every nonzero-alpha pixel counted, a logo with a soft
  black drop shadow (alpha 60 or less) traced four layers instead of two, adding #f2f2f2 and
  #d5d5d5. Both are dark enough to be created with output on, so the shadow burns.

Decision:

1. **Linked diagonals** (`colour-label-cleanup.ts`, `linkedNeighbour8`). Edge neighbours always
   link. A same-label diagonal neighbour links when a same-label edge pixel already joins the two,
   or when the contact is corner-only and neither pixel is dither. A pixel is dither when it has
   corner-only same-label contacts along both diagonals (NW or SE, and NE or SW). A 1-px diagonal
   hairline has them along one diagonal only, also where it crosses or meets a straight line, so it
   stays one region and survives as the 2026-09-27 correction intended. The mode filter, speck
   removal and component flood fill all use this relation, so a dithered area becomes solid again
   (the 60 x 60 checkerboards and the Bayer gradient trace as 1 polygon, the Floyd-Steinberg
   gradient as 10).
2. **Quarter-opacity cutoff** (`colour-appearance.ts`, `VISIBLE_ALPHA_MIN = 64`). A pixel under a
   quarter opacity is void, like alpha zero, at native size and when the working grid is
   downsampled (a void pixel adds nothing to a cell's coverage). From a quarter opacity up the
   composited appearance is used as before. Black at a quarter opacity over white is #bfbfbf, a
   visible light grey, so the grey shapes the removed alpha-128 cutoff lost are still traced, while
   the drop shadow above traces two layers again. Straight and decoder-tagged RGBA agree.

Limits: a soft shadow whose core is above a quarter opacity still traces as a light layer; delete
that layer or turn its output off. Dither coarser than one pixel (2 x 2 clusters, halftone dots
larger than Remove specks) is real artwork to the tracer and still traces as dots, as it did before
the 2026-09-27 corrections.

Regressions: `colour-label-cleanup.test.ts` (checkerboard and Bayer 6/16 and 7/16 patches clean up
to one label; a diagonal hairline crossing a straight one keeps all its pixels),
`colour-layer-detail.test.ts` (a checkerboard and a Bayer gradient beside a bar trace to at most 3
outlines; they traced 4,001 and 908 before this amendment; the hairline cases above still pass),
`colour-layer-alpha.test.ts` (alpha 1 and 63 stay untraced, straight or tagged; 64 to 255 agree)
and `colour-appearance.test.ts` (the cutoff at native size and when resampled). These are
software tracing checks, not a material cut.

### Amendment 2 - anti-aliased transparency edges (2026-09-28)

Keep Amendment 1's quarter-opacity floor and junction-aware speck cleanup. A proposed
replacement cleanup erased 17 of 39 pixels in the crossing-hairline regression, so it
is not adopted. The error-diffused ramp retains 49 outlines (the earlier broken cleanup
created 620); the more aggressive proposal gave 21 but damaged intersections.

Above the existing alpha floor, partial edge pixels connected to transparent background
and below half the opacity of nearby same-colour ink remain void. Retained edge pixels
use the nearby ink plateau's appearance, preventing a second grey crumb layer. At the
working-grid limit, cells need half visible area and use visible-pixel colour only.
Uniform faint shadows below alpha 64 remain untraced. An alpha-64 disc keeps its ink
but its antialiased rim remains below the floor, with measured area error 5.4 percent;
this is an explicit consequence of Amendment 1, not a half-coverage claim for faint ink.

Coverage includes straight/tagged alpha, discs and rings at Auto and fixed colour counts,
translucent halos, angled and intersecting hairlines, and an 8.4 MP resampled ring.
These are software geometry checks, not physical qualification.
