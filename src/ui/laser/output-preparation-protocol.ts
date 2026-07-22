import type { ControllerSettingsSnapshot } from '../../core/preflight';
import type { OutputScope, Project } from '../../core/scene';
import type { EmitGcodeOptions, EmitGcodeResult } from '../../io/gcode';
import type { JobPlacementSettings } from '../job-placement';
import type { MachineStartSnapshot, StartJobPreparation } from './start-job-readiness';
import type { JobOriginPlacement } from '../../core/job';

export type StartOutputPreparationRequest = {
  readonly kind: 'start';
  readonly project: Project;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly machine: MachineStartSnapshot;
  readonly jobPlacement: JobPlacementSettings;
  readonly outputScope: OutputScope;
  readonly resolvedJobOrigin?: JobOriginPlacement;
  readonly allowRotaryRaster: boolean;
  readonly requireFrame: boolean;
};

export type SaveOutputPreparationRequest = {
  readonly kind: 'save';
  readonly project: Project;
  readonly options: EmitGcodeOptions;
};

export type OutputPreparationRequest = StartOutputPreparationRequest | SaveOutputPreparationRequest;

export type OutputPreparationResponse =
  | { readonly kind: 'start'; readonly result: StartJobPreparation }
  | { readonly kind: 'save'; readonly result: EmitGcodeResult }
  | { readonly kind: 'error'; readonly message: string };
