// Rolling audit v9 R3-P1-2 (ADR-494 Amendment 4): a handle drag rebuilt a rounded
// rectangle on every frame and measured its tabs from the frame before. Once a
// frame had brought a tab into a corner its old place was gone, so a drag that
// shrank and returned ended with the tab moved, on a part back at its old size.
// These drive the real applyTransformDrag frame by frame, as the pointer does.
import { beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ShapeObject, type Vec2 } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import {
  TAB_COLOR,
  cncTabRises,
  expectSamePoints,
  expectSpansAt,
  expectTabsAt,
  p,
  tabPlaces,
  tabbedProject,
  withPlacedTabs,
} from '../state/placed-tabs.test-support';
import { applyTransformDrag } from './apply-transform-drag';
import type { DragState } from './drag-state';
import { DEFAULT_SNAP_SETTINGS } from './snapping';

const event = { shiftKey: false, ctrlKey: false, metaKey: false };
const snapSettings = { ...DEFAULT_SNAP_SETTINGS, snapToGrid: false, enabled: false };
// The audit's part, 300 × 100 r 25 at (100, 100).
const TABS = [p(145, 200), p(175, 200), p(250, 200), p(400, 140), p(400, 160)];
const OUT_AND_BACK = [340, 280, 200, 150, 200, 280, 340, 400];

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

function rounded(id: string, x: number, widthMm: number, tabs: ReadonlyArray<Vec2>, r = 25) {
  const rectangle = createRectangle({
    id,
    color: TAB_COLOR,
    spec: { widthMm, heightMm: 100, cornerRadiusMm: r },
    transform: { ...IDENTITY_TRANSFORM, x, y: 100 },
  });
  return withPlacedTabs({ ...rectangle, operationIds: ['cut'] }, tabs);
}

function load(objects: ReadonlyArray<ShapeObject>, groups = false): void {
  const project = tabbedProject(objects);
  useStore.setState({
    project: groups
      ? {
          ...project,
          scene: {
            ...project.scene,
            groups: [{ id: 'g', name: 'g', objectIds: objects.map((object) => object.id) }],
          },
        }
      : project,
    selectedObjectId: objects[0]?.id ?? null,
    additionalSelectedIds: new Set(objects.slice(1).map((object) => object.id)),
    dirty: false,
  });
}

// One pointer move on the live project, as use-workspace-drag makes it.
function dragFrames(drag: DragState, frames: ReadonlyArray<Vec2>): void {
  useStore.getState().beginInteraction();
  for (const point of frames) {
    applyTransformDrag({
      drag,
      point,
      e: event,
      project: useStore.getState().project,
      selectionAnchor: 'nw',
      snapSettings,
      pxToMm: 0.25,
      setObjectTransforms: useStore.getState().setObjectTransforms,
      setSnapGuides: () => undefined,
      setSnapMarker: () => undefined,
    });
  }
  useStore.getState().endInteraction();
}

function eastFrames(xs: ReadonlyArray<number>): ReadonlyArray<Vec2> {
  return xs.map((x) => p(x, 150));
}

function shape(id: string): ShapeObject {
  const object = useStore.getState().project.scene.objects.find((o) => o.id === id);
  if (object?.kind !== 'shape') throw new Error('the part is gone');
  return object;
}

describe('a handle drag measures each tab from where the drag began', () => {
  it('leaves every tab in place after a drag that shrinks past a corner and returns', () => {
    load([rounded('rr', 100, 300, TABS)]);
    const before = shape('rr');

    dragFrames({ kind: 'scale', objectId: 'rr', handle: 'e' }, eastFrames(OUT_AND_BACK));

    expect(shape('rr').spec).toMatchObject({ widthMm: 300, heightMm: 100, cornerRadiusMm: 25 });
    // Before the fix: 158.407 and 182.89, 13.407 and 7.89 mm off.
    expectTabsAt(shape('rr'), TABS);
    expectSpansAt(useStore.getState().project, TABS);
    expectSamePoints(cncTabRises(shape('rr')), cncTabRises(rounded('rr', 100, 300, TABS)), 1e-6);
    expect(useToastStore.getState().toasts).toEqual([]);

    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(shape('rr')).toEqual(before);
    useStore.getState().redo();
    expectTabsAt(shape('rr'), TABS);
  });

  it('lands where one stretch from the start puts them when it ends at another size', () => {
    load([rounded('rr', 100, 300, TABS)]);

    dragFrames({ kind: 'scale', objectId: 'rr', handle: 'e' }, eastFrames([200, 150, 200, 300]));

    // Before the fix: 138.938 and 155.26, 8.94 and 5.26 mm off.
    const stretched = [p(130, 200), p(150, 200), p(200, 200), p(300, 140), p(300, 160)];
    expectTabsAt(shape('rr'), stretched);
    expectSpansAt(useStore.getState().project, stretched);
  });

  it('holds for every part of a multi-selection, through the selection handle', () => {
    load([rounded('a', 100, 300, TABS), rounded('b', 500, 300, TABS.map(shiftedBy(400)))]);

    // The combined box runs 100 to 800: down to 60 % of it and back, free aspect.
    dragFrames(
      { kind: 'selection-scale', handle: 'e', selectionIds: ['a', 'b'] },
      eastFrames([700, 400, 200, 400, 700, 800]),
    );

    expectTabsAt(shape('a'), TABS, 1e-3);
    expectTabsAt(shape('b'), TABS.map(shiftedBy(400)), 1e-3);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('holds for the members of a group, which drag as one selection', () => {
    load([rounded('a', 100, 300, TABS), rounded('b', 500, 300, TABS.map(shiftedBy(400)))], true);

    dragFrames(
      { kind: 'selection-scale', handle: 'e', selectionIds: ['a', 'b'] },
      eastFrames([400, 200, 800]),
    );

    expectTabsAt(shape('a'), TABS, 1e-3);
    expectTabsAt(shape('b'), TABS.map(shiftedBy(400)), 1e-3);
  });

  it('Escape puts the part back exactly', () => {
    load([rounded('rr', 100, 300, TABS)]);
    const before = shape('rr');

    useStore.getState().beginInteraction();
    useStore
      .getState()
      .setObjectTransforms([{ id: 'rr', transform: { ...before.transform, scaleX: 1 / 6 } }]);
    useStore.getState().cancelInteraction();

    expect(shape('rr')).toEqual(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});

describe('controls', () => {
  it('a one-way grow lands exactly on the stretch', () => {
    load([rounded('rr', 100, 300, TABS)]);

    dragFrames({ kind: 'scale', objectId: 'rr', handle: 'e' }, eastFrames([450, 550, 700]));

    const stretched = [p(190, 200), p(250, 200), p(400, 200), p(700, 140), p(700, 160)];
    expectTabsAt(shape('rr'), stretched);
  });

  it('a sharp rectangle keeps its anchors and stays a plain scale', () => {
    load([rounded('rr', 100, 300, TABS, 0)]);
    const before = shape('rr');

    dragFrames({ kind: 'scale', objectId: 'rr', handle: 'e' }, eastFrames(OUT_AND_BACK));

    expect(shape('rr').spec).toEqual(before.spec);
    expect(shape('rr').laserTabAnchors).toBe(before.laserTabAnchors);
    expectTabsAt(shape('rr'), TABS);
  });

  it('a part with no placed tabs gets none from the drag', () => {
    const plain = createRectangle({
      id: 'rr',
      color: TAB_COLOR,
      spec: { widthMm: 300, heightMm: 100, cornerRadiusMm: 25 },
      transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100 },
    });
    load([{ ...plain, operationIds: ['cut'] }]);

    dragFrames({ kind: 'scale', objectId: 'rr', handle: 'e' }, eastFrames(OUT_AND_BACK));

    expect(shape('rr').laserTabAnchors).toBeUndefined();
    expect(shape('rr').cncTabAnchors).toBeUndefined();
    expect(tabPlaces(shape('rr'))).toEqual([]);
  });
});

function shiftedBy(dx: number): (point: Vec2) => Vec2 {
  return (point) => p(point.x + dx, point.y);
}
