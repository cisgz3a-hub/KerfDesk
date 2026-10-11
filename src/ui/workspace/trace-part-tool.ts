import type { MouseEvent, RefObject } from 'react';
import {
  sceneObjectHasVisibleLayer,
  type Project,
  type Scene,
  type SceneObject,
  type SelectionAnchor,
  type Vec2,
} from '../../core/scene';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { currentHierarchyFocus } from '../state/design-hierarchy-store';
import { isSingleTracePart } from '../state/trace-part-geometry';
import { pickHandleOrRotateDrag, type DragState } from './drag-state';
import { hitTracePart } from './trace-part-hit-test';
import { canvasMouseToScene, pxToMmForCanvas, type ViewState } from './view-transform';

export function activateTracePartTool(): void {
  if (useStore.getState().previewMode) return;
  if (useUiStore.getState().toolMode.kind === 'trace-parts') {
    useUiStore.getState().resetToolMode();
    return;
  }
  // Remove the whole trace's transform handles before the first part pick.
  useStore.getState().selectObject(null);
  useUiStore.getState().setToolMode({ kind: 'trace-parts' });
}

type TracePartDragArgs = {
  readonly e: MouseEvent<HTMLCanvasElement>;
  readonly ref: RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly viewState: ViewState;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly selectionAnchor: SelectionAnchor;
};

export function beginTracePartDrag(args: TracePartDragArgs): DragState | null {
  const point = canvasMouseToScene(args.e, args.ref.current, args.project, args.viewState);
  if (point === null) return null;
  const pxToMm = pxToMmForCanvas(args.ref.current, args.project, args.viewState);
  const state = useStore.getState();
  const selectedObjects = args.project.scene.objects.filter(
    (object) => object.id === args.selectedObjectId || args.additionalSelectedIds.has(object.id),
  );
  const handle = selectedPartHandle(args, selectedObjects, point, pxToMm);
  if (handle !== null) return handle;
  const scene = focusedScene(args.project.scene, state.projectDocumentEpoch);
  const hit = hitTracePart(scene, point, pxToMm, useUiStore.getState().wireframeView);
  if (hit === null) {
    if (!args.e.shiftKey) state.selectTracePart(null);
    return null;
  }
  const extracting = beginPartExtraction(scene, hit.objectId);
  retainSelectedParts(selectedObjects, args.project.scene);
  const id = state.detachTracePart(hit.objectId, hit.pathIndex, hit.subpathIndex);
  if (id === null) {
    state.cancelInteraction();
    return null;
  }
  const alreadySelected = selectedObjects.some((object) => object.id === id);
  if (args.e.shiftKey || !alreadySelected) state.selectTracePart(id, { toggle: args.e.shiftKey });
  if (args.e.shiftKey) {
    if (extracting) state.endInteraction();
    return null;
  }
  // Selecting existing artwork can persist the output-scope IDs. Capture the
  // drag after that selection so only extraction or movement enters history.
  if (!extracting) state.beginInteraction();
  const next = useStore.getState();
  const object = next.project.scene.objects.find((candidate) => candidate.id === id);
  if (object === undefined) {
    state.cancelInteraction();
    return null;
  }
  return {
    kind: 'move',
    interactionStarted: true,
    objectId: id,
    startScenePoint: point,
    startTx: object.transform.x,
    startTy: object.transform.y,
    selectionStartTransforms: next.project.scene.objects
      .filter(
        (candidate) =>
          candidate.id === next.selectedObjectId || next.additionalSelectedIds.has(candidate.id),
      )
      .map((candidate) => ({ id: candidate.id, transform: { ...candidate.transform } })),
  };
}

export function selectTracePartForContextMenu(
  args: Pick<TracePartDragArgs, 'e' | 'ref' | 'project' | 'viewState'>,
): boolean {
  const state = useStore.getState();
  const point = canvasMouseToScene(args.e, args.ref.current, args.project, args.viewState);
  const scene = focusedScene(args.project.scene, state.projectDocumentEpoch);
  const hit =
    point === null
      ? null
      : hitTracePart(
          scene,
          point,
          pxToMmForCanvas(args.ref.current, args.project, args.viewState),
          useUiStore.getState().wireframeView,
        );
  if (hit === null) {
    state.selectTracePart(null);
    return true;
  }
  const extracting = beginPartExtraction(scene, hit.objectId);
  const id = state.detachTracePart(hit.objectId, hit.pathIndex, hit.subpathIndex);
  if (id === null) {
    if (extracting) state.cancelInteraction();
    return false;
  }
  state.selectTracePart(id);
  if (extracting) state.endInteraction();
  return true;
}

function beginPartExtraction(scene: Scene, objectId: string): boolean {
  const object = scene.objects.find((candidate) => candidate.id === objectId);
  const extracting = object !== undefined && !isSingleTracePart(object, scene.layers);
  if (extracting) useStore.getState().beginInteraction();
  return extracting;
}

function selectedPartHandle(
  args: TracePartDragArgs,
  selectedObjects: ReadonlyArray<SceneObject>,
  point: Vec2,
  pxToMm: number,
): DragState | null {
  if (
    args.e.shiftKey ||
    !selectedObjects.every(
      (object) =>
        object.locked !== true &&
        isSingleTracePart(object, args.project.scene.layers) &&
        sceneObjectHasVisibleLayer(args.project.scene, object),
    )
  )
    return null;
  return pickHandleOrRotateDrag({
    ...args,
    point,
    pxToMm,
    selectedObjects,
    selectedObj: selectedObjects.find((object) => object.id === args.selectedObjectId),
  });
}

// Validate before extraction: a two-part source becomes a single-part remainder
// afterwards, but that does not mean the user picked that remainder.
function retainSelectedParts(objects: ReadonlyArray<SceneObject>, scene: Scene): void {
  const parts = objects.filter(
    (object) =>
      object.locked !== true &&
      isSingleTracePart(object, scene.layers) &&
      sceneObjectHasVisibleLayer(scene, object),
  );
  if (parts.length === objects.length) return;
  const state = useStore.getState();
  state.selectTracePart(null);
  for (const part of parts) state.selectTracePart(part.id, { toggle: true });
}

function focusedScene(scene: Scene, epoch: number): Scene {
  const focus = currentHierarchyFocus(scene, epoch);
  if (focus === null) return scene;
  const members = new Set(scene.groups?.find((group) => group.id === focus)?.objectIds ?? []);
  return { ...scene, objects: scene.objects.filter((object) => members.has(object.id)) };
}
