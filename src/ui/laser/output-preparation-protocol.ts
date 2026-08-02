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
 * Worker response for one preparation. Save callers must branch on
 * `result.kind` because `preparation-failed` and `emission-refused` carry no
 * writable G-code.
 */
export type OutputPreparationResponse =
  | { readonly kind: 'start'; readonly result: StartJobPreparation }
  | { readonly kind: 'save'; readonly result: SaveOutputEmission }
  | { readonly kind: 'error'; readonly message: string };

/**
 * One request addressed to the shared preparation worker. The worker serves
 * many Start and Save preparations over its lifetime, and Start's handoff
 * consistency requires the streamed program to be the exact one that was
 * reviewed — so the id travels with the request and comes back on its
 * response. The request is carried unmodified in its own field: the worker
 * reads nothing but `request`, so no correlation field can reach the compile.
 */
export type OutputPreparationEnvelope = {
  readonly requestId: number;
  readonly request: OutputPreparationRequest;
};

/** Worker reply, correlated to its originating request by `requestId`. */
export type OutputPreparationResult = {
  readonly requestId: number;
  readonly response: OutputPreparationResponse;
};
