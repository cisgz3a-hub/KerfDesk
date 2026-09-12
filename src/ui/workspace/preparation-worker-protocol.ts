// Message contract between the large-job preparation worker and its client
// (ADR-244). Full requests prepare both consumer views from one compile.
// Estimate-only requests omit the unused, potentially enormous preview route.

import type { JobOriginPlacement } from '../../core/job';
import type { OutputScope, Project } from '../../core/scene';
import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';
import type {
  LargeJobEstimate,
  LargeJobPreparation,
  LargeJobPreparationOptions,
} from './large-job-preparation';
import type { PreparationTransferResponse } from './preparation-transfer-protocol';

export type PreparationProjection = 'preview' | 'estimate';

export type PreparationWorkerRequest = {
  readonly id: number;
  readonly project: Project;
  readonly jobOrigin?: JobOriginPlacement;
  readonly outputScope?: OutputScope;
  readonly snapshot?: LargeJobPreparationOptions['snapshot'];
  /** Omitted preserves the full Preview API. */
  readonly projection?: PreparationProjection;
};

export type PreparationWorkerResponse =
  | PreparationTransferResponse
  | { readonly id: number; readonly kind: 'progress'; readonly progress: OutputCompilationProgress }
  | ({
      readonly id: number;
      readonly kind: 'ok';
    } & LargeJobPreparation)
  | ({ readonly id: number; readonly kind: 'estimate' } & LargeJobEstimate)
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
