import type { StatusReport, StreamerState } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';
import { hasOwnedControllerReset } from './laser-reset-cleanup';

export function shouldReleaseStreamerAtIdle(
  streamer: StreamerState | null,
  controllerOperation: LaserState['controllerOperation'],
  report: StatusReport,
): boolean {
  if (streamer === null || report.state !== 'Idle') return false;
  if (hasOwnedControllerReset(controllerOperation)) return false;
  if (streamer.status === 'errored') return true;
  return streamer.status === 'done' && controllerOperation === null;
}
