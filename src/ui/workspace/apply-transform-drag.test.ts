import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
  type Transform,
} from '../../core/scene';
import { useToastStore } from '../state/toast-store';
import { applyTransformDrag } from './apply-transform-drag';
import type { DragState } from './drag-state';
import { DEFAULT_SNAP_SETTINGS, type SnapGuide } from './snapping';

const event = { shiftKey: false, ctrlKey: false, metaKey: false };
const snapSettings = { ...DEFAULT_SNAP_SETTINGS, snapToGrid: false };
// The default 8 px reach is 2 mm at this zoom.
const pxToMm = 0.25;

describe('applyTransformDrag', () => {
  it('does not snap a multi-selected move to another selected object stale position', () => {
    const first = objectAt('first', 0, 0);
    const second = objectAt('second', 30, 0);
    const updates: Array<{ readonly id: string; readonly transform: Transform }> = [];
    let guides: ReadonlyArray<SnapGuide> = [];

    applyTransformDrag({
      drag: multiMoveDrag(),
      point: { x: -19.2, y: 0 },
      e: event,
      project: projectWithObjects([first, second]),
      selectionAnchor: 'c',
      snapSettings,
      pxToMm,
      setSnapMarker: () => undefined,
      setObjectTransform: (id, transform) => updates.push({ id, transform }),
      setSnapGuides: (next) => {
        guides = next;
      },
    });

    expect(updates).toEqual([
      { id: 'first', transform: transformAt(-19.2, 0) },
      { id: 'second', transform: transformAt(10.8, 0) },
    ]);
    expect(guides).toEqual([]);
  });

  it('resizes a whole selection about the pinned corner via a combined-box handle (C5)', () => {
    const a = objectAt('a', 0, 0);
    const b = objectAt('b', 30, 0);
    const updates: Array<{ readonly id: string; readonly transform: Transform }> = [];

    // Combined box is 0..40; drag the SE handle to (80,20) doubles it about NW.
    applyTransformDrag({
      drag: { kind: 'selection-scale', handle: 'se', selectionIds: ['a', 'b'] },
      point: { x: 80, y: 20 },
      e: event,
      project: projectWithObjects([a, b]),
      selectionAnchor: 'c',
      snapSettings,
      pxToMm,
      setSnapMarker: () => undefined,
      setObjectTransform: (id, transform) => updates.push({ id, transform }),
      setSnapGuides: () => undefined,
    });

    const byId = new Map(updates.map((u) => [u.id, u.transform]));
    expect(byId.get('a')?.scaleX).toBeCloseTo(2);
    expect(byId.get('a')?.scaleY).toBeCloseTo(2);
    expect(byId.get('a')?.x).toBeCloseTo(0); // NW corner pinned
    expect(byId.get('a')?.y).toBeCloseTo(0);
    expect(byId.get('b')?.x).toBeCloseTo(60);
    expect(byId.get('b')?.scaleX).toBeCloseTo(2);
  });

  // Weakness audit H-7: a side handle cannot stretch an object turned 30
  // degrees without shear, and the handle used to do nothing without a word.
  it('says once why a side handle cannot stretch a selection with an obliquely turned object', () => {
    useToastStore.setState({ toasts: [] });
    const a = objectAt('a', 0, 0);
    const b = { ...objectAt('b', 30, 0), transform: { ...transformAt(30, 0), rotationDeg: 30 } };
    const updates: Array<{ readonly id: string; readonly transform: Transform }> = [];
    const drag = (x: number): void =>
      applyTransformDrag({
        drag: { kind: 'selection-scale', handle: 'e', selectionIds: ['a', 'b'] },
        point: { x, y: 5 },
        e: event,
        project: projectWithObjects([a, b]),
        selectionAnchor: 'c',
        snapSettings,
        pxToMm,
        setSnapMarker: () => undefined,
        setObjectTransform: (id, transform) => updates.push({ id, transform }),
        setSnapGuides: () => undefined,
      });

    drag(60);
    drag(70);

    expect(updates).toEqual([]);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toContain('scaled evenly');
    useToastStore.setState({ toasts: [] });
  });

  it('stretches a quarter-turned object with a side handle', () => {
    useToastStore.setState({ toasts: [] });
    const turned = {
      ...objectAt('t', 0, 0),
      transform: { ...transformAt(10, 0), rotationDeg: 90 },
    };
    const updates: Array<{ readonly id: string; readonly transform: Transform }> = [];

    // The 10 x 10 box spans X 0..10; drag its east handle to X 30.
    applyTransformDrag({
      drag: { kind: 'selection-scale', handle: 'e', selectionIds: ['t'] },
      point: { x: 30, y: 5 },
      e: event,
      project: projectWithObjects([turned]),
      selectionAnchor: 'c',
      snapSettings,
      pxToMm,
      setSnapMarker: () => undefined,
      setObjectTransform: (id, transform) => updates.push({ id, transform }),
      setSnapGuides: () => undefined,
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]?.transform.scaleX).toBeCloseTo(1);
    expect(updates[0]?.transform.scaleY).toBeCloseTo(3);
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});

function projectWithObjects(objects: ReadonlyArray<SceneObject>): Project {
  const project = createProject();
  return { ...project, scene: { ...project.scene, objects } };
}

function objectAt(id: string, x: number, y: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: transformAt(x, y),
    paths: [],
  };
}

function transformAt(x: number, y: number): Transform {
  return { ...IDENTITY_TRANSFORM, x, y };
}

function multiMoveDrag(): Extract<DragState, { kind: 'move' }> {
  return {
    kind: 'move',
    objectId: 'second',
    startScenePoint: { x: 0, y: 0 },
    startTx: 30,
    startTy: 0,
    selectionStartTransforms: [
      { id: 'first', transform: transformAt(0, 0) },
      { id: 'second', transform: transformAt(30, 0) },
    ],
  };
}
