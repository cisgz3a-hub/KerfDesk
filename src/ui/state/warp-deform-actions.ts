// Apply a Warp or Deform (LightBurn gap LBG-T06) as one undo step, and say
// what happened: how many objects bent, which text and drawn shapes became
// paths, that curves became fine lines, and what was left alone.

import { warpDeformHandlesUnmoved, type WarpDeformGrid } from '../../core/geometry/warp-deform-map';
import { WARP_DEFORM_TOLERANCE_MM } from '../../core/geometry/warp-deform-paths';
import { isVectorPathObject } from '../../core/geometry/vector-path-tools';
import type { Scene } from '../../core/scene/scene';
import { selectedObjectIds } from './scene-group-actions';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { useToastStore } from './toast-store';
import { planWarpDeform, type WarpDeformPlan } from './warp-deform-plan';
import type { WarpDeformRequest } from './warp-deform-session';

export type WarpDeformActions = {
  /** Bend the session's artwork by its handles, as one undo step. */
  readonly applyWarpDeform: (request: WarpDeformRequest) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

type LeftAlone = { readonly imagesAndReliefs: number; readonly locked: number };

export function warpDeformActions(set: Setter): WarpDeformActions {
  return {
    applyWarpDeform: (request) => set((state) => applyWarpDeformMutation(state, request)),
  };
}

function applyWarpDeformMutation(
  state: AppState,
  request: WarpDeformRequest,
): AppState | Partial<AppState> {
  if (warpDeformHandlesUnmoved(request.grid, request.box, request.handles)) {
    toast('The handles have not moved, so nothing changed.');
    return state;
  }
  const scene = state.project.scene;
  const plan = planWarpDeform(scene, request);
  toast(warpDeformNotice(request.grid, plan, leftAlone(scene, selectedObjectIds(state))));
  if (plan.warped === 0) return state;
  return {
    project: { ...state.project, scene: { ...scene, objects: plan.objects } },
    undoStack: pushUndo(
      state.project,
      state.undoStack,
      request.grid === 'warp' ? 'Warp' : 'Deform',
    ),
    redoStack: [],
    dirty: true,
    selectedPathNode: null,
    selectedPathNodes: [],
  };
}

// Images and reliefs cannot bend; locked artwork is never edited.
function leftAlone(scene: Scene, selectedIds: ReadonlyArray<string>): LeftAlone {
  const ids = new Set(selectedIds);
  let imagesAndReliefs = 0;
  let locked = 0;
  for (const object of scene.objects) {
    if (!ids.has(object.id)) continue;
    if (object.kind === 'raster-image' || object.kind === 'relief') imagesAndReliefs += 1;
    else if (object.locked === true && isVectorPathObject(object)) locked += 1;
  }
  return { imagesAndReliefs, locked };
}

export function warpDeformNotice(
  grid: WarpDeformGrid,
  plan: Pick<WarpDeformPlan, 'warped' | 'convertedText' | 'convertedShapes' | 'curvesFlattened'>,
  skipped: LeftAlone,
): string {
  const leftNote = leftAloneNote(skipped);
  if (plan.warped === 0) {
    return `Nothing to ${grid === 'warp' ? 'warp' : 'deform'}: the artwork is no longer there or is locked.${leftNote}`;
  }
  const verb = grid === 'warp' ? 'Warped' : 'Deformed';
  const curves = plan.curvesFlattened
    ? ` Curves became fine lines within ${WARP_DEFORM_TOLERANCE_MM} mm.`
    : '';
  return `${verb} ${count(plan.warped, 'object', 'objects')}.${convertedNote(plan)}${curves}${leftNote}`;
}

function convertedNote(plan: Pick<WarpDeformPlan, 'convertedText' | 'convertedShapes'>): string {
  const parts = [
    ...(plan.convertedText === 0 ? [] : [count(plan.convertedText, 'text object', 'text objects')]),
    ...(plan.convertedShapes === 0
      ? []
      : [count(plan.convertedShapes, 'drawn shape', 'drawn shapes')]),
  ];
  if (parts.length === 0) return '';
  const single = plan.convertedText + plan.convertedShapes === 1;
  return ` ${parts.join(' and ')} ${single ? 'was' : 'were'} converted to paths first.`;
}

function leftAloneNote(skipped: LeftAlone): string {
  const images =
    skipped.imagesAndReliefs === 0
      ? ''
      : ` Images and reliefs cannot bend, so ${skipped.imagesAndReliefs === 1 ? '1 was left as it is' : `${skipped.imagesAndReliefs} were left as they are`}.`;
  const locked =
    skipped.locked === 0
      ? ''
      : ` ${skipped.locked === 1 ? '1 locked object was left as it is' : `${skipped.locked} locked objects were left as they are`}.`;
  return `${images}${locked}`;
}

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

function toast(message: string): void {
  useToastStore.getState().pushToast(message, 'info');
}
