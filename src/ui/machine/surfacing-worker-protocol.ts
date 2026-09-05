import type { SurfacingParams, SurfacingProgram } from '../../core/cnc/surfacing';
import type { DeviceProfile } from '../../core/devices';
import type { PreflightResult } from '../../core/preflight';
import type { CncMachineConfig } from '../../core/scene';
import type { GcodeMetadata } from '../../io/gcode/gcode-metadata';

export type SurfacingWorkerInput = {
  readonly params: SurfacingParams;
  readonly device: DeviceProfile;
  readonly machine: CncMachineConfig;
  readonly metadata: GcodeMetadata;
};
export type PreparedSurfacing = {
  readonly summary: Omit<SurfacingProgram, 'lines'>;
  readonly preflight: PreflightResult;
};
export type SurfacingWorkerRequest =
  | { readonly kind: 'prepare'; readonly input: SurfacingWorkerInput }
  | { readonly kind: 'next' };
export type SurfacingWorkerResponse =
  | { readonly kind: 'ready'; readonly prepared: PreparedSurfacing }
  | { readonly kind: 'chunk'; readonly text: string; readonly done: boolean }
  | { readonly kind: 'error'; readonly message: string };
