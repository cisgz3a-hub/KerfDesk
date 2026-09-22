import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import type { ProjectMessage } from '../packed-project-transfer';
import type { IdleCanvasMotionPlanRequest } from './idle-canvas-motion-plan';

/** The plan request on the wire: its project may travel packed (ADR-346). */
export type IdleCanvasMotionWireRequest = Omit<IdleCanvasMotionPlanRequest, 'project'> & {
  readonly project: ProjectMessage;
};

export type IdleCanvasMotionWorkerRequest = {
  readonly id: number;
  readonly request: IdleCanvasMotionWireRequest;
};

export type IdleCanvasMotionWorkerResponse =
  | { readonly id: number; readonly kind: 'ok'; readonly plan: CanvasMotionPlan | null }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
