import type { Toolpath, ToolpathStep } from '../../core/job';
import type { ExecutablePlanPreviewRoute } from './executable-plan-preview-route';
import type { LargeJobPreparation } from './large-job-preparation';
import type { PreviewToolpath } from './preview-status';

// Bounds the many small per-span raster records in each native clone. A
// single step can still contain a large polyline: this is not a byte limit.
export const PREPARATION_TRANSFER_STEP_CHUNK = 2048;

export type PreparationTransferHeader = Omit<LargeJobPreparation, 'toolpath'> & {
  readonly toolpath: Omit<PreviewToolpath, 'steps' | 'executablePlanPreview'>;
  readonly stepCount: number;
  readonly executablePlanPreview?: Omit<ExecutablePlanPreviewRoute, 'toolpath'> & {
    readonly toolpath: Omit<Toolpath, 'steps'>;
    readonly stepCount: number;
  };
};

export type PreparationTransferResponse =
  | {
      readonly id: number;
      readonly sequence: number;
      readonly kind: 'transfer-start';
      readonly header: PreparationTransferHeader;
    }
  | {
      readonly id: number;
      readonly sequence: number;
      readonly kind: 'transfer-chunk';
      readonly route: 'legacy' | 'executable-plan';
      readonly offset: number;
      readonly steps: ReadonlyArray<ToolpathStep>;
    }
  | { readonly id: number; readonly sequence: number; readonly kind: 'transfer-complete' };

export type PreparationTransferAcknowledgement = {
  readonly id: number;
  readonly sequence: number;
  readonly kind: 'transfer-ack';
};
