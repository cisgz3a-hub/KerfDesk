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
    //   * smallMarkPolicy 'auto' — judges each ink mark under 12 source
    //     px² and each thin enclosed paper hole on evidence (contrast,
    //     grey bridges, nearby dust, like marks, size) instead of erasing /
    //     filling all of them, so stipple, dotted rows, small text and paper
    //     holes in hatching survive while faint threshold noise, dust,
    //     toner scatter and binarisation cracks are cleaned (ADR-409). An explicit "Remove
    //     ink specks" / "Fill tiny holes" value replaces it exactly.
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
    autoSketchTrace: true, // Add local detail without removing brightness-selected solid ink.
    ignoreLessThanPixels: 2,
    smoothness: 1,
    optimize: 0.2,
    // Automatic speck removal and hairline-crack fill (see above). Replaces
    // the fixed despeckleMinPixels 12 + fillPinholeCracks true, which erased
    // 99% of the owl drawing's 3-8 px² stipple and filled its paper holes.
    smallMarkPolicy: 'auto',
    // Feature-aware quality path: coherent thin details (hooked apex tips,
    // pale subtitle strokes) supersample; broad art stays native and large
    // dense color pictures use a bounded working grid.
    supersampleContour: true,
    // Supersample small thin-featured sources before tracing (see auto-upscale.ts).
    autoUpscaleSmallSources: true,
    // Also supersample small sources regardless of stroke width — small letters
    // facet from small curve radius even at ~6px strokes. Smooth preset: opts in.
    upscaleSmallSmoothSources: true,
  },
  'Photo shading': {
    traceMode: 'filled-contours',
    photoDetail: 60,
    brightness: 0,
    contrast: 0,
    // Tone is read in linear light (photo-tone.ts), so gamma 1 (Midtones in
    // the dialog) already gives each shade the coverage it needs.
    gamma: 1,
    invert: false,
    numberOfColors: 2,
    pathOmit: 0,
    lineTolerance: 1,
    quadraticTolerance: 1,
    blurRadius: 0,
    blurDelta: 0,
    lineFilter: false,
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
    // Local contrast detects full-colour artwork, then the shared contour
    // finisher produces closed outlines around the detected ink.
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
    // Minimum finished outline length, including its closing edge.
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
    // salt-and-pepper noise before threshold; the automatic small-mark
    // policy catches what survives. Blur slider remains for compatibility
    // but the median does most of the work.
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
    // Same automatic speck removal and crack fill as Line Art (ADR-409). It
    // replaces the fixed despeckleMinPixels 24 + fillPinholeCracks true, which
    // erased genuine 5 px dots and 6 px text as well as noise. Sharp keeps
    // its fixed keep-everything cleanup (pixel-fidelity preset — every notch
    // matters, even a crack).
    smallMarkPolicy: 'auto',
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
    // Keep single-pixel marks and diagonal fragments. Four-connected cleanup
    // at area 4 erased intentional fine hatching before the contour walk.
    numberOfColors: 2,
    pathOmit: 16,
    lineTolerance: 0.5,
    quadraticTolerance: 0.5,
    blurRadius: 0,
    blurDelta: 0,
    lineFilter: false,
    fixedPalette: ['#ffffff', '#000000'],
    useOtsuThreshold: true,
    despeckleMinPixels: 1,
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
