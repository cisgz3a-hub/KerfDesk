import type { ControllerSettingsSnapshot } from '../../core/preflight';
import type { OutputScope, Project } from '../../core/scene';
import type { EmitGcodeOptions } from '../../io/gcode';
import type { JobPlacementSettings } from '../job-placement';
import type { MachineStartSnapshot, StartJobPreparation } from './start-job-readiness';
import type { JobOriginPlacement } from '../../core/job';
import type { SaveOutputEmission } from './save-output-emission';

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

/**
 * One-shot worker response. Save callers must branch on `result.kind` because
 * `preparation-failed` and `emission-refused` carry no writable G-code.
 */
export type OutputPreparationResponse =
  | { readonly kind: 'start'; readonly result: StartJobPreparation }
  | { readonly kind: 'save'; readonly result: SaveOutputEmission }
  | { readonly kind: 'error'; readonly message: string };
