// Shared test helpers for the useStore test suite. Co-located here rather
// than under src/__fixtures__/ because they reference the AppState shape
// directly — if AppState grows a field, both files would otherwise have
// to update in lockstep. One place is one place.

import { createProject, IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { DEFAULT_LAYER_DEFAULTS_STATE } from './layer-default-actions';
import { EMPTY_MATERIAL_LIBRARY_COLLECTION } from './material-library-collection';
import { DEFAULT_OUTPUT_SCOPE_SETTINGS, useStore } from './store';

export function resetStore(): void {
  useStore.setState({
    project: createProject(),
    selectedObjectId: null,
    selectedPathNode: null,
    selectedPathNodes: [],
    additionalSelectedIds: new Set(),
    previewMode: false,
    undoStack: [],
    redoStack: [],
    pendingUndo: null,
    cursorMm: null,
    jobPlacement: DEFAULT_JOB_PLACEMENT,
    outputScopeSettings: DEFAULT_OUTPUT_SCOPE_SETTINGS,
    dirty: false,
    savedName: null,
    lastSaveTarget: null,
    copiedLayerSettings: null,
    sceneClipboard: null,
    layerDefaults: DEFAULT_LAYER_DEFAULTS_STATE,
    materialLibrary: null,
    materialLibraryDirty: false,
    savedLibraries: EMPTY_MATERIAL_LIBRARY_COLLECTION,
  });
}

export function svgObj(id: string, colors: ReadonlyArray<string>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: colors.map((color) => ({
      color,
      polylines: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
          ],
          closed: false,
        },
      ],
    })),
  };
}
