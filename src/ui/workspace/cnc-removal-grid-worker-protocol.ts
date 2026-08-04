import type { DeviceProfile } from '../../core/devices';
import type { Toolpath } from '../../core/job';
import type { CncMachineConfig } from '../../core/scene';
import type { RemovalGrid } from '../../core/sim';

export type CncRemovalGridWorkerRequest = {
  readonly id: number;
  readonly device: DeviceProfile;
  readonly machine: CncMachineConfig;
  readonly toolpath: Toolpath;
  readonly scrubFraction: number;
};

export type CncRemovalGridWorkerResponse =
  | { readonly id: number; readonly kind: 'ok'; readonly grid: RemovalGrid | null }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
