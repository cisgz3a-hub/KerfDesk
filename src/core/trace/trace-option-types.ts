// TraceOptions — the option bundle every trace backend consumes, with
// per-field documentation. Split from trace-image.ts (single responsibility
// + the 600-raw-line file backstop). trace-image.ts re-exports it so the ~45
// existing `import { ..., type TraceOptions } from './trace-image'` sites are
// unchanged.

export type TraceOptions = {
  // Filled contours preserve source silhouettes for fill engraving.
  // Centerline traces skeletonize dark strokes into open line paths
  // for single-pass vector engraving. Edge detection (Canny) traces the
  // edges of full-colour art as single-stroke line drawings.
  readonly traceMode?: 'filled-contours' | 'centerline' | 'edge';
  // Number of color quantization buckets. 2 = black-and-white,
  // suitable for most laser engraving. Higher values produce more
  // layers and (usually) more visual fidelity. Range 2-16.
  readonly numberOfColors: number;
  // Path-omit: minimum number of points in a path for it to be
  // kept. Higher values drop small noise blobs.
  readonly pathOmit: number;
  // Line/curve fit tolerances. Higher = smoother curves, fewer
  // segments. ltres = straight-line tolerance, qtres = quadratic.
  readonly lineTolerance: number;
  readonly quadraticTolerance: number;
  // Gaussian blur radius applied BEFORE tracing — pre-smoothing
  // suppresses small pixel-level noise that would otherwise become
  // jagged edges in the output. 0 = no blur (sharp / detailed),
  // 1-5 = progressively smoother. The Phase E v1 ship omitted
  // this, which is why traces looked jagged on photo-like input.
  readonly blurRadius: number;
  // After-blur threshold: pixels whose delta to neighbors is
  // below this value are smoothed. Pairs with blurRadius.
  readonly blurDelta: number;
  // Smooths line angles in the final paths. Boolean. The default
  // imagetracerjs setting is false; we ship it true for cleaner
  // output on hand-drawn / photo-like inputs.
  readonly lineFilter: boolean;
  // When set, forces a fixed palette instead of color-quantizing the
  // input. Use ['#ffffff', '#000000'] for line art — guarantees the
  // output is two layers (background + ink) with no banding from
  // imagetracer's clustering. Hex strings, parsed at the boundary.
  readonly fixedPalette?: ReadonlyArray<string>;
  // Pre-threshold the input to pure 1-bit before tracing. Pixels
  // with luminance ≥ this value become white, the rest black. The
  // most important quality lever for line-art input: it eliminates
  // anti-aliased edges that otherwise become borderline-classified
  // speckle in the trace output. 0..255 range; undefined = skip
  // pre-threshold and feed raw pixels.
  // If set, thresholdLuma becomes the upper bound of LightBurn's
  // inclusive brightness band: cutoffLuma <= luma <= thresholdLuma.
  readonly cutoffLuma?: number;
  readonly thresholdLuma?: number;
  readonly traceTransparency?: boolean;
  readonly sketchTrace?: boolean;
  readonly autoSketchTrace?: boolean;
  // Phase E.2 quality polish — three pure-core preprocessing
  // stages (see preprocess.ts). Compose in this order:
  //   medianFilter → (otsuThreshold OR thresholdLuma) → despeckle → tracer
  // Each is opt-in via its flag so callers see only the quality
  // they ask for. Defaults in TRACE_PRESETS pick sensible bundles
  // per input class (logo vs photo vs sketch).
  //
  // useOtsuThreshold: when true, the cutoff is picked from the
  // image's luma histogram (Otsu 1979) instead of a fixed value.
  // Used only when explicit cutoffLuma / thresholdLuma are absent.
  readonly useOtsuThreshold?: boolean;
  // medianFilter: 3×3 median filter (RGBA → greyscale) applied
  // BEFORE thresholding. Kills salt-and-pepper noise and JPEG
  // artefacts without rounding off real edges the way a Gaussian
  // blur would.
  //   - true  → force the median on every pixel.
  //   - false / undefined → never apply it.
  //   - 'auto' → apply ONLY when the image carries measurable impulse
  //     noise (hasImpulseNoise, preprocess.ts). WHY: the median melts
  //     clean small glyphs — 4-6 px letters trace as blobs — so on crisp
  //     line art it does pure harm. 'auto' keeps the noise protection for
  //     scanned/JPEG sources while leaving clean logos untouched, the same
  //     policy Edge Detection already uses.
  readonly medianFilter?: boolean | 'auto';
  // despeckleMinPixels: connected-component despeckle applied AFTER
  // thresholding. Any ink region (4-connected, luma<128) with fewer
  // than N pixels gets flipped to white. 0 or undefined disables.
  // Topology-preserving: holes inside letters (O, B, etc.) survive.
  readonly despeckleMinPixels?: number;
  // fillPinholeCracks: fill hairline white slivers ENCLOSED inside solid ink
  // after despeckle — thresholding artifacts that would otherwise trace as
  // spurious inner contours (a crack down a letter stem). Enclosure +
  // thinness + area guards keep letter counters, spacing gaps, and intended
  // thin highlights untouched. See fill-pinholes.ts.
  readonly fillPinholeCracks?: boolean;
  // supersampleContour: quality supersample for the binary contour presets —
  // trace at 2x resolution and scale the vectors back down. Thin features
  // (hooked apex tips, small pale letters) binarize with double the
  // resolution, removing mask-level shape distortion no downstream geometry
  // stage can repair (mkbitmap's published recipe). Sharp opts out: bilinear
  // supersampling anti-aliases the pixel notches it exists to preserve.
  readonly supersampleContour?: boolean;
  // pixelScale: INTERNAL — set by the upscale wrapper so pixel-denominated
  // cleanup caps (despeckle area, pinhole radius/area, contour min-area,
  // simplify epsilon) keep their SOURCE-pixel semantics on a supersampled
  // trace. Callers never set this directly.
  readonly pixelScale?: number;
  readonly ignoreLessThanPixels?: number;
  readonly smoothness?: number;
  readonly optimize?: number;
  // Edge Detection-only controls. UI exposes these as three simple
  // operator knobs: Sensitivity, Detail, and Minimum line.
  readonly edgeBlurSigma?: number;
  readonly edgeLowThresholdRatio?: number;
  readonly edgeHighThresholdRatio?: number;
  // Minimum finished edge-path length in source-image pixels.
  readonly edgeMinLengthPx?: number;
  readonly edgeJoinGapPx?: number;
  readonly edgeMedianFilter?: boolean;
  readonly centerlineJoinGapPx?: number;
  // Phase E.3 — image-level adjustments matching LF1's
  // ImageProcessing.ts math (see raster-prep.ts). All four run BEFORE the
  // existing median → threshold → despeckle chain, so the cleanup
  // stages operate on pixels the user has already brightened /
  // contrast-pushed / gamma-corrected / inverted to taste.
  //
  // brightness: −100..+100, 0 = no-op. Linear add of brightness*2.55
  // to each channel; +100 saturates black to white.
  readonly brightness?: number;
  // contrast: −100..+100, 0 = no-op. Pivot around 128 with factor
  // 1 + contrast/100. +100 doubles contrast; −100 collapses to grey.
  readonly contrast?: number;
  // gamma: 0.1..5, 1 = no-op. Power curve in normalised space.
  // gamma > 1 brightens midtones; gamma < 1 darkens them.
  readonly gamma?: number;
  // invert: swap each channel to 255 − v. Useful when the source is
  // light-on-dark (white logo on black) and the user wants the laser
  // to engrave the dark areas — flipping the image makes that the
  // standard dark-on-light input every tracer assumes.
  readonly invert?: boolean;
  // autoUpscaleSmallSources: supersample small, THIN-featured sources before
  // tracing, then scale the traced vectors back down. WHY: no tracing
  // algorithm works well at very small scales (the official potrace project
  // ships `mkbitmap` for exactly this) — strokes under ~3px fragment Edge
  // Detection and lose detail on the potrace-backed presets. Off by default;
  // the named presets opt in. See auto-upscale.ts.
  readonly autoUpscaleSmallSources?: boolean;
  // upscaleSmallSmoothSources: supersample any SMALL source (longest edge under
  // ~260px) before tracing, regardless of stroke thickness, then scale back.
  // WHY: small letters facet because their curve RADIUS spans only a few pixels
  // — a 40px "E"/"B" traces as polygonal chords even with comfortable ~6px
  // strokes, which the thin-stroke gate above misses. Set ONLY on the
  // smooth-wanting presets (Line Art / Smooth / Edge Detection / Centerline);
  // Sharp deliberately omits it so its pixel-art notches are never anti-aliased
  // away. See auto-upscale.ts (shouldUpscaleSmallSource).
  readonly upscaleSmallSmoothSources?: boolean;
};
