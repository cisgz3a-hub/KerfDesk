// Trace backends that own their whole pipeline and bypass the line presets'
// invert/alpha/scale policy, detection and contour finishing. Pure core.

import type { ColoredPath } from '../scene';
import { traceImageToPhotoPathsSteps } from './photo-trace';
import { isColourLayerTrace, traceColourLayersSteps } from './colour-layer-trace';
import type { RawImageData, TraceOptions } from './trace-image';
import type { TraceSteps } from './trace-steps';

/** The steps of the dedicated backend the options select, or undefined for
 *  the line presets' pipeline. */
export function dedicatedTraceSteps(
  image: RawImageData,
  options: TraceOptions,
): TraceSteps<ColoredPath[]> | undefined {
  // Photo tone is encoded in ribbon coverage, before any binary detection or
  // contour supersampling can discard it. The backend owns its bounded grid.
  if (options.photoDetail !== undefined) return traceImageToPhotoPathsSteps(image, options);
  // Colour layers read colour, not luma, and own their bounded working grid
  // (ADR-430).
  if (isColourLayerTrace(options)) return traceColourLayersSteps(image, options);
  return undefined;
}
