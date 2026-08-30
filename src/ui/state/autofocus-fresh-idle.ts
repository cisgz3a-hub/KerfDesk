import type { StatusReport } from '../../core/controllers/grbl';
import {
  waitForFreshControllerStatus,
  type ControllerStatusStamp,
} from './laser-controller-status-wait';
import type { LiveRefs, LaserState } from './laser-store';
import type { LaserSafetyAction } from './laser-safety-notice';
import { mpgCommandBlockMessage } from './laser-store-helpers';
import type { TranscriptSource } from './laser-transcript';

type GetFn = () => LaserState;
type WriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

const FRESH_IDLE_TIMEOUT_MS = 3_000;
const FRESH_IDLE_TIMEOUT_MESSAGE =
  'Auto-focus needs a fresh controller status report before motion. No report arrived after the status query.';

export async function confirmFreshAutofocusIdle(args: {
  readonly get: GetFn;
  readonly refs: LiveRefs;
  readonly write: WriteFn;
  readonly timeoutMs?: number;
}): Promise<StatusReport> {
  const query = args.refs.driver.realtime.statusQuery;
  if (query === null) throw new Error('This controller cannot provide live status for auto-focus.');

  await args.write(query, 'autofocus', 'motion');
  const afterWrite = statusStamp(args.get());
  const report = await waitForFreshControllerStatus(args.refs, {
    after: afterWrite,
    accept: () => true,
    timeoutMs: args.timeoutMs ?? FRESH_IDLE_TIMEOUT_MS,
    timeoutMessage: FRESH_IDLE_TIMEOUT_MESSAGE,
  });
  if (args.get().controllerSessionEpoch !== afterWrite.sessionEpoch) {
    throw new Error('Controller session changed before auto-focus could start.');
  }
  const mpgBlock = mpgCommandBlockMessage(args.get());
  if (mpgBlock !== null) throw new Error(mpgBlock);
  return report;
}

function statusStamp(state: LaserState): ControllerStatusStamp {
  return { sessionEpoch: state.controllerSessionEpoch, sequence: state.statusSequence };
}
