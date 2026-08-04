import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import type { IdleCanvasMotionPlanRequest } from './idle-canvas-motion-plan';

export type IdleCanvasMotionWorkerRequest = {
  readonly id: number;
  readonly request: IdleCanvasMotionPlanRequest;
};

export type IdleCanvasMotionWorkerResponse =
  | { readonly id: number; readonly kind: 'ok'; readonly plan: CanvasMotionPlan | null }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
