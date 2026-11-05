import type { VectorBooleanOp, VectorOpError, VectorSceneObject } from '../../core/geometry';
import type { CutShapesError } from '../../core/geometry/cut-shapes';
import type { OffsetShapesOptions } from '../../core/geometry/offset-shapes';
import type { WeldChange } from '../../core/geometry/vector-path-weld-change';
import type { SceneObjectsMessage } from '../packed-scene-objects-transfer';
import type { ResultObjectMessage } from './vector-op-result-transfer';

/**
 * One costly vector operation, with the exact result ids the committing action
 * will use, so a settled result can be committed as it is (ADR-609).
 */
export type VectorOpTask =
  | {
      readonly kind: 'offset-shapes';
      readonly options: OffsetShapesOptions;
      readonly ids: { readonly outward: string; readonly inward: string };
    }
  | { readonly kind: 'combine'; readonly op: VectorBooleanOp; readonly id: string }
  | { readonly kind: 'weld'; readonly id: string }
  /**
   * The Combine Shapes dialog's Weld (ADR-609 Amendment 2). The sources are the
   * `operandCount` operands, rebound to their weld operations, followed by the
   * selected objects they came from. The worker welds the operands, then runs
   * `describeWeldChange` against the selection, as the dialog did in thread.
   */
  | { readonly kind: 'weld-review'; readonly id: string; readonly operandCount: number }
  /** The Offset outlines row's outward (positive) or inward (negative) copy. */
  | { readonly kind: 'offset-paths'; readonly deltaMm: number; readonly id: string }
  /** Cut Shapes; `usedIds` are the scene's object ids, which new piece ids avoid. */
  | { readonly kind: 'cut-shapes'; readonly usedIds: ReadonlyArray<string> };

export type VectorOpRequest = {
  readonly id: number;
  /** Present only when this worker does not hold the task's source objects yet. */
  readonly sources?: SceneObjectsMessage<VectorSceneObject>;
  readonly task: VectorOpTask;
};

/** Posted once the worker's script has loaded, before any reply. */
export type VectorOpReady = { readonly kind: 'ready' };

export type VectorOpResponse =
  /**
   * Offset Shapes returns [outward, inward], either of which may be null. Cut
   * Shapes returns each cut's outside then inside piece, in `cut` order.
   */
  | {
      readonly id: number;
      readonly kind: 'objects';
      readonly objects: ReadonlyArray<ResultObjectMessage | null>;
      readonly cut?: { readonly cutterId: string; readonly sourceIds: ReadonlyArray<string> };
      /** A Weld review's change against the selection. */
      readonly weldChange?: WeldChange;
    }
  | {
      readonly id: number;
      readonly kind: 'error';
      readonly error: VectorOpError | CutShapesError;
    }
  | { readonly id: number; readonly kind: 'fatal'; readonly message: string };

export type VectorOpMessage = VectorOpReady | VectorOpResponse;
