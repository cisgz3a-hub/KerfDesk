// The full node editor's store actions (ADR-376), gathered into one slice the
// curve-command slice spreads in, so the app store picks them up unchanged.

import type { AppState } from './store';
import { pathNodeAlignActions, type PathNodeAlignActions } from './path-node-align-actions';
import {
  pathNodeInteractionActions,
  type PathNodeInteractionActions,
} from './path-node-interaction-actions';
import { pathSegmentEditActions, type PathSegmentEditActions } from './path-segment-edit-actions';
import { pathSegmentTrimActions, type PathSegmentTrimActions } from './path-segment-trim-actions';

export type PathNodeEditorActions = PathSegmentEditActions &
  PathSegmentTrimActions &
  PathNodeAlignActions &
  PathNodeInteractionActions;

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function pathNodeEditorActions(set: Setter): PathNodeEditorActions {
  return {
    ...pathSegmentEditActions(set),
    ...pathSegmentTrimActions(set),
    ...pathNodeAlignActions(set),
    ...pathNodeInteractionActions(set),
  };
}
