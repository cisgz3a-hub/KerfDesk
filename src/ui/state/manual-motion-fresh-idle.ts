import type { StatusReport } from '../../core/controllers/grbl';
import { waitForFreshControllerStatus } from './laser-controller-status-wait';
import type { LiveRefs, LaserState } from './laser-store';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { TranscriptSource } from './laser-transcript';

type GetFn = () => LaserState;
type WriteFn = (
  line: string,
  action: LaserSafetyAction | undefined,
  source: TranscriptSource,
) => Promise<void>;
type ManualMotionRefs = Pick<LiveRefs, 'driver' | 'controllerStatusWait'>;

export const MANUAL_MOTION_STATUS_MAX_AGE_MS = 1_000;
export const MANUAL_MOTION_STATUS_TIMEOUT_MESSAGE =
  'Manual motion could not obtain a fresh same-session controller status after its status query. Check the connection and try again.';

export async function confirmFreshManualMotionIdle(args: {
  readonly get: GetFn;
  readonly refs: ManualMotionRefs;
  readonly write: WriteFn;
  readonly action: Extract<LaserSafetyAction, 'jog' | 'frame' | 'origin' | 'console'>;
  readonly source?: TranscriptSource;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}): Promise<StatusReport> {
  const before = args.get();
  const observation = before.statusObservation;
  const now = (args.now ?? Date.now)();
  const cachedIdle = freshCachedIdle(before, observation, now);
  if (cachedIdle !== null) return cachedIdle;

  const query = args.refs.driver.realtime.statusQuery;
  if (query === null) throw new Error(MANUAL_MOTION_STATUS_TIMEOUT_MESSAGE);
  await args.write(query, args.action, args.source ?? 'motion');
  const afterWrite = args.get();
  const stamp = {
    sessionEpoch: afterWrite.controllerSessionEpoch,
    sequence: afterWrite.statusSequence,
  };
  const report = await waitForFreshControllerStatus(args.refs, {
    after: stamp,
    accept: () => true,
    timeoutMs: args.timeoutMs ?? 3_000,
    timeoutMessage: MANUAL_MOTION_STATUS_TIMEOUT_MESSAGE,
  });
  const current = args.get();
  if (current.controllerSessionEpoch !== stamp.sessionEpoch) {
    throw new Error('Controller session changed before manual motion could start.');
  }
  if (report.state !== 'Idle') {
    throw new Error(
      `Manual motion requires a fresh Idle report; the controller reported ${report.state}.`,
    );
  }
  return report;
}

function freshCachedIdle(
  state: LaserState,
  observation: LaserState['statusObservation'],
  now: number,
): StatusReport | null {
  const report = state.statusReport;
  const fresh =
    report?.state === 'Idle' &&
    observation !== null &&
    observation.sessionEpoch === state.controllerSessionEpoch &&
    observation.positionEpoch === (state.trustedPositionEpoch ?? 0) &&
    now - observation.observedAt <= MANUAL_MOTION_STATUS_MAX_AGE_MS;
  return fresh ? report : null;
}
