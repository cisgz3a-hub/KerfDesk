import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useGuideLockStore } from './guide-lock-store';
import { beginGuideDrag, finishGuideDrag, updateGuideDrag } from './guide-drag';
import { snapMoveTransform } from './snapping';
import { DEFAULT_SNAP_SETTINGS } from './snap-settings';

const VIEW = { zoomFactor: 1, panX: 0, panY: 0 };

// A canvas whose bitmap matches its CSS box one to one.
function canvas(): HTMLCanvasElement {
  const element = document.createElement('canvas');
  element.width = 800;
  element.height = 600;
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }) as DOMRect;
  return element;
}

const event = (x: number, y: number) =>
  ({ clientX: x, clientY: y }) as React.MouseEvent<HTMLCanvasElement>;

beforeEach(() => {
  resetStore();
  useGuideLockStore.setState({ locked: false });
});

describe('guidelines', () => {
  it('pulls a horizontal guide out of the top ruler in one undo step', () => {
    const element = canvas();
    const project = useStore.getState().project;
    const args = { canvas: element, project, viewState: VIEW };
    const drag = beginGuideDrag({ ...args, e: event(300, 10) });
    expect(drag).toMatchObject({ kind: 'guide', axis: 'y', created: true });
    if (drag === null) throw new Error('expected a guide drag');
    updateGuideDrag(drag, { x: 50, y: 42 });
    finishGuideDrag(drag, { ...args, e: event(300, 300) });
    const state = useStore.getState();
    expect(state.project.guides).toEqual([{ id: drag.id, axis: 'y', positionMm: 42 }]);
    expect(state.undoStack).toHaveLength(1);
  });

  it('leaves no history for a ruler click, and deletes a guide dropped back on a ruler', () => {
    const element = canvas();
    const args = {
      canvas: element,
      project: useStore.getState().project,
      viewState: VIEW,
    };
    const click = beginGuideDrag({ ...args, e: event(10, 300) });
    if (click === null) throw new Error('expected a guide drag');
    finishGuideDrag(click, { ...args, e: event(10, 300) });
    expect(useStore.getState().project.guides).toBeUndefined();
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('does nothing while guides are locked', () => {
    useGuideLockStore.setState({ locked: true });
    const args = {
      canvas: canvas(),
      project: useStore.getState().project,
      viewState: VIEW,
    };
    expect(beginGuideDrag({ ...args, e: event(300, 10) })).toBeNull();
  });

  it('snaps moving artwork onto a guide', () => {
    const rect = createRectangle({
      id: 'r',
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    });
    const project: Project = {
      ...createProject(),
      guides: [{ id: 'g', axis: 'x', positionMm: 50 }],
      scene: { ...createProject().scene, objects: [rect] },
    };
    const result = snapMoveTransform({
      project,
      movingObjectId: 'r',
      proposedTransform: { ...IDENTITY_TRANSFORM, x: 49, y: 100 },
      settings: { ...DEFAULT_SNAP_SETTINGS, enabled: true, snapToGrid: false },
      distanceMm: 2,
    });
    expect(result.transform.x).toBe(50);
  });
});
