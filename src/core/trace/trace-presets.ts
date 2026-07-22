// Trace presets — the named, tuned option bundles the import dialog
// surfaces. Split from trace-image.ts (single responsibility + the
// 600-raw-line file backstop): trace-image owns the option types and
// the tracing entry points; this file owns the tuning values.

import type { TraceOptions } from './trace-image';

// Named presets — each tuned for a different input class. Dialog
// surfaces these so the user doesn't have to know which knob
// controls what. ORDER matters: the first key is the default,
// and "Line Art" is the by-far most common laser-engraving case
// (vector-like logos, line drawings, monochrome signs).
export const TRACE_PRESETS: Readonly<Record<string, TraceOptions>> = {
  'Line Art': {
    // For logo / line-art imports. Clean binary images stay on the
    // fixed LightBurn-like brightness band, while colour-rich logos can
    // auto-promote to local-contrast sketch preprocessing so pale ink
    // such as gold subtitle text is not dropped as background.
    // Phase E.2 upgrade stack:
    //   * cutoffLuma / thresholdLuma — LightBurn's default trace
    //     brightness band, inclusive 0..128.
    //   * fixedPalette [white, black] — guarantees a 2-layer output
    //     even if the input has stray non-monochrome pixels.
    //   * despeckleMinPixels 12 — removes connected ink blobs under
    //     12 pixels. Kills JPEG dot artefacts that survived the
    //     threshold.
    //   * pathOmit 16 — second-line defence: drops short paths the
    //     tracer might still emit at edges.
    numberOfColors: 2,
    pathOmit: 16,
    lineTolerance: 1,
    quadraticTolerance: 1,
    blurRadius: 0,
    blurDelta: 0,
    lineFilter: true,
    fixedPalette: ['#ffffff', '#000000'],
    cutoffLuma: 0,
    thresholdLuma: 128,
    autoSketchTrace: true,
    ignoreLessThanPixels: 2,
    smoothness: 1,
    optimize: 0.2,
    despeckleMinPixels: 12,
    // Fill hairline threshold cracks enclosed in solid ink (letter-stem
    // slivers) so they don't trace as spurious inner contours.
    fillPinholeCracks: true,
    // Feature-aware quality path: coherent thin details (hooked apex tips,
    // pale subtitle strokes) supersample; broad art and dense color pictures
    // stay native.
    supersampleContour: true,
    // Supersample small thin-featured sources before tracing (see auto-upscale.ts).
    autoUpscaleSmallSources: true,
    // Also supersample small sources regardless of stroke width — small letters
    // facet from small curve radius even at ~6px strokes. Smooth preset: opts in.
    upscaleSmallSmoothSources: true,
  },
  Centerline: {
    // For black strokes that should engrave as one path down the
    // middle instead of filled outline contours. Uses the same
    // binarisation as Line Art, then skeletonizes the ink mask.
    traceMode: 'centerline',
    numberOfColors: 2,
    pathOmit: 0,
    lineTolerance: 1,
    quadraticTolerance: 1,
    blurRadius: 0,
    blurDelta: 0,
    lineFilter: true,
    fixedPalette: ['#ffffff', '#000000'],
    useOtsuThreshold: true,
    despeckleMinPixels: 12,
    // A crack down a stroke splits the skeleton into two parallel lines;
    // fill it before thinning (same rationale as Line Art).
    fillPinholeCracks: true,
    centerlineJoinGapPx: 3,
    // Supersample small thin-featured sources before tracing (see auto-upscale.ts).
    autoUpscaleSmallSources: true,
    // NO small-source (whole-size) upscale here, unlike the filled/edge presets.
    // The small-letter facet defect is a filled/edge CONTOUR problem — curve
    // chords quantize at small radius. A centerline is a 1px medial skeleton
    // whose smoothness comes from medial-thinning + curve-fit, not source curve
    // radius; the upscale→skeletonize→downscale round-trip instead adds sub-pixel
    // vertical wobble to an otherwise flat centerline (trace-pipeline integration
    // test). So Centerline opts OUT of upscaleSmallSmoothSources.
  },
  'Edge Detection': {
    // Contrast edge vectorization -> stroked contour vectors around brightness
    // transitions. For full-colour art / logos that should engrave as a line
    // drawing of their edges, not a flat filled silhouette.
    traceMode: 'edge',
    numberOfColors: 2,
    pathOmit: 0,
    lineTolerance: 1,
    quadraticTolerance: 1,
    blurRadius: 0,
    blurDelta: 0,
    lineFilter: true,
    fixedPalette: ['#ffffff', '#000000'],
    useOtsuThreshold: true,
    despeckleMinPixels: 12,
    edgeBlurSigma: 1.2,
    edgeLowThresholdRatio: 0.08,
    edgeHighThresholdRatio: 0.2,
    // Minimum line is CHAIN length now (the old outline backend measured
    // two-sided contour perimeters, roughly double).
    edgeMinLengthPx: 12,
    edgeJoinGapPx: 5,
    // undefined = AUTO median: applied only when impulse noise is detected,
    // so clean art keeps its small features (see edge-trace.ts).
    // Same feature-aware 2x quality path as Line Art. The edge lane shares the
    // measured-boundary stack but broad solid source art stays native.
    supersampleContour: true,
    // Supersample small thin-featured sources before tracing (see auto-upscale.ts).
    autoUpscaleSmallSources: true,
    // Also supersample small sources regardless of stroke width — the reported
    // faceted 40-60px E/B facet from small curve radius, not thin strokes.
    upscaleSmallSmoothSources: true,
  },
  Smooth: {
    // For slightly noisy / hand-drawn line art. The median kills
    // salt-and-pepper noise before threshold; despeckle catches what
    // survives. Blur slider remains for compatibility but the median
    // does most of the work.
    //
    // medianFilter is 'auto', NOT true: forcing the median on every input
    // melts clean small glyphs (the LANGEBAAN defect — 4-6 px letters trace
    // as blobs) and cost ~2.5s on a 1024² logo for zero benefit on crisp
    // art. 'auto' runs the median only when impulse noise is actually
    // present, matching the Edge Detection tracer's policy.
    numberOfColors: 2,
    pathOmit: 16,
    lineTolerance: 2,
    quadraticTolerance: 2,
    blurRadius: 1,
    blurDelta: 20,
    lineFilter: true,
    fixedPalette: ['#ffffff', '#000000'],
    medianFilter: 'auto',
    useOtsuThreshold: true,
    despeckleMinPixels: 24,
    // Same hairline-crack cleanup as Line Art; Sharp deliberately omits it
    // (pixel-fidelity preset — every notch matters, even a crack).
    fillPinholeCracks: true,
    // Same feature-aware 2x quality path as Line Art (Sharp opts out: bilinear
    // supersampling anti-aliases the pixel notches it exists to preserve).
    supersampleContour: true,
    // Supersample small thin-featured sources before tracing (see auto-upscale.ts).
    autoUpscaleSmallSources: true,
    // Also supersample small sources regardless of stroke width — small letters
    // facet from small curve radius even at ~6px strokes. Smooth preset: opts in.
    upscaleSmallSmoothSources: true,
  },
  Sharp: {
    // For pixel-art / blueprint inputs where every notch matters.
    // Otsu picks a clean cutoff but no median (would round notches).
    // Smaller despeckle so single-pixel features still survive.
    numberOfColors: 2,
    pathOmit: 16,
    lineTolerance: 0.5,
    quadraticTolerance: 0.5,
    blurRadius: 0,
    blurDelta: 0,
    lineFilter: false,
    fixedPalette: ['#ffffff', '#000000'],
    useOtsuThreshold: true,
    despeckleMinPixels: 4,
    // Curve params that drive the contour backend (the imagetracerjs fields
    // above are inert there). smoothness scales the wobble flattener /
    // arc-evening strength: at 0.55 both are fully off, so pixel-art notches
    // and square dots keep their exact corners instead of rounding to pills
    // or circles.
    smoothness: 0.55,
    optimize: 0.15,
    // NO auto-upscale of any kind (neither autoUpscaleSmallSources nor
    // upscaleSmallSmoothSources). Sharp is the pixel-fidelity preset: bilinear
    // supersampling + re-threshold would anti-alias hard 1-2px notches and round
    // them off — the opposite of "every notch matters". A blueprint's thin lines
    // are intentional pixel geometry here, not a small-scale tracing artefact.
  },
};
