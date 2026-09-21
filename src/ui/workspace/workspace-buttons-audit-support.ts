/* eslint-disable no-restricted-syntax -- Fixture colours describe scene artwork, not UI chrome. */
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';

export function addRectangle(): void {
  useStore.getState().drawShape(
    createRectangle({
      id: 'art',
      color: '#000000',
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 30, y: 40 },
    }),
  );
}
export function lineTriangle(): CurveSubpath {
  return {
    start: { x: 0, y: 0 },
    closed: true,
    segments: [
      { kind: 'line', to: { x: 10, y: 0 } },
      { kind: 'line', to: { x: 10, y: 10 } },
      { kind: 'line', to: { x: 0, y: 0 } },
    ],
  };
}
export function loadCurve(curve: CurveSubpath, pointIndex: number): void {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'curve',
    source: 'curve.svg',
    bounds: { minX: 0, minY: 0, maxX: 15, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        curves: [curve],
        polylines: [
          {
            points: [curve.start, ...curve.segments.map((segment) => segment.to)],
            closed: curve.closed,
          },
        ],
      },
    ],
  };
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [object],
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    },
    undoStack: [],
  });
  useStore.getState().selectObject('curve');
  useStore.getState().selectPathNode({
    objectId: 'curve',
    pathIndex: 0,
    polylineIndex: 0,
    pointIndex,
    geometry: 'curve',
  });
  useUiStore.getState().setToolMode({ kind: 'node' });
}
export function currentCurve(): CurveSubpath {
  const object = useStore.getState().project.scene.objects[0] as ImportedSvg;
  const curve = object.paths[0]?.curves?.[0];
  if (curve === undefined) throw new Error('Missing curve');
  return curve;
}
