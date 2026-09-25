// laser-frame-modal-restore — a Frame that ends before its own pop leaves the
// controller's modal state pushed (controller audit SM-5).
//
// Smoothieware Frames are wrapped in M120 … M121 so the framing feed never
// becomes the G0 seek rate (Robot.cpp L1144-L1149 takes F on a G0 as the seek
// rate). KerfDesk sends the Frame one line per completed leg, so a Stop, an
// Abort (Ctrl-X), a kill/limit halt or a rejected leg ends it before its M121,
// and Robot has no halt handler to restore the state (Robot.cpp L131-L133):
// every later bare G0 of a job then runs at the framing feed.
//
// Each Frame push the transport accepts is counted; a Frame that completes
// cleanly executed its own pop. Whatever is left is restored with the driver's
// pop once the controller is Idle (so unhalted) and nothing else owns it. A pop
// on an empty stack does nothing (Robot::pop_state checks `empty()`,
// Robot.cpp L340-L352), so a surplus pop is harmless.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L340-L352

import type { ControllerDriver } from '../../core/controllers';
import type { StatusReport } from '../../core/controllers/grbl';
import type { HandlerRefs, SafeWriteFn, SetFn, GetFn } from './laser-line-shared';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { isActiveJob, pushLog } from './laser-store-helpers';
import { pendingTransportWriteCount } from './laser-start-queue-fence';

type FramePushState = Pick<LaserState, 'framePushesAwaitingPop'>;

/** A successful Frame write of the driver's modal push owes one pop. */
export function framePushWritePatch(
  state: FramePushState,
  driver: ControllerDriver,
  line: string,
  action: LaserSafetyAction | undefined,
): Partial<FramePushState> {
  const modal = driver.commands.frameModalState;
  if (action !== 'frame' || modal === undefined || line !== `${modal.push}\n`) return {};
  return { framePushesAwaitingPop: (state.framePushesAwaitingPop ?? 0) + 1 };
}

/** A Frame that completed cleanly ran its own pop. */
export function cleanFramePopPatch(state: FramePushState): Partial<FramePushState> {
  const pending = state.framePushesAwaitingPop ?? 0;
  return pending > 0 ? { framePushesAwaitingPop: pending - 1 } : {};
}

/** Called by the status pipeline after it applied `report`. */
export function restoreInterruptedFrameModalState(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  report: StatusReport,
): void {
  const modal = refs.driver.commands.frameModalState;
  const state = get();
  const pending = state.framePushesAwaitingPop ?? 0;
  if (modal === undefined || pending === 0 || report.state !== 'Idle') return;
  if (!controllerIsFree(state) || !lifecycleIsFree(refs)) return;
  set({
    framePushesAwaitingPop: 0,
    log: pushLog(
      state,
      `[lf2] A Frame ended before its ${modal.pop}; sent ${modal.pop} so job travel keeps the configured seek rate.`,
    ),
  });
  void safeWrite(`${modal.pop}\n`.repeat(pending), undefined, 'system').catch(() => undefined);
}

function controllerIsFree(state: LaserState): boolean {
  return (
    state.connection.kind === 'connected' &&
    state.motionOperation === null &&
    state.controllerOperation === null &&
    !isActiveJob(state.streamer) &&
    state.pendingUntrackedAcks === 0 &&
    pendingTransportWriteCount(state) === 0 &&
    state.alarmCode === null &&
    state.mpgActive !== true &&
    !state.autofocusBusy &&
    !state.probeBusy
  );
}

function lifecycleIsFree(refs: HandlerRefs): boolean {
  return refs.controllerCommand === null && refs.controllerStatusWait == null;
}
