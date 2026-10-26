import type { TracedImage } from '../../core/scene';
import type { TraceOptions } from '../../core/trace';

/** The traced object's mode for the lane these options ran. Line + fill keeps
 * 'hybrid' so its strokes bind to a Line operation and burn down their centre
 * (ADR-454); every filled-outline style is 'filled-contours'. Shared by the
 * Trace dialog and the jig tracer (ADR-633), so both commit the same output. */
export function traceModeForOptions(options: TraceOptions): NonNullable<TracedImage['traceMode']> {
  if (options.traceMode === 'centerline') return 'centerline';
  if (options.traceMode === 'edge') return 'edge';
  if (options.traceMode === 'hybrid') return 'hybrid';
  return 'filled-contours';
}
