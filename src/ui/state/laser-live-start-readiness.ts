import type { ControllerDriver } from '../../core/controllers';
import type { StatusReport } from '../../core/controllers/grbl';
import { laserOutputRefusal } from '../../core/preflight/laser-module-readiness';
import type { MachineKind } from '../../core/scene';
import { framedRunStartHandoffIssue, type FramedRunPermit } from './framed-run';
import { connectedLaserModuleEvidence } from './laser-module-probe';
import { startControllerCommand, type ControllerLifecycleRefs } from './laser-interactive-command';
import {
  waitForFreshControllerStatus,
  type ControllerStatusStamp,
} from './laser-controller-status-wait';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';
import type { TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;
type DriverFn = () => ControllerDriver;

const LIVE_STATUS_TIMEOUT_MS = 3_000;
export const LASER_LIVE_STATUS_TIMEOUT_MESSAGE =
  'Laser Start could not obtain a fresh same-session controller status report after its final status query. Check the connection and try again.';

/** Every laser Start first proves the controller can run laser output at all.
 * The live-status proof that follows is for the ordinary Frame-authorized
 * Start only: recovery/replay paths have separate resumability evidence and
 * intentionally do not carry a permit. */
export async function refreshLaserLiveStartState(args: {
  readonly set: SetFn;
  readonly get: GetFn;
  readonly refs: ControllerLifecycleRefs;
  readonly safeWrite: SafeWriteFn;
  readonly driver: DriverFn;
  readonly machineKind: MachineKind;
  readonly permit: FramedRunPermit | undefined;
}): Promise<void> {
  if (args.machineKind !== 'laser') return;
  // Every laser Start, recovery and replay included: a controller without its
  // laser module factually cannot run laser output (controller audit SM-3).
  const noLaserOutput = laserOutputRefusal(connectedLaserModuleEvidence(args.get()));
  if (noLaserOutput !== null) {
    rejectLaserStart(args.set, args.get, `${noLaserOutput} No program bytes were sent.`);
  }
  if (args.permit === undefined) return;
  const driver = args.driver();
  if (driver.realtime.statusQuery === null && driver.commands.queuedStatusQuery === null) {
    rejectLaserStart(args.set, args.get, LASER_LIVE_STATUS_TIMEOUT_MESSAGE);
  }
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
  const statusArgs = { ...args, permit: args.permit };
  const report = await freshStatusAfterQuery(statusArgs, driver).catch((error: unknown) =>
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

type LiveStatusArgs = Parameters<typeof refreshLaserLiveStartState>[0] & {
  readonly permit: FramedRunPermit;
};

const SESSION_CHANGED_MESSAGE =
  'The controller session changed before the final Laser Start status query completed. Frame the exact job again.';

// A realtime `?` is answered out of band, so the stamp follows the write. A
// queued-poll controller (Marlin) has no realtime query: it gets an owned M400
// fence, whose ok proves the planner drained, then an owned M114, whose
// position line arrives before its own ok. Refusing there refused every
// Frame-authorized laser Start on Marlin (controller audit gap-start-1).
async function freshStatusAfterQuery(
  args: LiveStatusArgs,
  driver: ControllerDriver,
): Promise<StatusReport> {
  const realtimeQuery = driver.realtime.statusQuery;
  if (realtimeQuery !== null) {
    await args.safeWrite(realtimeQuery);
    return waitForFreshStatus(args, currentStamp(args));
  }
  await ownedStartLine(args, 'Laser Start queue fence', driver.commands.settleDwell);
  const report = waitForFreshStatus(args, currentStamp(args));
  const [confirmed] = await Promise.all([
    report,
    ownedStartLine(args, 'Laser Start status query', driver.commands.queuedStatusQuery ?? ''),
  ]);
  return confirmed;
}

function currentStamp(args: LiveStatusArgs): ControllerStatusStamp {
  const stamp = {
    sessionEpoch: args.get().controllerSessionEpoch,
    sequence: args.get().statusSequence,
  };
  if (stamp.sessionEpoch !== args.permit.controller.controllerSessionEpoch) {
    throw new Error(SESSION_CHANGED_MESSAGE);
  }
  return stamp;
}

function waitForFreshStatus(
  args: LiveStatusArgs,
  after: ControllerStatusStamp,
): Promise<StatusReport> {
  return waitForFreshControllerStatus(args.refs, {
    after,
    accept: () => true,
    timeoutMs: LIVE_STATUS_TIMEOUT_MS,
    timeoutMessage: LASER_LIVE_STATUS_TIMEOUT_MESSAGE,
  });
}

async function ownedStartLine(args: LiveStatusArgs, label: string, line: string): Promise<void> {
  await startControllerCommand(args.refs, args.safeWrite, {
    kind: 'start-arming',
    label,
    command: `${line}\n`,
    timeoutMs: LIVE_STATUS_TIMEOUT_MS,
  });
}

function rejectLaserStart(set: SetFn, get: GetFn, message: string): never {
  set({
    lastWriteError: message,
    log: pushLog(get(), `[lf2] Laser Start blocked: ${message}`),
  });
  throw new Error(message);
}
