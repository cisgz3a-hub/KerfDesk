## ADR-430 - Colour layers: trace colour artwork into one layer per colour with shared edges (2026-09-25)

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
3. **Clean-up** (`colour-label-cleanup.ts`). A 1-px run of an in-between colour along the seam of
   two others goes to the nearer of the two; an isolated pixel takes its 8-neighbourhood's mode;
   a 4-connected region under Remove specks (default 12 px, as Line Art) joins the neighbour it
   shares most edge with. Specks go smallest first and a merged region is re-measured as a whole
   (union-find), so two touching specks are judged together and neither is left behind as an
   orphaned speck. Transparent pixels are never traced.
   - **Paper.** The paper is a colour holding at least half the border pixels that is also
     paper-light: OKLab L at least 0.65 (dark kraft #b08850 is 0.653) and within 0.05 of the
     lightest palette colour. On an exact half-and-half border the lighter candidate is taken. The
     paper is not traced unless asked. A border colour that is dark or not the lightest is artwork,
     so nothing is left out: a white disc on a full-bleed black field traces both colours, and a
     full-bleed red and blue flag traces both whichever colour holds the border (before this rule,
     one row of pixels decided which one was silently dropped). Limit: a light full-bleed field
     (pale yellow, or orange at L 0.73) around darker art is still taken for paper; tick Trace
     background colour to trace it.
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
     at 0.3 px (`geometry/cubic-fit.ts`); an exactly straight cubic is written as a line.

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

Not part of this decision: removing imagetracerjs's multi-colour mode; keeping shared seams through
CNC fairing; per-colour operation names; importing a palette from the operator's materials.
