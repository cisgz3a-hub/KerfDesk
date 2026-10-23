import { beforeEach, expect, it } from 'vitest';
import { createLayer, type Scene } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { warpDeformRequestForSelection } from './warp-deform-plan';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(resetStore);

it('uses displayed geometry only for still-unlocked session targets and refuses a stale display', () => {
  const rectangles = ['target', 'locked-during-session', 'outside'].map((id) =>
    createRectangle({
      id,
      color: '#000000',
      spec: { widthMm: 10, heightMm: 8, cornerRadiusMm: 0 },
    }),
  );
  const scene: Scene = {
    objects: rectangles,
    layers: [createLayer({ id: 'line', color: '#000000' })],
    groups: [],
  };
  const request = warpDeformRequestForSelection(scene, ['target', 'locked-during-session'], 'warp');
  if (request === null) throw new Error('Expected selected vector targets');
  const moved = {
    ...request,
    handles: request.handles.map((point) => ({ x: point.x + 10, y: point.y + 5 })),
  };
  const locked = { ...rectangles[1]!, locked: true };
  const source = {
    ...useStore.getState().project,
    scene: { ...scene, objects: [rectangles[0]!, locked, rectangles[2]!] },
  };
  useStore.setState({ project: source, selectedObjectId: 'target' });
  const display = {
    ...source.scene,
    objects: source.scene.objects.map((object) => ({
      ...object,
      paths: 'paths' in object ? [...object.paths] : [],
    })),
  };
  const stale = { ...source };
  useStore.getState().applyWarpDeform(moved, { source: stale, scene: display });
  expect(useStore.getState().project).toBe(source);
  expect(useStore.getState().undoStack).toHaveLength(0);
  useStore.getState().applyWarpDeform(moved, { source, scene: display });
  const after = useStore.getState().project;
  expect(after.scene.objects[0]?.kind).toBe('imported-svg');
  expect(after.scene.objects[1]).toBe(locked);
  expect(after.scene.objects[2]).toBe(rectangles[2]);
  expect(useStore.getState().undoStack).toHaveLength(1);
  useStore.getState().undo();
  expect(useStore.getState().project).toBe(source);
});
