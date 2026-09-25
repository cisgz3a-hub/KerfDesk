// LightBurn's Edit Nodes keys (ADR-376): with the node tool on and the pointer
// over the canvas, a letter acts on the node or segment under the pointer
// (https://docs.lightburnsoftware.com/2.1/Reference/EditNodes/). The target
// is found again when the key is pressed, so a second press after an edit
// acts on the edited shape rather than on a stale highlight.
//
// Segment: I inserts a node at the pointer, M at the midpoint, D deletes the
// segment, T trims it back to the nearest crossings, C or S makes it a curve
// and L a line. Node: D deletes it, B breaks the path there, C makes a corner
// and S toggles smooth. A lines up two or more selected nodes, or else turns
// the artwork so the segment under the pointer is level, upright or at 45°.
// Delete removes a segment picked by clicking it.

import { useEffect } from 'react';
import { isEditableShortcutTarget } from '../common/keyboard-targets';
import { useStore } from '../state';
import { pathNodeRefsEqual, type PathNodeRef } from '../state/path-node-edit-actions';
import type { PathSegmentRef } from '../state/path-segment-ref';
import { useToastStore } from '../state/toast-store';
import { isModalOpen, useUiStore } from '../state/ui-store';
import { useCanvasTextStore } from '../text/canvas-text-store';
import { resolveSelectedSegment, useNodeEditStore, type NodeEditPointer } from './node-edit-store';
import { nodeEditHoverAt, nodeEditTarget, type NodeEditHover } from './node-edit-target';
import type { PathSegmentHit } from './path-segment-hit-test';

type App = ReturnType<typeof useStore.getState>;

const NODE_EDIT_KEYS: ReadonlySet<string> = new Set(['i', 'm', 'd', 'b', 't', 'c', 'l', 's', 'a']);

/** Registered in the capture phase so a handled key never also reaches the
 *  global shortcuts (plain T would otherwise switch to the Text tool). */
export function useNodeEditKeys(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!handleNodeEditKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active]);
}

/** Act on a key for the node tool; true when the key was the node tool's. */
export function handleNodeEditKey(event: KeyboardEvent): boolean {
  if (!nodeToolOwnsKeyboard(event)) return false;
  const app = useStore.getState();
  if (event.key === 'Delete' || event.key === 'Backspace') return deleteClickedSegment(app, event);
  const key = event.key.toLowerCase();
  if (!NODE_EDIT_KEYS.has(key) || event.shiftKey || nodeEditTarget(app) === null) return false;
  const pointer = useNodeEditStore.getState().pointer;
  if (!keyHasTarget(app, key, pointer)) return false;
  // Held keys and keys pressed mid-drag are swallowed, not passed on.
  if (event.repeat || app.pendingUndo !== null) return true;
  runNodeEditKey(app, key, pointer === null ? null : hoverAt(app, pointer));
  return true;
}

// Letters need the pointer on the canvas, except A with nodes to line up.
function keyHasTarget(app: App, key: string, pointer: NodeEditPointer | null): boolean {
  return pointer !== null || (key === 'a' && selectedAnchors(app).length >= 2);
}

function hoverAt(app: App, pointer: NodeEditPointer): NodeEditHover | null {
  return nodeEditHoverAt(app, pointer.scenePoint, pointer.pxToMm);
}

function nodeToolOwnsKeyboard(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (isEditableShortcutTarget(event.target)) return false;
  const ui = useUiStore.getState();
  if (ui.toolMode.kind !== 'node' || isModalOpen(ui)) return false;
  return useCanvasTextStore.getState().session === null && !useStore.getState().previewMode;
}

function runNodeEditKey(app: App, key: string, hover: NodeEditHover | null): void {
  if (key === 'a') {
    if (selectedAnchors(app).length >= 2) app.alignSelectedPathNodes();
    else if (hover?.kind === 'segment') app.alignPathSegmentAngle(hover.hit.ref);
    return;
  }
  if (hover?.kind === 'segment') runSegmentKey(app, key, hover.hit);
  else if (hover?.kind === 'node') runNodeKey(app, key, hover.ref);
}

function runSegmentKey(app: App, key: string, hit: PathSegmentHit): void {
  switch (key) {
    case 'i':
      app.insertPathNode(hit.ref, hit.t);
      return;
    case 'm':
      app.insertPathNodeAtMidpoint(hit.ref);
      return;
    case 'd':
      deleteSegment(app, hit.ref);
      return;
    case 't':
      trimSegment(app, hit);
      return;
    case 'c':
    case 's':
      app.convertPathSegment(hit.ref, 'cubic');
      return;
    case 'l':
      app.convertPathSegment(hit.ref, 'line');
      return;
    default:
  }
}

// A hovered handle stands for its node, except that D never deletes a node
// the pointer is not on.
function runNodeKey(app: App, key: string, ref: PathNodeRef): void {
  const { handle, ...anchor } = ref;
  if (key === 'd' && handle === undefined) deleteNode(app, ref);
  else if (key === 'b') app.breakPathAtNode(anchor);
  else if (key === 'c') app.setPathNodeSmoothness(anchor, 'corner');
  else if (key === 's') app.setPathNodeSmoothness(anchor, 'toggle');
}

function deleteNode(app: App, ref: PathNodeRef): void {
  // A node in the current selection takes the whole selection with it, as the
  // Delete key does; any other node goes alone.
  if (!app.selectedPathNodes.some((selected) => pathNodeRefsEqual(selected, ref))) {
    app.selectPathNode(ref);
  }
  useStore.getState().deleteSelectedPathNodes();
}

function deleteSegment(app: App, ref: PathSegmentRef): void {
  // The artwork's last segment takes the artwork with it.
  if (app.deletePathSegment(ref) === 'last-segment') app.removeSceneObjects([ref.objectId]);
}

function trimSegment(app: App, hit: PathSegmentHit): void {
  if (app.trimPathSegment(hit.ref, hit.t) !== 'no-crossing') return;
  useToastStore
    .getState()
    .pushToast('Nothing crosses that segment, so there is nowhere to trim it back to.', 'warning');
}

function deleteClickedSegment(app: App, event: KeyboardEvent): boolean {
  const store = useNodeEditStore.getState();
  if (store.selectedSegment === null || app.selectedPathNodes.length > 0) return false;
  // A held Delete must not go on to delete the artwork once the segment is gone.
  if (event.repeat) return true;
  const ref = resolveSelectedSegment(app.project, store.selectedSegment);
  if (ref === null || ref.objectId !== app.selectedObjectId) {
    store.selectSegment(null, app.project);
    return false;
  }
  // The pick goes stale with the edit but stays set, so the repeats of this
  // press are still recognised above.
  deleteSegment(app, ref);
  return true;
}

function selectedAnchors(app: App): ReadonlyArray<PathNodeRef> {
  return app.selectedPathNodes.filter((ref) => ref.handle === undefined);
}
