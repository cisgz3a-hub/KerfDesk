import { proOperationMutationSetter } from '../licensing/pro-operation-mutation';
import { newlyIntroducedProOperationFeature } from '../licensing/pro-operation-policy';
import {
  vectorPathActions as createVectorPathActions,
  type VectorPathActions,
  type VectorPathState,
} from './vector-path-actions';

export type { VectorPathActions } from './vector-path-actions';

/** Keep copy admission distinct from geometry edits that preserve existing operations. */
export function vectorPathActions(
  set: (update: (state: VectorPathState) => VectorPathState | Partial<VectorPathState>) => void,
  get: () => VectorPathState,
): VectorPathActions {
  return createVectorPathActions(
    set,
    proOperationMutationSetter(set, get),
    proOperationMutationSetter(set, get, newlyIntroducedProOperationFeature),
  );
}
