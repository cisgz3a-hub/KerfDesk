/* eslint-disable no-restricted-syntax -- These are scene artwork and operation colours in test fixtures, not UI chrome. */
import {
  createLayer,
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type ColoredPath,
  type Polyline,
  type TracedImage,
} from '../../core/scene';
import { withSubpathNesting } from '../../core/scene/subpath-nesting';
import { tracePartActions } from './trace-part-actions';
import { useStore } from './store';

export const actions = tracePartActions((update, onCommitted) => {
  useStore.setState(update);
  onCommitted?.();
});

export function square(x: number, size = 10): Polyline {
  return {
    closed: true,
    points: [
      { x, y: x },
      { x: x + size, y: x },
      { x: x + size, y: x + size },
      { x, y: x + size },
    ],
  };
}

export function trace(paths: ReadonlyArray<ColoredPath> = [rings()]): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace',
    source: 'drawing.png',
    traceSourceId: 'source',
    tracePixelWidth: 200,
    tracePixelHeight: 200,
    traceMode: 'filled-contours',
    transform: {
      ...IDENTITY_TRANSFORM,
      x: 12,
      y: 8,
      scaleX: 0.2,
      scaleY: 0.3,
      rotationDeg: 34,
      mirrorX: true,
    },
    bounds: { minX: 0, minY: 0, maxX: 110, maxY: 110 },
    paths,
  };
}

export function rings(): ColoredPath {
  const polylines = [square(0, 40), square(10, 20), square(80, 20)];
  return withSubpathNesting(
    {
      color: '#000000',
      polylines,
      curves: polylines.map(polylineToCurveSubpath),
      operationIds: ['cut'],
      fillRule: 'evenodd',
      strokeWidthMm: 0.4,
    },
    [-1, 0, -1],
  );
}

export function load(object: TracedImage): void {
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: { objects: [object], layers: [createLayer({ color: '#000000', id: 'cut' })] },
    },
  }));
}

export function pieces(): ReadonlyArray<TracedImage> {
  return useStore.getState().project.scene.objects as ReadonlyArray<TracedImage>;
}
