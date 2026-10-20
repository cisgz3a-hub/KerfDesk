import { beforeEach, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type TracedImage } from '../../core/scene';
import { hitPathNode } from '../workspace/path-node-hit-test';
import { deserializeProject, prepareProjectForPersistence } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(resetStore);

it('moves only the picked start anchor after materialising a compact closed trace', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 20 },
    { x: 0, y: 20 },
  ];
  const trace: TracedImage = {
    kind: 'traced-image',
    id: 'trace',
    source: 'trace.png',
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
    paths: [{ color: '#000000', polylines: [{ points, closed: true }] }],
  };
  const base = createProject();
  useStore.setState({
    project: {
      ...base,
      scene: {
        ...base.scene,
        objects: [trace],
        layers: [createLayer({ id: 'line', color: '#000000' })],
      },
    },
    selectedObjectId: trace.id,
  });
  const pickStart = () => {
    const app = useStore.getState();
    const hit = hitPathNode(app.project.scene, points[0]!, 0.01);
    expect(hit).not.toBeNull();
    app.selectPathNode(hit);
  };
  pickStart();
  useStore.getState().convertSelectedCurveSegment('cubic');
  pickStart();
  expect(useStore.getState().selectedPathNode?.geometry).toBe('curve');
  const beforeNudge = useStore.getState().project;
  useStore.getState().nudgeSelectedPathNode(3, 4);
  const edited = useStore.getState().project.scene.objects[0];
  if (edited?.kind !== 'traced-image') throw new Error('Missing edited trace');
  expect(edited.paths[0]?.curves?.[0]?.start).toEqual({ x: 3, y: 4 });
  expect(edited.paths[0]?.curves?.[0]?.segments.at(-1)?.to).toEqual(points.at(-1));
  const saved = prepareProjectForPersistence(useStore.getState().project);
  expect(saved.kind).toBe('ok');
  if (saved.kind !== 'ok') return;
  expect(deserializeProject(saved.json)).toEqual({ kind: 'ok', project: saved.project });
  useStore.getState().undo();
  expect(useStore.getState().project).toBe(beforeNudge);
  useStore.getState().redo();
  expect(useStore.getState().project.scene.objects[0]).toBe(edited);
});
