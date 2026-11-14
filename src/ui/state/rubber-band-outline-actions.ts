// Create Rubber-Band Outline (LightBurn gap batch 5, LBG-T07, ADR-480): add
// one closed shape stretched around the selection and select it. The outline
// cuts with the operation chosen in its dialog: a copy of a selected operation
// that cuts along a line, with that artwork's own settings, or a new operation
// named Outline (ADR-480 Amendment 7, rubber-band-outline-operation.ts). One
// undo step.

import { rubberBandOutline } from '../../core/geometry/rubber-band-outline';
import { addObject } from '../../core/scene';
import { formatDisplayMillimetres } from '../format-display-millimetres';
import { bindOutlineToChoice, rubberBandOutlineOptions } from './rubber-band-outline-operation';
import { selectedObjectIds } from './scene-group-actions';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { useToastStore, type ToastVariant } from './toast-store';
import { uniqueObjectId } from './vector-path-actions';

export type RubberBandOutlineActions = {
  /**
   * Add a convex outline around the selection; returns true when it was added.
   * `operationId` is a choice from rubberBandOutlineOptions; absent means its default.
   */
  readonly addRubberBandOutline: (operationId?: string) => boolean;
};

// The edition-aware setter returns false while a new Pro copy waits for admission.
type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => unknown;

type Notice = { readonly message: string; readonly variant: ToastVariant };

export function rubberBandOutlineActions(set: Setter): RubberBandOutlineActions {
  return {
    addRubberBandOutline: (operationId) => {
      let added = false;
      let notices: ReadonlyArray<Notice> = [];
      const committed = set((state) => {
        const next = rubberBandOutlineMutation(state, operationId, (reported) => {
          notices = reported;
        });
        added = next !== state;
        return next;
      });
      if (committed === false) return false;
      if (added) {
        for (const notice of notices) {
          useToastStore.getState().pushToast(notice.message, notice.variant);
        }
      }
      return added;
    },
  };
}

function rubberBandOutlineMutation(
  state: AppState,
  operationId: string | undefined,
  reportAdded: (notices: ReadonlyArray<Notice>) => void,
): AppState | Partial<AppState> {
  const options = rubberBandOutlineOptions(state.project, selectedObjectIds(state));
  const selected = options.sources;
  const toast = useToastStore.getState();
  if (options.leftOut !== '')
    toast.pushToast(options.leftOut, selected.length === 0 ? 'warning' : 'info');
  if (selected.length === 0) return state;
  const choice = options.choices.find((entry) => entry.id === (operationId ?? options.defaultId));
  if (choice === undefined) {
    toast.pushToast(
      'That operation cannot cut this outline any more. Open Rubber-Band Outline again and choose another.',
      'warning',
    );
    return state;
  }
  const scene0 = state.project.scene;
  const outline = rubberBandOutline(selected, uniqueObjectId(scene0, 'outline'));
  if (outline === null) {
    toast.pushToast(
      'The selection has no area to outline: it lies on one straight line or is too small.',
      'warning',
    );
    return state;
  }
  const bound = bindOutlineToChoice(scene0, state.project.machine, outline, choice);
  const scene = addObject(bound.scene, bound.object);
  const { minX, minY, maxX, maxY } = outline.bounds;
  const cutWith =
    choice.source === null
      ? `a new operation “${choice.name}”`
      : `a copy of “${choice.name}”, with the artwork's own settings`;
  const notices: Notice[] = [
    {
      message: `Added a rubber-band outline around ${selected.length === 1 ? '1 object' : `${selected.length} objects`} (${formatDisplayMillimetres(maxX - minX)} × ${formatDisplayMillimetres(maxY - minY)} mm), cut with ${cutWith}.`,
      variant: 'success',
    },
  ];
  if (!choice.output) {
    notices.push({
      message: `“${choice.name}” has its output turned off, so the outline will not burn or cut. Turn its output on in Cuts / Layers, or undo and choose another operation.`,
      variant: 'warning',
    });
  }
  reportAdded(notices);
  return {
    project: { ...state.project, scene },
    selectedObjectId: bound.object.id,
    additionalSelectedIds: new Set(),
    selectedPathNode: null,
    selectedPathNodes: [],
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}
