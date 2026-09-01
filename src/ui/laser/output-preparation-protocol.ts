import type { ControllerSettingsSnapshot } from '../../core/preflight';
import type { SimilarityTransform } from '../../core/registration';
import type { OutputScope, Project } from '../../core/scene';
import type { EmitGcodeOptions, PreparedOutput, PrepareOutputOptions } from '../../io/gcode';
import type { JobPlacementSettings } from '../job-placement';
import type { MachineStartSnapshot, StartJobPreparation } from './start-job-readiness';
import type { JobOriginPlacement } from '../../core/job';
import type { SaveOutputEmission } from './save-output-emission';
import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';
import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';
import type { EmitRdOptions, EmitRdResult } from '../../io/rd';
import type { TiledOutputPreparation } from '../app/tiled-output-preparation';

export type OutputSnapshotRequest = {
  readonly registration?: SimilarityTransform | null;
  /** Caller-bound evaluation time; queue latency cannot change variable bytes. */
  readonly evaluatedAtIso: string;
};

export type StartOutputPreparationRequest = {
  readonly kind: 'start';
  readonly project: Project;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly machine: MachineStartSnapshot;
  readonly jobPlacement: JobPlacementSettings;
  readonly outputScope: OutputScope;
  readonly resolvedJobOrigin?: JobOriginPlacement;
  readonly requireFrame: boolean;
  readonly snapshot?: OutputSnapshotRequest;
};

export type SaveOutputPreparationRequest = {
  readonly kind: 'save';
  readonly project: Project;
  readonly options: EmitGcodeOptions;
  readonly controllerSettings?: ControllerSettingsSnapshot | null;
  readonly activeWcs?: ActiveWorkCoordinateSystem | null;
  readonly snapshot?: OutputSnapshotRequest;
};

export type PrepareOnlyOutputPreparationRequest = {
  readonly kind: 'prepare';
  readonly project: Project;
  readonly options: PrepareOutputOptions;
  readonly controllerSettings?: ControllerSettingsSnapshot | null;
  readonly activeWcs?: ActiveWorkCoordinateSystem | null;
};

export type RdOutputPreparationRequest = {
  readonly kind: 'rd';
  readonly project: Project;
  readonly options: EmitRdOptions;
};

export type TiledOutputPreparationRequest = {
  readonly kind: 'tiles';
  readonly project: Project;
  readonly options: PrepareOutputOptions;
  readonly savedName: string | null;
  readonly controllerSettings?: ControllerSettingsSnapshot | null;
  readonly activeWcs?: ActiveWorkCoordinateSystem | null;
};

export type OutputPreparationRequest =
  | StartOutputPreparationRequest
  | SaveOutputPreparationRequest
  | PrepareOnlyOutputPreparationRequest
  | RdOutputPreparationRequest
  | TiledOutputPreparationRequest;

/**
 * Worker response for one preparation. Save callers must branch on
 * `result.kind` because `preparation-failed` and `emission-refused` carry no
 * writable G-code.
 */
export type OutputPreparationResponse =
  | { readonly kind: 'start'; readonly result: StartJobPreparation }
  | { readonly kind: 'save'; readonly result: SaveOutputEmission }
  | { readonly kind: 'rd'; readonly result: EmitRdResult }
  | { readonly kind: 'tiles'; readonly result: TiledOutputPreparation }
  | {
      readonly kind: 'prepared';
      readonly result: PreparedOutput;
      readonly machineWarnings: ReadonlyArray<string>;
    }
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
  readonly kind: 'prepare';
  readonly requestId: number;
  readonly request: OutputPreparationRequest;
};

/** Worker reply, correlated to its originating request by `requestId`. */
export type OutputPreparationResult =
  | {
      readonly requestId: number;
      readonly response: OutputPreparationResponse;
    }
  | {
      readonly requestId: number;
      readonly progress: OutputCompilationProgress;
    };
