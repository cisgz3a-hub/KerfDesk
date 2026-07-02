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
    centerlineJoinGapPx: 3,
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
    edgeMedianFilter: true,
  },
  Smooth: {
    // For slightly noisy / hand-drawn line art. Median filter kills
    // salt-and-pepper noise before threshold; despeckle catches what
    // survives. Blur slider remains for compatibility but the median
    // does most of the work.
    numberOfColors: 2,
    pathOmit: 16,
    lineTolerance: 2,
    quadraticTolerance: 2,
    blurRadius: 1,
    blurDelta: 20,
    lineFilter: true,
    fixedPalette: ['#ffffff', '#000000'],
    medianFilter: true,
    useOtsuThreshold: true,
    despeckleMinPixels: 24,
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
    // Potrace curve params — the fields that actually reach the binary
    // backend (the imagetracerjs fields above are inert there). Default
    // smoothness (1.0) blobs small features: 3-px letters become pills,
    // square dots become circles. 0.55 keeps drawn corners as vertices
    // while genuine large arcs still fit as curves.
    smoothness: 0.55,
    optimize: 0.15,
  },
};
