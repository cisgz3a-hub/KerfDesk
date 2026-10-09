import { machineKindOf } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { connectOptionsForDevice } from '../commands/connect-options';
import { useStore } from '../state';
import {
  browserLocalStorage,
  loadConfiguredSignatures,
} from '../state/device-setup-configured-persistence';
import { useLaserStore, type ConnectControllerOptions } from '../state/laser-store';
import { deviceProfileSignature } from './device-setup/device-setup-nudge';
import {
  openMachineSetup,
  useMachineSetupDialogStore,
} from './device-setup/machine-setup-dialog-store';

/** Explicit Connect opens unfinished setup in the same click as the port request.
 * Automatic connections, recovery and Find retain their own connection paths. */
export function connectMachine(
  platform: PlatformAdapter,
  options: ConnectControllerOptions = {},
): Promise<void> {
  const { project } = useStore.getState();
  const laser = useLaserStore.getState();
  const storage = browserLocalStorage();
  const configured = storage === null ? new Set<string>() : loadConfiguredSignatures(storage);
  if (
    (laser.connection.kind === 'disconnected' || laser.connection.kind === 'failed') &&
    !configured.has(deviceProfileSignature(project.device, machineKindOf(project.machine))) &&
    useMachineSetupDialogStore.getState().state.kind === 'idle'
  ) {
    openMachineSetup();
  }
  // Do not defer connection to an effect or await setup: requestPort needs the
  // original user gesture. Only the existing setup Save records completion.
  return laser.connect(platform, { ...connectOptionsForDevice(project.device), ...options });
}
