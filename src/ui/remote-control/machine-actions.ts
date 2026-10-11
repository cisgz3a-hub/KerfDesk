import { connectOptionsForDevice } from '../commands/connect-options';
import { isActiveJob } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import type { MachineExecutionOwner } from '../state/machine-execution-owner';
import type { MachineExecutionContext } from './machine-execution';
import type { OwnedMachineOperation } from './machine-operation-state';
import type { MachineCommand } from './machine-types';
import { RemoteFault } from './fault';

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
  done: string,
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
  operation.message = done;
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
    // 'automatic' never opens a port picker: it reuses the port the operator chose on this PC.
    () =>
      useLaserStore
        .getState()
        .connect(platform, { ...connectOptionsForDevice(device), portSelection: 'automatic' }),
    'The machine could not connect. Connect it once on the PC.',
    'Connected.',
  );
  if (useLaserStore.getState().connection.kind !== 'connected') {
    operation.committed = false;
    throw new MachineRefusal(
      'No saved connection was found. Connect the machine once on the PC, then try again.',
    );
  }
}

export async function executeDisconnect(operation: OwnedMachineOperation): Promise<void> {
  const laser = useLaserStore.getState();
  if (isActiveJob(laser.streamer) || laser.motionOperation !== null)
    throw new MachineRefusal('Stop the job or motion before disconnecting.');
  await settle(
    operation,
    () => useLaserStore.getState().disconnect(),
    'Disconnect did not finish.',
    'Disconnected.',
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

export async function executeOrigin(
  input: Extract<MachineCommand, { readonly command: 'set_work_origin' }>,
  operation: OwnedMachineOperation,
): Promise<void> {
  await settle(
    operation,
    () =>
      input.args.axes === 'z'
        ? useLaserStore.getState().zeroZHere()
        : useLaserStore.getState().setOriginHere(),
    'The origin could not be set. Check the machine on the PC.',
    input.args.axes === 'z' ? 'Z zeroed here.' : 'Work origin set here.',
  );
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
