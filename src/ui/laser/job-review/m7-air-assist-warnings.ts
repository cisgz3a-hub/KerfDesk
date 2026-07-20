import type { GrblBuildInfo } from '../../../core/controllers/grbl/build-info';
import { evaluateM7AirAssistReadiness } from '../../../core/preflight/m7-air-assist-readiness';

/** Compatibility wrapper for focused Job Review tests. Start preparation and
 * the final wire boundary use the same core evaluator directly. */
export function detectM7AirAssistWarnings(
  gcode: string,
  buildInfo: GrblBuildInfo | null,
  buildInfoIsCurrent: boolean,
): ReadonlyArray<string> {
  const readiness = evaluateM7AirAssistReadiness(gcode, buildInfo, buildInfoIsCurrent);
  return readiness.kind === 'unknown' || readiness.kind === 'unsupported'
    ? [readiness.message]
    : [];
}
