// The LightBurn gap batch 5 store actions (ADR-480), composed into the batch 3
// editing-tools slice so the store gains no new slice.

import {
  imageMaskFlattenActions,
  type ImageMaskFlattenActions,
} from './image-mask-flatten-actions';
import { pathCleanupActions, type PathCleanupActions } from './path-cleanup-actions';
import {
  rubberBandOutlineActions,
  type RubberBandOutlineActions,
} from './rubber-band-outline-actions';
import { shapeQueryActions, type ShapeQueryActions } from './shape-query-actions';
import type { AppState } from './store';

export type DesignToolsActions = ShapeQueryActions &
  PathCleanupActions &
  RubberBandOutlineActions &
  ImageMaskFlattenActions;

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function designToolsActions(set: Setter): DesignToolsActions {
  return {
    ...shapeQueryActions(set),
    ...pathCleanupActions(set),
    ...rubberBandOutlineActions(set),
    ...imageMaskFlattenActions(set),
  };
}
