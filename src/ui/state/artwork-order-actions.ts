import { moveArtworkRunUnitsToPosition } from '../../core/artwork-run-units';
import { canonicalArtworkOrder } from '../../core/artwork-order';
import type { Project } from '../../core/scene';
import { pushUndo, type StateSlice } from './scene-mutations';

type ArtworkOrderActionState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

type ArtworkOrderMutation = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};

type ArtworkOrderInteractionMutation = {
  readonly project: Project;
  readonly dirty: true;
};

type ArtworkOrderSet = (
  fn: (
    state: ArtworkOrderActionState,
  ) => ArtworkOrderMutation | ArtworkOrderInteractionMutation | Record<string, never>,
) => void;

export type ArtworkOrderActions = {
  readonly moveArtworkToPosition: (objectIds: ReadonlyArray<string>, position: number) => void;
  readonly setArtworkOrderDuringInteraction: (order: ReadonlyArray<string>) => void;
};

export function artworkOrderActions(set: ArtworkOrderSet): ArtworkOrderActions {
  return {
    moveArtworkToPosition: (objectIds, position) =>
      set((state) => {
        if (!Number.isFinite(position) || objectIds.length === 0) return {};
        const next = moveArtworkRunUnitsToPosition(
          state.project.scene,
          new Set(objectIds),
          position,
        );
        if (sameStringArray(canonicalArtworkOrder(state.project.scene), next)) return {};
        return {
          project: {
            ...state.project,
            scene: { ...state.project.scene, artworkOrder: next },
          },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
    setArtworkOrderDuringInteraction: (order) =>
      set((state) =>
        sameStringArray(canonicalArtworkOrder(state.project.scene), order)
          ? {}
          : {
              project: {
                ...state.project,
                scene: { ...state.project.scene, artworkOrder: [...order] },
              },
              dirty: true,
            },
      ),
  };
}

function sameStringArray(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
