import type { ControllerDriver } from '../../core/controllers';
import type { MachineKind } from '../../core/scene';
import { framedRunStartHandoffIssue, type FramedRunPermit } from './framed-run';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import { waitForFreshControllerStatus } from './laser-controller-status-wait';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (line: string) => Promise<void>;
type DriverFn = () => ControllerDriver;

const LIVE_STATUS_TIMEOUT_MS = 3_000;
export const LASER_LIVE_STATUS_TIMEOUT_MESSAGE =
  'Laser Start could not obtain a fresh same-session controller status report after its final status query. Check the connection and try again.';

/** Ordinary Frame-authorized laser Start only. Recovery/replay paths have
 * separate resumability evidence and intentionally do not carry a permit. */
export async function refreshLaserLiveStartState(args: {
  readonly set: SetFn;
  readonly get: GetFn;
  readonly refs: ControllerLifecycleRefs;
  readonly safeWrite: SafeWriteFn;
  readonly driver: DriverFn;
  readonly machineKind: MachineKind;
  readonly permit: FramedRunPermit | undefined;
}): Promise<void> {
  if (args.machineKind !== 'laser' || args.permit === undefined) return;
  const query = args.driver().realtime.statusQuery;
  if (query === null) rejectLaserStart(args.set, args.get, LASER_LIVE_STATUS_TIMEOUT_MESSAGE);
  if (args.get().framedRun !== args.permit) {
    rejectLaserStart(
      args.set,
      args.get,
      'The completed Frame permit changed before the final Laser Start status query. Frame the exact job again.',
    );
  }

  args.set((state) => ({
    controllerOperation:
      state.controllerOperation?.kind === 'start-arming'
        ? { ...state.controllerOperation, phase: 'live-status' }
        : { kind: 'start-arming', phase: 'live-status' },
  }));
  await args.safeWrite(query);
  const afterWrite = {
    sessionEpoch: args.get().controllerSessionEpoch,
    sequence: args.get().statusSequence,
  };
  if (afterWrite.sessionEpoch !== args.permit.controller.controllerSessionEpoch) {
    rejectLaserStart(
      args.set,
      args.get,
      'The controller session changed before the final Laser Start status query completed. Frame the exact job again.',
    );
  }

  const report = await waitForFreshControllerStatus(args.refs, {
    after: afterWrite,
    accept: () => true,
    timeoutMs: LIVE_STATUS_TIMEOUT_MS,
    timeoutMessage: LASER_LIVE_STATUS_TIMEOUT_MESSAGE,
  }).catch((error: unknown) =>
    rejectLaserStart(args.set, args.get, error instanceof Error ? error.message : String(error)),
  );
  if (report.state !== 'Idle') {
    rejectLaserStart(
      args.set,
      args.get,
      `Laser Start requires the fresh post-query report to be Idle; the controller reported ${report.state}.`,
    );
  }
  const issue = framedRunStartHandoffIssue(args.permit, args.get());
  if (issue !== null) rejectLaserStart(args.set, args.get, issue);
}

function rejectLaserStart(set: SetFn, get: GetFn, message: string): never {
  set({
    lastWriteError: message,
    log: pushLog(get(), `[lf2] Laser Start blocked: ${message}`),
  });
  throw new Error(message);
}
