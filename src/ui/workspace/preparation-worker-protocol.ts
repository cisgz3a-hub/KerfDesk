// Message contract between the large-job preparation worker and its client
// (ADR-244). Full requests prepare both consumer views from one compile.
// Estimate-only requests omit the unused, potentially enormous preview route.

import type { PackedToolpath } from '../../core/job/packed-toolpath';
import type { PreviewToolpath } from './preview-status';
import type { ProjectMessage } from '../packed-project-transfer';
import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';
import type {
  LargeJobEstimate,
  LargeJobPreparation,
  LargeJobPreparationOptions,
} from './large-job-preparation';
import type { PreparationTransferResponse } from './preparation-transfer-protocol';

export type PreparationProjection = 'preview' | 'estimate';

export type PreparationWorkerRequest = LargeJobPreparationOptions & {
  readonly id: number;
  /** A plain Project, or its geometry packed into transferred buffers (ADR-346). */
  readonly project: ProjectMessage;
  /** Omitted preserves the full Preview API. */
  readonly projection?: PreparationProjection;
};

/**
 * A route already in columnar buffers. One message, and the buffers are
 * transferred rather than cloned, so the acknowledged chunk protocol below is
 * needed only for routes that could not be packed.
 */
export type PreparationPackedResponse = Omit<LargeJobPreparation, 'toolpath'> & {
  readonly id: number;
  readonly kind: 'packed';
  readonly toolpath: Omit<PreviewToolpath, 'steps' | 'executablePlanPreview'>;
  readonly packed: PackedToolpath;
};

export type PreparationWorkerResponse =
  | PreparationTransferResponse
  | PreparationPackedResponse
  | { readonly id: number; readonly kind: 'progress'; readonly progress: OutputCompilationProgress }
  | ({
      readonly id: number;
      readonly kind: 'ok';
    } & LargeJobPreparation)
  | ({ readonly id: number; readonly kind: 'estimate' } & LargeJobEstimate)
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
