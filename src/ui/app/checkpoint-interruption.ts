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
    kind: noticeKind(notice),
    message: notice.message,
    ...(notice.kind === 'controller-error' && notice.rejectedLine !== undefined
      ? { rejectedLine: notice.rejectedLine }
      : {}),
  };
}

function noticeKind(notice: LaserSafetyNotice): JobInterruption['kind'] {
  if (notice.kind === 'disconnect-during-job' || notice.kind === 'disconnect-during-fire') {
    return 'disconnect';
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
