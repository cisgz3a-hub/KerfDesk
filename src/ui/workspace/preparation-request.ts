import type { Project } from '../../core/scene';
import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';
import type {
  LargeJobEstimate,
  LargeJobPreparation,
  LargeJobPreparationOptions,
} from './large-job-preparation';
import type { PreparationProjection } from './preparation-worker-protocol';

/** Why the scheduler dropped a request instead of returning a result. */
export type PreparationSupersedeReason = 'newer-project' | 'newer-request' | 'consumer-cancelled';

const SUPERSEDE_MESSAGES: Record<PreparationSupersedeReason, string> = {
  'newer-project': 'superseded by a newer project',
  'newer-request': 'superseded by a newer request',
  'consumer-cancelled': 'preparation consumer cancelled',
};

/** A scheduling outcome that consumers ignore; real worker failures use Error. */
export class PreparationSupersededError extends Error {
  override readonly name = 'PreparationSupersededError';
  readonly reason: PreparationSupersedeReason;

  constructor(reason: PreparationSupersedeReason) {
    super(SUPERSEDE_MESSAGES[reason]);
    this.reason = reason;
  }
}

export function isPreparationSuperseded(error: unknown): boolean {
  return error instanceof PreparationSupersededError;
}

export type QueuedRequest = {
  readonly project: Project;
  readonly key: string;
  readonly options: LargeJobPreparationOptions;
  readonly projection: PreparationProjection;
  readonly resolve: (result: LargeJobPreparation | LargeJobEstimate) => void;
  readonly reject: (err: Error) => void;
  readonly resolveEstimate?: (result: LargeJobEstimate) => void;
  readonly onProgress?: (progress: OutputCompilationProgress) => void;
};

export type ActiveRequest = QueuedRequest & { readonly id: number };

/** Exact immutable-project identity is checked separately by the client. */
export function requestKey(options: LargeJobPreparationOptions): string {
  return JSON.stringify({
    jobOrigin: options.jobOrigin ?? null,
    outputScope: options.outputScope ?? null,
    contourEntryBounds: options.contourEntryBounds,
    absoluteProgramOffset: options.absoluteProgramOffset,
    workZeroBedPosition: options.workZeroBedPosition,
    laserMaxPowerS: options.laserMaxPowerS,
    snapshot: options.snapshot ?? null,
    initialPosition:
      options.initialPosition === undefined
        ? null
        : [options.initialPosition.x, options.initialPosition.y, options.initialPosition.z ?? null],
  });
}

/** Join exact-input consumers without restarting a compile already in progress. */
export function mergePreparationRequest(
  requested: QueuedRequest,
  held: QueuedRequest | undefined,
  running: ActiveRequest | null,
): QueuedRequest {
  const progress = requested.onProgress ?? held?.onProgress;
  const resolveEstimate =
    held?.resolveEstimate ?? (running?.projection === 'estimate' ? running.resolve : undefined);
  return {
    ...requested,
    resolve: (result) => {
      held?.resolve(result);
      requested.resolve(result);
    },
    reject: (error) => {
      held?.reject(error);
      requested.reject(error);
    },
    ...(resolveEstimate === undefined ? {} : { resolveEstimate }),
    ...(progress === undefined ? {} : { onProgress: progress }),
  };
}
