import type { MachineExecutionOwner } from '../state/machine-execution-owner';
import type { JobReviewPresenter } from './job-review/job-review-presentation';

export type FramedStartOptions = {
  readonly executionOwner?: MachineExecutionOwner;
  readonly presenter?: JobReviewPresenter;
  readonly onStartCommitted?: (runId: string, streamerEpoch: number) => void;
};
