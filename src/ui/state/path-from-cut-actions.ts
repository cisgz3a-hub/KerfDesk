// Tools > Generate Path From Cut: compile the selected artwork (or all of it)
// exactly as output would, and add what the laser burns as one new vector
// object in one undo step, for inspecting kerf, tabs, perforation and fill
// lines, or for reusing them as artwork. The source artwork is not changed.

import { toSceneCoords } from '../../core/devices';
import { prepareOutputSnapshot } from '../../io/gcode/prepare-output-snapshot';
import { renderVariableText } from '../text/render-variable-text';
import { exportProjectSelection } from '../app/export-artwork-svg';
import type { CutPathsArtwork } from '../../core/job/cut-paths-artwork';
import { cutPathsArtwork } from '../../core/job/cut-paths-artwork';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { boundsForPaths } from '../../core/geometry/vector-path-tools';
import { selectedObjectIds } from './scene-group-actions';
import { pushUndo } from './undo-stack';
import type { AppState } from './store';
import { useToastStore } from './toast-store';

export type PathFromCutActions = {
  readonly generatePathFromCut: () => Promise<void>;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function pathFromCutActions(set: Setter): PathFromCutActions {
  return {
    generatePathFromCut: async () => {
      let captured: AppState | undefined;
      set((state) => {
        captured = state;
        return state;
      });
      if (captured === undefined) return;
      const source = captured;
      const ids = selectedObjectIds(source);
      const project = exportProjectSelection(source.project, ids.length === 0 ? undefined : ids);
      try {
        const prepared = await prepareOutputSnapshot(project, {
          clock: () => new Date(),
          renderVariableText,
          outputScope: {
            cutSelectedGraphics: ids.length > 0,
            useSelectionOrigin: false,
            selectedObjectIds: ids,
          },
        });
        if (!prepared.ok) {
          useToastStore
            .getState()
            .pushToast(
              prepared.preflight.issues.map((issue) => issue.message).join(' '),
              'warning',
            );
          return;
        }
        const artwork = cutPathsArtwork(
          prepared.job,
          (point) => toSceneCoords(point, project.device),
          {
            scanningOffsets: project.device.scanningOffsets,
          },
        );
        set((state) => {
          if (
            state.project !== source.project ||
            state.projectDocumentEpoch !== source.projectDocumentEpoch
          ) {
            useToastStore
              .getState()
              .pushToast(
                'The project changed while preparing the paths. Generate them again.',
                'warning',
              );
            return state;
          }
          return pathFromCutMutation(state, artwork);
        });
      } catch (error) {
        useToastStore
          .getState()
          .pushToast(
            `Could not generate paths: ${error instanceof Error ? error.message : String(error)}`,
            'error',
          );
      }
    },
  };
}

export function pathFromCutMutation(
  state: AppState,
  artwork: CutPathsArtwork,
): AppState | Partial<AppState> {
  const scene = state.project.scene;
  const toast = useToastStore.getState().pushToast;
  if (artwork.paths.length === 0) {
    toast(
      artwork.skippedRasterGroups > 0
        ? 'Image engraving is made of pixels, not paths; there are no line or fill moves to convert.'
        : 'Nothing here is cut or filled. Assign the artwork to a Line or Fill operation that outputs.',
      'warning',
    );
    return state;
  }
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: crypto.randomUUID(),
    source: 'Generated path from cut',
    bounds: boundsForPaths(artwork.paths) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    transform: IDENTITY_TRANSFORM,
    paths: artwork.paths,
    // Bound to no operation: the copy of the burn must never burn again by colour.
    operationIds: [],
  };
  const count = artwork.paths.reduce((sum, path) => sum + path.polylines.length, 0);
  toast(
    `Added ${count} burned path(s) as new artwork${artwork.skippedRasterGroups > 0 ? '; image engraving was left out' : ''}. Assign it to an operation before it outputs.`,
    'success',
  );
  return {
    project: { ...state.project, scene: { ...scene, objects: [...scene.objects, object] } },
    selectedObjectId: object.id,
    additionalSelectedIds: new Set(),
    undoStack: pushUndo(state.project, state.undoStack, 'Generate path from cut'),
    redoStack: [],
    dirty: true,
  };
}
