// TraceOptions — the option bundle every trace backend consumes, with
// per-field documentation. Split from trace-image.ts (single responsibility
// + the 600-raw-line file backstop). trace-image.ts re-exports it so the ~45
// existing `import { ..., type TraceOptions } from './trace-image'` sites are
// unchanged.

import type { ColourLayerOptions } from './colour-layer-options';

export type TraceOptions = {
  // Photo shading traces continuous tones as black filled ribbons. Presence
  // selects the photo backend; 0..100 controls the bounded detail grid. Shades
  // live in covered area, so ordinary fill and bitmap output retain them.
  // Photo tone is read in linear light, and its invert swaps light and dark
  // there rather than in bytes (photo-tone.ts, ADR-390).
  readonly photoDetail?: number;
  // Filled contours preserve source silhouettes for fill engraving.
  // Centerline traces skeletonize dark strokes into open line paths
  // for single-pass vector engraving. Edge detection uses local contrast
  // to find full-colour artwork and traces closed outlines around its ink.
  readonly traceMode?: 'filled-contours' | 'centerline' | 'edge';
  // Colour layers (ADR-430): presence selects the colour-layer backend, which
  // quantises the image to a few flat colours and traces one filled path per
  // colour with shared boundaries (colour-layer-trace.ts).
  readonly colourLayers?: ColourLayerOptions;
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
  // INTERNAL full-source verdict, resolved before cropping or resampling and
  // carried only with that execution's derived options. traceTransparency
  // remains the requested setting; an originally opaque source still uses luma.
  readonly sourceHasTransparency?: boolean;
  readonly sketchTrace?: boolean;
  readonly autoSketchTrace?: boolean;
  // INTERNAL full-source auto-sketch verdict (ADR-435), carried like
  // sourceHasTransparency so an Enhance crop binarises as the full pass did.
  // Read only while autoSketchTrace is on; absent = decide on the image given.
  readonly sourceAutoSketch?: boolean;
  // Explicit faint-line detection adds coherent narrow local-contrast strokes
  // to this preset's actual brightness/Otsu mask, retaining its solid areas.
  // Alpha tracing takes precedence; UI manual/sketch detection clears this flag.
  readonly faintLineRecovery?: boolean;
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
  // INTERNAL full-source Otsu cut (ADR-435), read only while useOtsuThreshold
  // is on, so an Enhance crop cuts where the full pass cut. Dropping
  // useOtsuThreshold (the relaxed retry) drops it with it.
  readonly sourceOtsuThreshold?: number;
  // medianFilter: 3×3 median filter (RGBA → greyscale) applied
  // BEFORE thresholding. Kills salt-and-pepper noise and JPEG
  // artefacts without rounding off real edges the way a Gaussian
  // blur would.
  //   - true  → force the median on every pixel.
  //   - false / undefined → never apply it.
  //   - 'auto' → repair isolated high-contrast impulses when their density
  //     warrants cleanup. Connected thin features and unaffected pixels stay
  //     intact even when the same image also contains noise. Shares the
  //     selective automatic policy used by Edge Detection.
  readonly medianFilter?: boolean | 'auto';
  // INTERNAL full-source verdict of medianFilter 'auto' (ADR-436): true when
  // the whole image's isolated impulses reach the density floor. An Enhance
  // crop repairs its impulses at source scale by this verdict, not its own.
  readonly sourceAutoMedian?: boolean;
  // despeckleMinPixels: connected-component despeckle applied AFTER
  // thresholding. Any ink region (luma<128) with fewer than N source pixels
  // gets flipped to white. Centerline uses eight-connected ink; other modes
  // retain four-connectivity. 0 or undefined disables.
  // Topology-preserving: holes inside letters (O, B, etc.) survive.
  // Area is in the source grid supplied to the tracing core (after UI
  // decode). The downscale wrapper converts it to fractional working area.
  readonly despeckleMinPixels?: number;
  // fillPinholeCracks: fill hairline white slivers ENCLOSED inside solid ink
  // after despeckle — thresholding artifacts that would otherwise trace as
  // spurious inner contours (a crack down a letter stem). Enclosure +
  // thinness + area guards keep letter counters, spacing gaps, and intended
  // thin highlights untouched. See fill-pinholes.ts.
  readonly fillPinholeCracks?: boolean;
  // smallMarkPolicy 'auto': judge each small ink mark and each thin enclosed
  // paper hole on evidence (local contrast against the image's ink/paper
  // span, grey bridges, nearby dust, like marks, size in SOURCE px) instead
  // of a fixed area, so stipple, dotted rows, small text and paper holes in
  // hatching survive while faint threshold noise, dust, toner scatter and
  // binarisation cracks are cleaned. Applies only to a stage whose explicit option above is
  // unset: an explicit despeckleMinPixels / fillPinholeCracks is honoured
  // exactly. See small-mark-policy.ts and ADR-434.
  readonly smallMarkPolicy?: 'auto';
  // smallMarkAreaScale: INTERNAL — working-grid px² per source px² on the
  // bounded downscale route (set by trace-to-paths.ts, which resets
  // pixelScale to 1 there), so the automatic policy keeps SOURCE-pixel
  // semantics; a commit on a grid finer than the preview multiplies in the
  // commit/preview area ratio (trace-commit-grid.ts, ADR-401). Operators never
  // set this.
  readonly smallMarkAreaScale?: number;
  // turnPolicy: how the filled-contour lane resolves a SADDLE — two ink
  // pixels touching only at a corner. 'connect-ink' joins them (a 1-px
  // diagonal hairline is one outline); 'connect-paper' splits them and is
  // the rollback value: walker, despeckle and pinhole fill all behave
  // exactly as before ADR-395. 'auto' (default) decides each corner: the
  // colour that is the minority in the surrounding 4×4 source-pixel window
  // keeps its diagonal; exact ties use the bilinear asymptotic decider where
  // the source has anti-aliased grey levels clearly off the cut, else split
  // the ink. Despeckle and pinhole fill use the same decision so connectivity is
  // consistent end to end. See saddle-connectivity.ts and ADR-395.
  // Centerline and Edge ignore it.
  readonly turnPolicy?: 'auto' | 'connect-ink' | 'connect-paper';
  // supersampleContour: opt into feature-aware quality supersampling for the
  // binary contour presets. Cleaned masks with coherent 1-3px detail trace at
  // 2x and scale back down; broad solid art stays at native resolution, while
  // large dense color pictures use a bounded working grid. Sharp opts out
  // because bilinear supersampling anti-aliases the pixel notches it exists to
  // preserve.
  readonly supersampleContour?: boolean;
  // pixelScale: INTERNAL — set by the upscale wrapper so pixel-denominated
  // cleanup caps (despeckle area, pinhole radius/area, contour min-area,
  // simplify epsilon, centerline join distance) keep their SOURCE-pixel
  // semantics on a supersampled trace. Callers never set this directly.
  readonly pixelScale?: number;
  // Source-grid contour/hole area. Converted independently of despeckle;
  // internal working thresholds may be fractional after downsampling.
  readonly ignoreLessThanPixels?: number;
  readonly smoothness?: number;
  readonly optimize?: number;
  // Edge Detection-only controls. UI exposes these as three simple
  // operator knobs: Sensitivity, Detail, and Minimum line (ADR-437).
  // edgeBlurSigma carries the local-mean radius: round(sigma x 10), 4..32
  // source px. edgeLowThresholdRatio carries the contrast delta:
  // round(ratio x 6/0.074), 2..12 luma levels (see edge-input.ts).
  readonly edgeBlurSigma?: number;
  readonly edgeLowThresholdRatio?: number;
  /** @deprecated Canny-era value; nothing reads it. Accepted so older saved
   * options still load. */
  readonly edgeHighThresholdRatio?: number;
  // Minimum finished edge-path length in source-image pixels.
  readonly edgeMinLengthPx?: number;
  /** @deprecated Canny-era value; closed-mask contours never bridge gaps and
   * nothing reads it. Accepted so older saved options still load. */
  readonly edgeJoinGapPx?: number;
  // undefined = selective AUTO cleanup in source pixels before enlargement;
  // true = the explicit full 3x3 median on the working raster; false = off.
  readonly edgeMedianFilter?: boolean;
  // Centerline endpoint-join allowance in source-image pixels. Candidates
  // must be strictly closer than this distance and pass the tangent checks.
  // The working raster uses the validated pixelScale once. Zero disables
  // gap bridging; true-junction repair and ring closure keep their policies.
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
