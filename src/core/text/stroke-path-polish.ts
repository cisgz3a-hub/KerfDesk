import { fairLineCurvePath, type CurveFairingOptions } from '../geometry';
import type { CurveSubpath } from '../scene';

export type StrokePathPolishOptions = CurveFairingOptions;

/** Fair dense line-only font strokes with the tracer's deterministic cubic fitter. */
export function polishStrokePath(
  path: CurveSubpath,
  options: StrokePathPolishOptions,
): CurveSubpath {
  return fairLineCurvePath(path, options);
}
