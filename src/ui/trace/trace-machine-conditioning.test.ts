import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type Polyline,
  type TracedImage,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { boundsFromColoredPaths, DEFAULT_TRACE_OPTIONS } from '../../core/trace';
import { fairTracedImageForCnc } from './fair-traced-image-for-cnc';
import { conditionTracedImageForMachine } from './trace-machine-conditioning';

const PLACEMENT: Transform = { ...IDENTITY_TRANSFORM, x: 5, y: 7, scaleX: 0.1, scaleY: 0.1 };
const VECTOR = { options: DEFAULT_TRACE_OPTIONS, traceOutput: 'vector' } as const;
const PHOTO = { options: { ...DEFAULT_TRACE_OPTIONS, photoDetail: 60 } } as const;

function tracedRing(): TracedImage {
  const points: Vec2[] = [];
  for (let index = 0; index < 420; index += 1) {
    const angle = (2 * Math.PI * index) / 420;
    points.push({ x: 120 + 100 * Math.cos(angle), y: 120 + 100 * Math.sin(angle) });
  }
  points.push({ ...(points[0] as Vec2) });
  const ring: Polyline = { points, closed: true };
  const paths = [{ color: '#000000', polylines: [ring], curves: [polylineToCurveSubpath(ring)] }];
  return {
    kind: 'traced-image',
    id: 'trace',
    source: 'ring.png',
    traceSourceId: 'source',
    tracePixelWidth: 240,
    tracePixelHeight: 240,
    transform: IDENTITY_TRANSFORM,
    bounds: boundsFromColoredPaths(paths),
    paths,
  };
}

function vertexCount(traced: TracedImage): number {
  return traced.paths.reduce(
    (count, path) => count + path.polylines.reduce((sum, line) => sum + line.points.length, 0),
    0,
  );
}

describe('conditionTracedImageForMachine', () => {
  it.each(['laser', undefined] as const)(
    'simplifies %s vector traces and keeps bounds on the conditioned geometry',
    (machineKind) => {
      const traced = tracedRing();
      const conditioned = conditionTracedImageForMachine(traced, PLACEMENT, machineKind, VECTOR);
      expect(vertexCount(conditioned)).toBeLessThan(vertexCount(traced) / 4);
      expect(conditioned.bounds).toEqual(boundsFromColoredPaths(conditioned.paths));
      expect(conditioned.transform).toBe(traced.transform);
      expect(conditioned.tracePixelWidth).toBe(traced.tracePixelWidth);
      expect(vertexCount(traced)).toBe(421);
    },
  );

  it('fairs CNC traces as before', () => {
    const traced = tracedRing();
    expect(conditionTracedImageForMachine(traced, PLACEMENT, 'cnc', VECTOR)).toEqual(
      fairTracedImageForCnc(traced, PLACEMENT),
    );
  });

  it('keeps Photo shading and raster-scan output as traced', () => {
    const traced = tracedRing();
    expect(conditionTracedImageForMachine(traced, PLACEMENT, 'laser', PHOTO)).toBe(traced);
    expect(conditionTracedImageForMachine(traced, PLACEMENT, 'cnc', PHOTO)).toBe(traced);
    const raster = { ...VECTOR, traceOutput: 'raster' } as const;
    expect(conditionTracedImageForMachine(traced, PLACEMENT, 'laser', raster)).toBe(traced);
  });

  it('returns the trace itself when there is nothing to simplify', () => {
    const triangle: Polyline = {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 80 },
        { x: 0, y: 0 },
      ],
      closed: true,
    };
    const traced = { ...tracedRing(), paths: [{ color: '#000000', polylines: [triangle] }] };
    expect(conditionTracedImageForMachine(traced, PLACEMENT, 'laser', VECTOR)).toBe(traced);
  });
});
