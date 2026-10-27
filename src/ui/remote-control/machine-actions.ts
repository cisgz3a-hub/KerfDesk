import { connectOptionsForDevice } from '../commands/connect-options';
import { placementAfterSetOrigin } from '../laser/set-origin-placement';
import { liveZeroZOverwriteWarning, REMOTE_ZERO_Z_REFUSAL } from '../laser/zero-z-guard';
import { pauseAutoConnect } from '../state/auto-connect-session';
import { isActiveJob, setupCommandBlockMessage } from '../state/laser-store-helpers';
import { hasPendingControllerWrite } from '../state/laser-start-queue-fence';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import type { MachineExecutionOwner } from '../state/machine-execution-owner';
import type { MachineExecutionContext } from './machine-execution';
import type { OwnedMachineOperation } from './machine-operation-state';
import type { MachineCommand } from './machine-types';
import { RemoteFault } from './fault';
import { boardCaptureBlockMessage } from '../laser/board-capture/board-capture-gate';
import {
  currentBoardRemote,
  type BoardRemoteController,
} from '../laser/board-capture/board-capture-remote';
import { proFeaturesUnlocked } from '../licensing/edition';
import { freshBoardReportRefusal } from './machine-board-fresh-report';

/** A refusal whose fixed, controller-state message is safe to show remotely. */
export class MachineRefusal extends RemoteFault {
  constructor(message: string) {
    super('unavailable');
    this.message = message.slice(0, 300);
  }
}
function refusal(error: unknown, fallback: string): RemoteFault {
  if (error instanceof RemoteFault) return error;
  const message = error instanceof Error ? error.message : '';
  // Desktop controller notices are fixed strings; anything resembling a path or URL is dropped.
  return new MachineRefusal(
    message !== '' && !/[\\/]{2}|[a-z]:[\\/]|https?:/i.test(message) ? message : fallback,
  );
}
async function settle(
  operation: OwnedMachineOperation,
  run: () => Promise<unknown>,
  fallback: string,
  done: string | (() => string),
): Promise<void> {
  operation.state = 'running';
  operation.committed = null;
  try {
    await run();
  } catch (error) {
    throw refusal(error, fallback);
  }
  operation.committed = true;
  operation.state = 'completed';
  operation.message = typeof done === 'function' ? done() : done;
}

export async function executeConnect(
  operation: OwnedMachineOperation,
  context: MachineExecutionContext,
): Promise<void> {
  const platform = context.options.getPlatform?.() ?? null;
  if (platform === null) throw new RemoteFault('unavailable');
  if (useLaserStore.getState().connection.kind === 'connected') {
    operation.state = 'completed';
    operation.committed = true;
    operation.message = 'The machine is already connected.';
    return;
  }
  const device = (context.options.store ?? useStore).getState().project.device;
  await settle(
    operation,
    // 'remembered-only' never opens a port picker: it reuses the port the
    // operator chose on this PC. A person asked for it, so unlike the
    // background auto-connect its failure is reported, and once the port opens
    // it lifts the pause a Disconnect set (ADR-639).
    () =>
      useLaserStore.getState().connect(platform, {
        ...connectOptionsForDevice(device),
        portSelection: 'remembered-only',
      }),
    'The machine could not connect. Connect it once on the PC.',
    'Connected.',
  );
  const connection = useLaserStore.getState().connection;
  if (connection.kind === 'connected') return;
  operation.committed = false;
  // The saved port was found but would not open, usually because another
  // program holds it. That is not a missing saved connection.
  if (connection.kind === 'failed') throw connectFailureRefusal(connection.error);
  throw new MachineRefusal(
    'No saved connection was found. Connect the machine once on the PC, then try again.',
  );
}

function connectFailureRefusal(error: string): RemoteFault {
  if (/failed to open serial port/i.test(error)) {
    return new MachineRefusal(
      'The machine’s port is busy or unavailable on the PC. Close any other program using it, then try again.',
    );
  }
  return refusal(
    new Error(`The machine could not connect: ${error}`),
    'The machine could not connect. Check it on the PC.',
  );
}

export async function executeDisconnect(operation: OwnedMachineOperation): Promise<void> {
  const blocked = disconnectMachineBlockMessage(useLaserStore.getState());
  if (blocked !== null) throw new MachineRefusal(blocked);
  // Someone ended the connection remotely: a plug-in or power-cycle must not
  // reopen it by itself until someone connects again (ADR-639).
  pauseAutoConnect();
  await settle(
    operation,
    () => useLaserStore.getState().disconnect(),
    'Disconnect did not finish.',
    'Disconnected.',
  );
}

export function disconnectMachineBlockMessage(
  laser: ReturnType<typeof useLaserStore.getState>,
): string | null {
  return (
    setupCommandBlockMessage(laser) ??
    (hasPendingControllerWrite(laser)
      ? 'Wait for the pending controller command before disconnecting.'
      : null)
  );
}

export async function executeHome(operation: OwnedMachineOperation): Promise<void> {
  await settle(
    operation,
    () => useLaserStore.getState().home(),
    'Home did not finish. Check the machine on the PC.',
    'Homing finished.',
  );
}

/** The PC's Zero Z and Set origin, with the guards the PC wraps them in. */
export async function executeOrigin(
  input: Extract<MachineCommand, { readonly command: 'set_work_origin' }>,
  operation: OwnedMachineOperation,
  context: MachineExecutionContext,
): Promise<void> {
  const z = input.args.axes === 'z';
  // The PC asks before Zero Z replaces an established work Z0. A remote caller
  // cannot answer that question, so it is refused before anything is written.
  if (z && liveZeroZOverwriteWarning(useLaserStore.getState()) !== null)
    throw new MachineRefusal(REMOTE_ZERO_Z_REFUSAL);
  const store = context.options.store ?? useStore;
  await settle(
    operation,
    z
      ? () => useLaserStore.getState().zeroZHere()
      : async () => {
          await useLaserStore.getState().setOriginHere();
          placementAfterSetOrigin(operation.documentEpoch, store);
        },
    'The origin could not be set. Check the machine on the PC.',
    z ? 'Z zeroed here.' : 'Work origin set here.',
  );
}

export async function executeBoardAction(
  finish: boolean,
  operation: OwnedMachineOperation,
): Promise<void> {
  if (!proFeaturesUnlocked()) throw new RemoteFault('needs_pro');
  const controller = currentBoardRemote();
  if (controller === null) throw new MachineRefusal('Open Place Board on the computer first.');
  // Refusals before the panel runs leave the controller untouched (state failed); once it runs,
  // a capture or finish may already have written a work origin, so a failure stays unknown.
  const blocked = boardActionBlockMessage(controller, finish);
  if (blocked !== null) throw new MachineRefusal(blocked);
  if (!finish) await awaitFreshBoardReport(controller, operation);
  const notice = finish ? controller.finishReview().notice : null;
  await settle(
    operation,
    () => (finish ? controller.finish() : controller.capture()),
    finish ? 'The board could not be created.' : 'The board point could not be captured.',
    finish
      ? boardCreatedMessage(notice)
      : () => {
          const status = controller.status();
          return `Captured point ${status.captures} of ${status.capturesNeeded ?? status.captures}.`;
        },
  );
}

function boardCreatedMessage(notice: string | null): string {
  const check = 'Check every anchor on the computer, then Frame before Start.';
  return notice === null ? `Board created. ${check}` : `Board created. ${notice} ${check}`;
}

/** The panel's own refusals, then the gate that disables the PC's Capture and Finish buttons,
 * then what the PC shows before Finish (ADR-654 Amendment 1). */
function boardActionBlockMessage(
  controller: BoardRemoteController,
  finish: boolean,
): string | null {
  const status = controller.status();
  if (status.busy) return 'Place Board is busy on the computer. Wait, then try again.';
  if (status.committed) return 'The board is already created. Start a new capture on the computer.';
  if (!status.coordinatesCurrent)
    return 'Machine coordinates changed during capture. Start over on the computer.';
  const machineBlocked = boardCaptureBlockMessage(useLaserStore.getState());
  if (machineBlocked !== null) return machineBlocked;
  if (finish) return controller.finishReview().refusal;
  return status.capturesNeeded !== null && status.captures >= status.capturesNeeded
    ? 'Every capture point is recorded. Use finish_board.'
    : null;
}

/** Waits for a report newer than the request with the gate still clear. A capture taken on the
 * computer meanwhile refuses, so one head position is never recorded as two points. */
async function awaitFreshBoardReport(
  controller: BoardRemoteController,
  operation: OwnedMachineOperation,
): Promise<void> {
  const captures = controller.status().captures;
  const refusal = await freshBoardReportRefusal(operation, () => {
    if (currentBoardRemote() !== controller) return 'Open Place Board on the computer first.';
    if (controller.status().captures !== captures)
      return 'Place Board changed on the computer. Check it, then try again.';
    return boardActionBlockMessage(controller, false);
  });
  if (refusal !== null) throw new MachineRefusal(refusal);
}

export async function executePauseResume(
  pause: boolean,
  operation: OwnedMachineOperation,
): Promise<void> {
  const laser = useLaserStore.getState();
  if (!isActiveJob(laser.streamer)) throw new MachineRefusal('No job is running.');
  await settle(
    operation,
    () => (pause ? useLaserStore.getState().pauseJob() : useLaserStore.getState().resumeJob()),
    pause ? 'Pause was not confirmed. Check the machine.' : 'Resume was not confirmed.',
    pause ? 'Paused.' : 'Resumed.',
  );
}

export type HoldExecution = (
  operation: OwnedMachineOperation,
  owner: MachineExecutionOwner,
) => Promise<void>;
