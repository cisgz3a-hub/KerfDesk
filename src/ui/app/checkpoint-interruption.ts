import type { StreamerStatus } from '../../core/controllers/grbl';
import type { JobInterruption } from '../../core/recovery';
import type { LaserSafetyNotice } from '../state/laser-safety-notice';

export function checkpointInterruption(
  status: StreamerStatus,
  notice: LaserSafetyNotice | null,
): JobInterruption | null {
  if (!['cancelled', 'disconnected', 'errored'].includes(status)) return null;
  if (notice === null) return fallbackInterruption(status);
  return {
    kind: noticeKind(status, notice),
    message: notice.message,
    ...(notice.kind === 'controller-error' && notice.rejectedLine !== undefined
      ? { rejectedLine: notice.rejectedLine }
      : {}),
  };
}

function noticeKind(status: StreamerStatus, notice: LaserSafetyNotice): JobInterruption['kind'] {
  // A fire-time link drop is a disconnect just like a job-time one: GRBL may
  // still be executing its buffer, so recovery treats both as 'disconnect'.
  if (notice.kind === 'disconnect-during-job' || notice.kind === 'disconnect-during-fire') {
    return 'disconnect';
  }
  // A no-realtime-reset controller can raise this while the port remains
  // connected and the operator aborts. Preserve Abort as cancellation; only
  // an actually disconnected streamer records a disconnect interruption.
  if (notice.kind === 'disconnect-stop-unconfirmed') {
    return status === 'cancelled' ? 'cancelled' : 'disconnect';
  }
  if (notice.kind === 'frame-limit') return 'unknown';
  return notice.kind;
}

function fallbackInterruption(status: StreamerStatus): JobInterruption {
  if (status === 'disconnected') {
    return { kind: 'disconnect', message: 'The serial connection closed during the job.' };
  }
  if (status === 'cancelled') {
    return { kind: 'cancelled', message: 'The job stopped before physical completion.' };
  }
  return { kind: 'unknown', message: 'The job stream ended unexpectedly.' };
}
