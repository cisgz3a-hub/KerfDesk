// The LightBurn gap batch 5 store actions (ADR-480), composed into the batch 3
// editing-tools slice so the store gains no new slice. Copy Along Path, Trim
// Shapes and Cut Shapes (LBG-T09, LBG-T04, LBG-T08) join them, and Optimize
// Shapes (LBG-T22).

import { copyAlongPathActions, type CopyAlongPathActions } from './copy-along-path-actions';
import {
  imageMaskFlattenActions,
  type ImageMaskFlattenActions,
} from './image-mask-flatten-actions';
import { optimizeShapesActions, type OptimizeShapesActions } from './optimize-shapes-actions';
import { pathCleanupActions, type PathCleanupActions } from './path-cleanup-actions';
import {
  rubberBandOutlineActions,
  type RubberBandOutlineActions,
} from './rubber-band-outline-actions';
import { shapeQueryActions, type ShapeQueryActions } from './shape-query-actions';
import type { AppState } from './store';
import { cutShapesActions, type CutShapesActions } from './cut-shapes-actions';
import { drawOrderActions, type DrawOrderActions } from './draw-order-actions';
import { variableBakeActions, type VariableBakeActions } from './variable-bake-actions';
import { pathSegmentActions, type PathSegmentActions } from './path-segment-actions';
import { pathFilletActions, type PathFilletActions } from './path-fillet-actions';
import { shearActions, type ShearActions } from './shear-actions';
import { guideActions, type GuideActions } from './guide-actions';
import { penContinueActions, type PenContinueActions } from './pen-continue-actions';
import {
  pathNodeDragJoinActions,
  type PathNodeDragJoinActions,
} from './path-node-drag-join-actions';
import { mirrorLineActions, type MirrorLineActions } from './mirror-line-actions';
import { extendShapesActions, type ExtendShapesActions } from './extend-shapes-actions';
import { trimShapesActions, type TrimShapesActions } from './trim-shapes-actions';
import { warpDeformActions, type WarpDeformActions } from './warp-deform-actions';

export type DesignToolsActions = ShapeQueryActions &
  PathCleanupActions &
  RubberBandOutlineActions &
  ImageMaskFlattenActions &
  CopyAlongPathActions &
  TrimShapesActions &
  ExtendShapesActions &
  CutShapesActions &
  WarpDeformActions &
  OptimizeShapesActions &
  DrawOrderActions &
  VariableBakeActions &
  PathSegmentActions &
  PathFilletActions &
  ShearActions &
  GuideActions &
  PenContinueActions &
  PathNodeDragJoinActions &
  MirrorLineActions;

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;
type CopySetter = (
  fn: (state: AppState) => AppState | Partial<AppState>,
  onCommitted?: () => void,
) => unknown;

export function designToolsActions(
  set: Setter,
  copySet: CopySetter = (update, onCommitted) => {
    set(update);
    onCommitted?.();
  },
): DesignToolsActions {
  return {
    ...shapeQueryActions(set),
    ...pathCleanupActions(set),
    ...rubberBandOutlineActions(copySet),
    ...imageMaskFlattenActions(set),
    ...copyAlongPathActions(copySet),
    ...trimShapesActions(set),
    ...extendShapesActions(set),
    ...cutShapesActions(copySet),
    ...warpDeformActions(set),
    ...optimizeShapesActions(set),
    ...drawOrderActions(set),
    ...variableBakeActions(set),
    ...pathSegmentActions(set),
    ...pathFilletActions(set),
    ...shearActions(set),
    ...guideActions(set),
    ...penContinueActions(set),
    ...pathNodeDragJoinActions(set),
    ...mirrorLineActions(set),
  };
}
