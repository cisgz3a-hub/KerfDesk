import type { FrameResult, FrameResultReason } from './ExecutionCoordinator';

export interface FrameFailureDescription {
  title: string;
  message: string;
  recovery: string;
  details?: string;
}

export function describeFrameFailure(
  result: FrameResult,
  frameLabel: string = 'Frame',
  idleTimeoutSeconds?: number,
): FrameFailureDescription {
  const reason = result.reason ?? 'unknown';
  switch (reason) {
    case 'no-controller':
      return {
        title: `${frameLabel} failed`,
        message: 'No controller connection is available.',
        recovery: 'Connect to the laser, confirm it is idle, then frame again.',
      };
    case 'idle-timeout':
      return {
        title: `${frameLabel} did not finish`,
        message: `The machine did not report idle${idleTimeoutSeconds ? ` within ${idleTimeoutSeconds}s` : ''}.`,
        recovery: 'Check whether the machine is still moving, stuck, or alarmed before trying again.',
      };
    case 'command-blocked':
    case 'command-failed': {
      const line = result.blockedAtLine == null ? null : result.blockedAtLine + 1;
      return {
        title: `${frameLabel} command was blocked`,
        message: line == null
          ? 'A frame command was rejected before framing completed.'
          : `A frame command was rejected at line ${line}.`,
        recovery: 'Resolve the controller state or command blocker, then frame again before Start.',
        details: result.blockedError,
      };
    }
    case 'machine-alarm':
      return {
        title: `${frameLabel} stopped by alarm`,
        message: 'The machine entered an alarm state during framing.',
        recovery: 'Use the alarm recovery card, inspect the machine, unlock only when safe, then frame again.',
      };
    case 'disconnected':
      return {
        title: `${frameLabel} interrupted`,
        message: 'Connection to the machine was lost during framing.',
        recovery: 'Reconnect, confirm machine position and state, then frame again before Start.',
      };
    case 'cancelled':
      return {
        title: `${frameLabel} cancelled`,
        message: 'The frame operation was cancelled before it completed.',
        recovery: 'Frame again when you are ready to confirm the job area.',
      };
    case 'operation-busy':
      return {
        title: `${frameLabel} could not start`,
        message: 'Another machine operation is still in progress.',
        recovery: 'Wait for the current operation to finish, then frame again.',
      };
    case 'unknown':
      return {
        title: `${frameLabel} failed`,
        message: 'The frame operation failed for an unexpected reason.',
        recovery: 'Do not start the job until framing completes successfully. Check diagnostics and try again.',
        details: result.error,
      };
  }
}

export const FRAME_FAILURE_REASONS: readonly FrameResultReason[] = [
  'no-controller',
  'idle-timeout',
  'command-blocked',
  'command-failed',
  'machine-alarm',
  'disconnected',
  'cancelled',
  'unknown',
  'operation-busy',
];
