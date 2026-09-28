// Operations-list bulk tools (LBG-C07). Each action writes only `output` or
// `visible` (never the parked mode's `parkedOutput`, ADR-416), or, for Sort
// cuts last, only the saved operation and artwork orders. Every change is one
// undo step; an action that changes nothing leaves history alone.
import { sortCutsLast, type SortCutsLastResult } from '../../core/sort-cuts-last';
import { isRegistrationLayer, machineKindOf, type Layer, type Project } from '../../core/scene';
import { pushUndo, type StateSlice } from './scene-mutations';
import { visibleSelectionState } from './store-actions';
import { useToastStore, type ToastVariant } from './toast-store';

export type LayerFlagValue = boolean | 'invert';

type OperationListState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

type OperationListMutation = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
  readonly selectedObjectId?: string | null;
  readonly additionalSelectedIds?: ReadonlySet<string>;
};

type OperationListSet = (
  fn: (state: OperationListState) => OperationListMutation | Record<string, never>,
) => void;

export type OperationListActions = {
  /** Turn every operation's Output on, off, or invert each one. */
  readonly setAllLayersOutput: (value: LayerFlagValue) => void;
  /** Show, hide, or invert every operation on the workspace. */
  readonly setAllLayersVisible: (value: LayerFlagValue) => void;
  /** LightBurn's Hide Others: show this operation and hide the rest. */
  readonly showOnlyLayer: (layerId: string) => void;
  /** Laser only: engraving first, cuts last and weakest first. */
  readonly sortCutsLast: () => void;
};

export function operationListActions(set: OperationListSet): OperationListActions {
  return {
    // Turning output on or inverting it leaves the registration jig alone: it is
    // burned in its own run before the artwork (ADR-057), never with it.
    setAllLayersOutput: (value) =>
      set((state) =>
        layerFlagMutation(state, 'output', (layer) =>
          isRegistrationLayer(layer) && value !== false
            ? layer.output
            : flagValue(layer.output, value),
        ),
      ),
    setAllLayersVisible: (value) =>
      set((state) =>
        layerFlagMutation(state, 'visible', (layer) => flagValue(layer.visible, value)),
      ),
    showOnlyLayer: (layerId) =>
      set((state) =>
        state.project.scene.layers.some((layer) => layer.id === layerId)
          ? layerFlagMutation(state, 'visible', (layer) => layer.id === layerId)
          : {},
      ),
    sortCutsLast: () => {
      const toast: { message?: string; variant?: ToastVariant } = {};
      set((state) => {
        if (machineKindOf(state.project.machine) === 'cnc') {
          toast.message = 'CNC already runs profiles last.';
          return {};
        }
        const result = sortCutsLast(state.project.scene);
        const hasEngraving = state.project.scene.layers.some((layer) => layer.mode !== 'line');
        toast.message = sortCutsLastMessage(result, hasEngraving);
        toast.variant = result.scene === state.project.scene ? 'info' : 'success';
        if (result.scene === state.project.scene) return {};
        return historyMutation(state, { ...state.project, scene: result.scene });
      });
      if (toast.message !== undefined) {
        useToastStore.getState().pushToast(toast.message, toast.variant ?? 'info');
      }
    },
  };
}

export function sortCutsLastMessage(result: SortCutsLastResult, hasEngraving: boolean): string {
  const moves: string[] = [];
  if (result.movedCutOperations > 0) {
    const count = counted(result.movedCutOperations, 'cut operation');
    moves.push(`${count} ${hasEngraving ? 'moved after engraving' : 'reordered weakest first'}`);
  }
  if (result.artworkMovedLater > 0) {
    moves.push(`${counted(result.artworkMovedLater, 'artwork')} moved later in Run order`);
  }
  const summary =
    moves.length === 0 ? 'Cuts already run last.' : `Cuts now run last: ${moves.join(' and ')}.`;
  const mixed = result.engraveAndCutArtwork;
  if (mixed === 0) return summary;
  return mixed === 1
    ? `${summary} 1 artwork both engraves and cuts, so its cut runs right after its own engraving.`
    : `${summary} ${mixed} artworks both engrave and cut, so their cuts run right after their own engraving.`;
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function flagValue(current: boolean, value: LayerFlagValue): boolean {
  return value === 'invert' ? !current : value;
}

function layerFlagMutation(
  state: OperationListState,
  flag: 'output' | 'visible',
  nextValue: (layer: Layer) => boolean,
): OperationListMutation | Record<string, never> {
  const current = state.project.scene.layers;
  const layers = current.map((layer) => {
    const next = nextValue(layer);
    if (layer[flag] === next) return layer;
    return flag === 'output' ? { ...layer, output: next } : { ...layer, visible: next };
  });
  const changed = layers.filter((layer, index) => layer !== current[index]);
  if (changed.length === 0) return {};
  const project = { ...state.project, scene: { ...state.project.scene, layers } };
  const hidesOperation = flag === 'visible' && changed.some((layer) => !layer.visible);
  return {
    ...historyMutation(state, project),
    // Same pruning as hiding one operation: hidden artwork leaves the selection.
    ...(hidesOperation ? visibleSelectionState(state, project) : {}),
  };
}

function historyMutation(state: OperationListState, project: Project): OperationListMutation {
  return {
    project,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}
