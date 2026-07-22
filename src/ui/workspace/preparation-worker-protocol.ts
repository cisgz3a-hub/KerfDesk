// Message contract between the large-job preparation worker and its client
// (ADR-244). One request prepares the project ONCE off-thread and returns
// both consumer views — the preview toolpath and the live estimate — so the
// canvas and the ETA badge share a single expensive compile.

import type { JobOriginPlacement } from '../../core/job';
import type { OutputScope, Project } from '../../core/scene';
import type { LargeJobPreparation } from './large-job-preparation';

export type PreparationWorkerRequest = {
  readonly id: number;
  readonly project: Project;
  readonly jobOrigin?: JobOriginPlacement;
  readonly outputScope?: OutputScope;
};

export type PreparationWorkerResponse =
  | ({
      readonly id: number;
      readonly kind: 'ok';
    } & LargeJobPreparation)
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
