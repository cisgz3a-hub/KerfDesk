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

type ArtworkOrderSet = (
  fn: (state: ArtworkOrderActionState) => ArtworkOrderMutation | Record<string, never>,
) => void;

export type ArtworkMoveDirection = 'first' | 'earlier' | 'later' | 'last';

export type ArtworkOrderActions = {
  readonly moveSelectedArtwork: (direction: ArtworkMoveDirection) => void;
};

export function artworkOrderActions(set: ArtworkOrderSet): ArtworkOrderActions {
  return {
    moveSelectedArtwork: (direction) =>
      set((state) => {
        const selectedIds = selectedIdSet(state);
        if (selectedIds.size === 0) return {};
        const current = canonicalArtworkOrder(state.project.scene);
        const next = moveArtworkIds(current, selectedIds, direction);
        if (sameStringArray(current, next)) return {};
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
  };
}

function moveArtworkIds(
  current: ReadonlyArray<string>,
  selected: ReadonlySet<string>,
  direction: ArtworkMoveDirection,
): ReadonlyArray<string> {
  if (direction === 'first') return moveArtworkToEdge(current, selected, true);
  if (direction === 'last') return moveArtworkToEdge(current, selected, false);
  return moveArtworkOneStep(current, selected, direction);
}

function moveArtworkToEdge(
  current: ReadonlyArray<string>,
  selected: ReadonlySet<string>,
  first: boolean,
): ReadonlyArray<string> {
  const moving = current.filter((id) => selected.has(id));
  const remaining = current.filter((id) => !selected.has(id));
  return first ? [...moving, ...remaining] : [...remaining, ...moving];
}

function moveArtworkOneStep(
  current: ReadonlyArray<string>,
  selected: ReadonlySet<string>,
  direction: 'earlier' | 'later',
): ReadonlyArray<string> {
  const next = [...current];
  if (direction === 'earlier') {
    for (let index = 1; index < next.length; index += 1) {
      const id = next[index];
      const previous = next[index - 1];
      if (
        id !== undefined &&
        previous !== undefined &&
        selected.has(id) &&
        !selected.has(previous)
      ) {
        next[index - 1] = id;
        next[index] = previous;
      }
    }
    return next;
  }
  for (let index = next.length - 2; index >= 0; index -= 1) {
    const id = next[index];
    const following = next[index + 1];
    if (
      id !== undefined &&
      following !== undefined &&
      selected.has(id) &&
      !selected.has(following)
    ) {
      next[index] = following;
      next[index + 1] = id;
    }
  }
  return next;
}

function selectedIdSet(state: ArtworkOrderActionState): ReadonlySet<string> {
  return new Set([
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ]);
}

function sameStringArray(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
