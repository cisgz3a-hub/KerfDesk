import type { DeviceProfile } from '../../core/devices';
import type { Toolpath } from '../../core/job';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { CncMachineConfig } from '../../core/scene';
import type { RemovalGrid } from '../../core/sim';

export type CncRemovalGridWorkerRequest =
  | {
      readonly id: number;
      readonly kind: 'grid';
      readonly device: DeviceProfile;
      readonly machine: CncMachineConfig;
      readonly toolpath: Toolpath;
      readonly scrubFraction: number;
    }
  | {
      readonly id: number;
      readonly kind: 'surface';
      readonly grid: RemovalGrid;
    };

export type CncRemovalGridWorkerResponse =
  | { readonly id: number; readonly kind: 'grid'; readonly grid: RemovalGrid | null }
  | {
      readonly id: number;
      readonly kind: 'surface';
      readonly surface: ReliefSurfaceMeshWithNormals;
    }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
