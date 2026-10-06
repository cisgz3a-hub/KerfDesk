import type { JobReviewModel } from '../laser/job-review/job-review-model';

/** Lifetime of a granted client, independent of a completed command RPC. */
export type MachineAuthority = {
  readonly clientId: string;
  readonly sessionId: string;
  readonly signal: AbortSignal;
  readonly assertCurrent: () => void;
};
export type RemoteCaller = { readonly clientId: string; readonly sessionId: string };
export type MachineCommand =
  | { readonly command: 'get_machine_status'; readonly args: Record<string, never> }
  | {
      readonly command: 'get_control_operation';
      readonly args: {
        readonly operationId: string;
        readonly reviewPage?: MachineReviewPageRequest;
      };
    }
  | {
      readonly command: 'jog_machine';
      readonly args: MachineAdmission & {
        readonly axis: 'x' | 'y' | 'z';
        readonly direction: -1 | 1;
        readonly distanceMm: number;
        readonly feedMmPerMin?: number;
      };
    }
  | { readonly command: 'frame_job' | 'review_machine_job'; readonly args: MachineAdmission }
  | {
      readonly command: 'start_job';
      readonly args: MachineAdmission & { readonly reviewId: string };
    }
  | { readonly command: 'abort_job'; readonly args: { readonly requestId: string } };
export type MachineAdmission = { readonly expectedRevision: string; readonly requestId: string };
export type MachineReviewPageRequest = { readonly reviewId: string; readonly offset: number };
export type MachineOperationState =
  | 'accepted'
  | 'preparing'
  | 'awaiting_review'
  | 'starting'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'unknown';
export type MachineReview = {
  readonly reviewId: string;
  readonly revision: string;
  readonly mode: 'laser' | 'cnc';
  readonly artworkShared?: boolean;
  readonly stats: JobReviewModel['stats'];
  readonly warnings: readonly { readonly code: string; readonly message: string }[];
  readonly operations: readonly {
    readonly operationId: string;
    readonly summaries: readonly string[];
    readonly index?: number;
    readonly summaryOffset?: number;
    readonly summaryTotal?: number;
  }[];
  /** Absent only on older desktops. Counts always describe this same canonical review. */
  readonly pagination?: {
    readonly offset: number;
    readonly nextOffset: number | null;
    readonly totalFacts: number;
    readonly totalWarnings: number;
    readonly totalOperations: number;
    readonly totalStats: number;
    readonly totalSummaries: number;
  };
  readonly acknowledgement: JobReviewModel['acknowledgement'];
  readonly frame: { readonly required: true; readonly complete: boolean };
};
export type MachineOperation = {
  readonly operationId: string;
  readonly kind: 'jog' | 'frame' | 'job' | 'abort';
  readonly state: MachineOperationState;
  readonly revision: string;
  readonly committed: boolean | null;
  readonly message?: string;
  readonly review?: MachineReview;
};
