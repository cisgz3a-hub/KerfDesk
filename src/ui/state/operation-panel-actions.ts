// Operations panel commands, each one undo step: moving artwork onto an
// existing operation (the inspector's Move to operation), and LightBurn's Cuts /
// Layers header menu: Enable, Disable or Invert every Output switch; Show, Hide
// or Invert every Show switch; Sort Cuts Last.
// https://docs.lightburnsoftware.com/2.1/Reference/CutsLayersWindow/

import { cutsLastOrder } from '../../core/cuts-last-order';
import { machineKindOf, type Layer, type Project } from '../../core/scene';
import { assignmentUpdate, type UndoableUpdate } from './operation-assignment';
import { pushUndo, type StateSlice } from './scene-mutations';
import { selectionWithoutHidden } from './visible-selection';

type OperationPanelState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

type OperationPanelSet = (
  fn: (state: OperationPanelState) => UndoableUpdate | Record<string, never>,
) => void;

type SwitchPatch = Partial<Pick<Layer, 'output' | 'visible'>>;

export type SortCutsLastResult = {
  /** Operations recognised as cuts; 0 when no cut surrounds other work. */
  readonly cutOperationCount: number;
  /** False when every cut already ran last, so nothing changed. */
  readonly moved: boolean;
};

export type OperationPanelActions = {
  readonly assignObjectsToLayer: (objectIds: ReadonlyArray<string>, layerId: string) => void;
  readonly setEveryOperationOutput: (output: boolean) => void;
  readonly invertEveryOperationOutput: () => void;
  readonly setEveryOperationVisible: (visible: boolean) => void;
  readonly invertEveryOperationVisible: () => void;
  readonly sortCutsLast: () => SortCutsLastResult;
};

export function operationPanelActions(set: OperationPanelSet): OperationPanelActions {
  return {
    assignObjectsToLayer: (objectIds, layerId) =>
      set((state) => assignmentUpdate(state, new Set(objectIds), layerId)),
    setEveryOperationOutput: (output) => set((state) => switchEvery(state, () => ({ output }))),
    invertEveryOperationOutput: () =>
      set((state) => switchEvery(state, (layer) => ({ output: !layer.output }))),
    setEveryOperationVisible: (visible) => set((state) => switchEvery(state, () => ({ visible }))),
    invertEveryOperationVisible: () =>
      set((state) => switchEvery(state, (layer) => ({ visible: !layer.visible }))),
    sortCutsLast: () => {
      let result: SortCutsLastResult = { cutOperationCount: 0, moved: false };
      set((state) => {
        if (machineKindOf(state.project.machine) !== 'laser') return {};
        const scene = state.project.scene;
        const order = cutsLastOrder(scene, state.project.optimization.layerPriority);
        result = { cutOperationCount: order.cutOperationCount, moved: order.sorted !== null };
        if (order.sorted === null) return {};
        const { layers, artworkOrder } = order.sorted;
        return mutation(state, { ...state.project, scene: { ...scene, layers, artworkOrder } });
      });
      return result;
    },
  };
}

function switchEvery(
  state: OperationPanelState,
  patchFor: (layer: Layer) => SwitchPatch,
): UndoableUpdate | Record<string, never> {
  let changed = false;
  const layers = state.project.scene.layers.map((layer) => {
    const patch = patchFor(layer);
    if (
      (patch.output === undefined || patch.output === layer.output) &&
      (patch.visible === undefined || patch.visible === layer.visible)
    ) {
      return layer;
    }
    changed = true;
    return { ...layer, ...patch };
  });
  if (!changed) return {};
  const scene = { ...state.project.scene, layers };
  // Hidden artwork leaves the selection, as it does when one operation is hidden.
  return {
    ...mutation(state, { ...state.project, scene }),
    ...selectionWithoutHidden(state, scene),
  };
}

function mutation(state: OperationPanelState, project: Project): UndoableUpdate {
  return {
    project,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}
