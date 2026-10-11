import { expect } from 'vitest';
import {
  createProject,
  createLayer,
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type Polyline,
  type TracedImage,
  type Transform,
} from '../../core/scene';
import { boundsFromColoredPaths } from '../../core/trace/trace-bounds';
import { useStore } from '../state/store';

export function loadTrace(transform: Transform = IDENTITY_TRANSFORM, contours = 3): void {
  const polylines: Polyline[] = [20, 100, 180].slice(0, contours).map((x) => ({
    closed: true,
    points: [
      { x, y: 40 },
      { x: x + 40, y: 40 },
      { x: x + 40, y: 80 },
      { x, y: 80 },
    ],
  }));
  // eslint-disable-next-line no-restricted-syntax -- This is a scene artwork colour in a test fixture, not UI chrome.
  const paths = [{ color: '#000000', polylines, curves: polylines.map(polylineToCurveSubpath) }];
  const object: TracedImage = {
    id: 'trace',
    kind: 'traced-image',
    source: 'large-image.png',
    traceSourceId: 'original-image',
    traceMode: 'filled-contours',
    transform,
    paths,
    bounds: boundsFromColoredPaths(paths),
  };
  const project = createProject();
  const layers = paths.map((path) =>
    createLayer({ id: path.color, color: path.color, mode: 'fill' }),
  );
  useStore.setState({
    project: { ...project, scene: { ...project.scene, objects: [object], layers } },
  });
}

export function getTrace(id: string): TracedImage {
  const object = useStore.getState().project.scene.objects.find((candidate) => candidate.id === id);
  if (object?.kind !== 'traced-image') throw new Error(`trace ${id} missing`);
  return object;
}

export function selectedTrace(): TracedImage {
  const id = useStore.getState().selectedObjectId;
  if (id === null) throw new Error('no selected trace part');
  return getTrace(id);
}

export function expectTransform(actual: Transform, expected: Transform): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect({ ...actual, x: 0, y: 0 }).toEqual({ ...expected, x: 0, y: 0 });
}
