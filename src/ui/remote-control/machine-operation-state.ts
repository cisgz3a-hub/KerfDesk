import type { AppState } from '../state/store';
import type { LaserMotionOperationId } from '../state/laser-motion-operation';
import type { JobReviewModel } from '../laser/job-review/job-review-model';
import type { JobReviewPresentation } from '../laser/job-review/job-review-presentation';
import type { MachineAuthority, MachineOperation, MachineOperationState } from './machine-types';

export type OwnedMachineOperation = {
  readonly authority: MachineAuthority;
  readonly controller: AbortController;
  readonly documentEpoch: AppState['projectDocumentEpoch'];
  readonly controllerEpoch: number;
  readonly kind: MachineOperation['kind'];
  state: MachineOperationState;
  committed: boolean | null;
  message?: string;
  /** Raw preparation diagnostics stay PC-only without sharing, even after a source disappears. */
  privateMessage?: true;
  motionId?: LaserMotionOperationId;
  runId?: string;
  streamerEpoch?: number;
  motionSettled?: Promise<void>;
  jobSettled?: Promise<void>;
  review?: {
    readonly id: string;
    readonly revision: string;
    readonly model: JobReviewModel;
    readonly presentation: JobReviewPresentation;
    /** Bounded exact-model disclosure context, retained only in local memory. */
    readonly projectPrivateMessage?: (value: string, fallback: string) => string;
  };
  cleanup: () => void;
};

export function operationIsTerminal(operation: OwnedMachineOperation): boolean {
  return ['completed', 'cancelled', 'failed', 'unknown'].includes(operation.state);
}
