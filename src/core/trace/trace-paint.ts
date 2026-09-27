// Trace paint intent shared by preview and file export (ADR-407/431/444).
// Closure alone does not make a fill: Edge and Centerline commit to line
// operations, while Hybrid chooses its operation per path (ADR-454).

import type { ColoredPath } from '../scene';
import { isHybridStrokePath } from './hybrid/hybrid-paths';
import type { TraceOptions } from './trace-option-types';

/** Modes whose closed and open contours are all line operations. */
export function isLineTraceMode(traceMode: TraceOptions['traceMode']): boolean {
  return traceMode === 'centerline' || traceMode === 'edge';
}

/** Whether even the closed contours of this path must be stroked. */
export function isLineTracePath(
  path: Pick<ColoredPath, 'color'>,
  traceMode: TraceOptions['traceMode'],
): boolean {
  return isLineTraceMode(traceMode) || (traceMode === 'hybrid' && isHybridStrokePath(path));
}
