// "Leave white unburned" for a project saved before the knock-out (rolling
// audit v10 V2-P2-1, ADR-686 Amendment 2). Every SVG import in the project gets
// the knock-out a fresh import gets, in one Undo step. A white whose operations
// all have Output off is left alone, as the open notice leaves it out.
//
// The history copy marks the white shapes it would have cut as `kept`, so Undo
// is the operator's choice to burn the white: the notice and Job Review stop
// asking. An import whose white covers every darker shape is left as parsed,
// as a fresh import leaves it, and its white is marked `kept` too, so the
// offer always ends once taken.

import { isWhiteOutputOff, svgImportGroups } from '../../core/geometry/burning-imported-white';
import { knockOutWhiteFills } from '../../core/geometry/white-fill-knockout';
import type { ColoredPath, Project, Scene, SceneObject } from '../../core/scene';
import { withoutRemovedParts, withWhiteKept } from './import-white-knockout';
import { pushUndo, type StateSlice } from './scene-mutations';
import { useToastStore } from './toast-store';

export type SavedWhiteKnockout = {
  readonly project: Project;
  /** What Undo returns to: the project as it was, its white marked `kept`. */
  readonly undoProject: Project;
  /** White shapes now left unburned. */
  readonly whiteShapes: number;
  readonly removedIds: ReadonlySet<string>;
};

export function knockOutSavedWhiteFills(project: Project): SavedWhiteKnockout | null {
  const original = project.scene;
  const burns = (object: SceneObject, path: ColoredPath): boolean =>
    !isWhiteOutputOff(original, object, path);
  let scene: Scene = original;
  let whiteShapes = 0;
  const touched = new Set<string>();
  const removedIds = new Set<string>();
  const leftAsParsed = new Set<string>();
  for (const group of svgImportGroups(original)) {
    const knockout = knockOutWhiteFills(group, {
      skip: (object, path) => isWhiteOutputOff(original, object, path),
    });
    if (knockout === null) continue;
    const ids = group.map((object) => object.id);
    ids.forEach((id) => touched.add(id));
    if (knockout.removedIds.size === group.length) {
      ids.forEach((id) => leftAsParsed.add(id));
      continue;
    }
    scene = withoutRemovedParts(scene, knockout.changed, knockout.removedIds);
    knockout.removedIds.forEach((id) => removedIds.add(id));
    whiteShapes += knockout.whiteShapes;
  }
  if (touched.size === 0) return null;
  const knocked = withWhiteKept({ ...project, scene }, leftAsParsed, burns);
  return {
    project: knocked,
    undoProject: withWhiteKept(project, touched, burns),
    whiteShapes,
    removedIds,
  };
}

export type SavedWhiteKnockoutActions = {
  /** One Undo step; returns how many white shapes are now left unburned. */
  readonly leaveSavedWhiteUnburned: () => number;
};

type SavedWhiteKnockoutState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

type SavedWhiteKnockoutSet = (
  fn: (state: SavedWhiteKnockoutState) => Partial<SavedWhiteKnockoutState> & {
    readonly redoStack?: ReadonlyArray<Project>;
    readonly dirty?: true;
  },
) => void;

export function savedWhiteKnockoutActions(set: SavedWhiteKnockoutSet): SavedWhiteKnockoutActions {
  return {
    leaveSavedWhiteUnburned: () => {
      let whiteShapes = 0;
      set((state) => {
        const result = knockOutSavedWhiteFills(state.project);
        if (result === null) return {};
        whiteShapes = result.whiteShapes;
        const kept = (id: string) => !result.removedIds.has(id);
        return {
          project: result.project,
          undoStack: pushUndo(result.undoProject, state.undoStack, LEAVE_WHITE_UNBURNED),
          redoStack: [],
          dirty: true,
          selectedObjectId:
            state.selectedObjectId !== null && kept(state.selectedObjectId)
              ? state.selectedObjectId
              : null,
          additionalSelectedIds: new Set([...state.additionalSelectedIds].filter(kept)),
        };
      });
      if (whiteShapes > 0) {
        useToastStore.getState().pushToast(leftUnburnedMessage(whiteShapes), 'success');
      }
      return whiteShapes;
    },
  };
}

export const LEAVE_WHITE_UNBURNED = 'Leave white unburned';

export function leftUnburnedMessage(whiteShapes: number): string {
  const one = whiteShapes === 1;
  return (
    `${one ? '1 white shape is' : `${whiteShapes} white shapes are`} left unburned, as a new ` +
    `import of the file leaves ${one ? 'it' : 'them'}. Undo burns ${one ? 'it' : 'them'} again.`
  );
}
