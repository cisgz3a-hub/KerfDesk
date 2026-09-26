import type { TraceOptions } from './trace-option-types';

// Source-area controls converted to the bounded downscale raster (see the
// caller). The automatic small-mark policy's areas are source px² too
// (ADR-409); a commit-grid ratio already on the options composes with it.
export function downscaleWorkingOptions(options: TraceOptions, areaScale: number): TraceOptions {
  return {
    ...options,
    ...(options.despeckleMinPixels === undefined
      ? {}
      : { despeckleMinPixels: options.despeckleMinPixels * areaScale }),
    ...(options.ignoreLessThanPixels === undefined
      ? {}
      : { ignoreLessThanPixels: options.ignoreLessThanPixels * areaScale }),
    ...(options.smallMarkPolicy === 'auto'
      ? { smallMarkAreaScale: (options.smallMarkAreaScale ?? 1) * areaScale }
      : {}),
    supersampleContour: false,
    autoUpscaleSmallSources: false,
    upscaleSmallSmoothSources: false,
    pixelScale: 1,
  };
}
