import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type CurveSubpath,
  type Polyline,
  type TracedImage,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { fairToolpathPolylines } from '../../core/geometry';
import { boundsFromColoredPaths, DEFAULT_TRACE_OPTIONS } from '../../core/trace';
import { fairTracedImageForCnc } from './fair-traced-image-for-cnc';
import {
  COMMIT_CONDITIONING_SYNC_VERTICES,
  conditionTracedImageForCommit,
  conditionTracedImageForMachine,
} from './trace-machine-conditioning';
import { isTraceAbort } from './trace-cancellation';

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

function ringPoints(cx: number, cy: number, radius: number, count: number): Vec2[] {
  const points: Vec2[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (2 * Math.PI * index) / count;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  points.push({ ...(points[0] as Vec2) });
  return points;
}

function cubicCircle(cx: number, cy: number, r: number): CurveSubpath {
  const k = 0.5523 * r;
  const cubic = (c1: Vec2, c2: Vec2, to: Vec2) => ({
    kind: 'cubic' as const,
    control1: c1,
    control2: c2,
    to,
  });
  return {
    start: { x: cx + r, y: cy },
    segments: [
      cubic({ x: cx + r, y: cy + k }, { x: cx + k, y: cy + r }, { x: cx, y: cy + r }),
      cubic({ x: cx - k, y: cy + r }, { x: cx - r, y: cy + k }, { x: cx - r, y: cy }),
      cubic({ x: cx - r, y: cy - k }, { x: cx - k, y: cy - r }, { x: cx, y: cy - r }),
      cubic({ x: cx + k, y: cy - r }, { x: cx + r, y: cy - k }, { x: cx + r, y: cy }),
    ],
    closed: true,
  };
}

/** A coloring-page-like trace: dense pixel-pitch rings (each with a hole) and
 *  fitted cubic circles, far more vertices than a commit conditions inline. */
function denseTrace(): TracedImage {
  const polylines: Polyline[] = [];
  const curves: CurveSubpath[] = [];
  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      const cx = 60 + column * 120;
      const cy = 60 + row * 120;
      for (const radius of [50, 46]) {
        const ring: Polyline = { points: ringPoints(cx, cy, radius, 300), closed: true };
        polylines.push(ring);
        curves.push(polylineToCurveSubpath(ring));
      }
      const fitted = cubicCircle(cx, cy, 20);
      curves.push(fitted);
      polylines.push({ points: ringPoints(cx, cy, 20, 120), closed: true });
    }
  }
  const paths = [{ color: '#000000', polylines, curves }];
  return { ...tracedRing(), tracePixelWidth: 720, tracePixelHeight: 720, paths };
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

  // The CNC commit fairs one polyline per slice; that is the same computation
  // only because fairing is a per-polyline map that shares nothing but options.
  it('fairs polylines one at a time exactly as all at once', () => {
    const polylines = denseTrace().paths.flatMap((path) => path.polylines);
    const pinnedPoints = new Set<Vec2>([polylines[0]!.points[7]!, polylines[5]!.points[0]!]);
    const options = {
      mmPerPx: 0.1,
      minSegmentMm: 0.4,
      maxDeviationMm: 0.05,
      cornerAngleDeg: 60,
      pinnedPoints,
    };
    expect(polylines.flatMap((polyline) => fairToolpathPolylines([polyline], options))).toEqual(
      fairToolpathPolylines(polylines, options),
    );
  });

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

// The whole browser app froze after a dense Line Art trace: the commit ran
// this conditioning (seconds on a coloring page) in one task.
describe('conditionTracedImageForCommit', () => {
  /** Timer tasks that ran while `work` was pending. */
  async function turnsDuring<T>(work: () => Promise<T>): Promise<{ value: T; turns: number }> {
    let turns = 0;
    let done = false;
    const tick = (): void => {
      if (done) return;
      turns += 1;
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
    try {
      return { value: await work(), turns };
    } finally {
      done = true;
    }
  }

  // CNC fairing ran in one task after the laser conditioning was sliced.
  it.each(['laser', 'cnc'] as const)(
    'gives the browser turns on a dense %s trace and conditions it exactly as in one task',
    async (machineKind) => {
      const traced = denseTrace();
      expect(vertexCount(traced)).toBeGreaterThan(10 * COMMIT_CONDITIONING_SYNC_VERTICES);
      const inOneTask = conditionTracedImageForMachine(traced, PLACEMENT, machineKind, VECTOR);
      expect(inOneTask.paths).not.toEqual(traced.paths);

      const { value, turns } = await turnsDuring(() =>
        conditionTracedImageForCommit(traced, PLACEMENT, machineKind, VECTOR),
      );

      // Hundreds of milliseconds of work, sliced every 8 ms.
      expect(turns).toBeGreaterThan(0);
      expect(value).toEqual(inOneTask);
    },
  );

  it.each(['laser', 'cnc'] as const)('stops a %s commit when it is cancelled', async (kind) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 0);

    const outcome = await conditionTracedImageForCommit(
      denseTrace(),
      PLACEMENT,
      kind,
      VECTOR,
      controller.signal,
    ).catch((error: unknown) => error);

    expect(isTraceAbort(outcome)).toBe(true);
  });

  it('conditions a small trace in the commit task itself', async () => {
    const traced = tracedRing();

    const { value, turns } = await turnsDuring(() =>
      conditionTracedImageForCommit(traced, PLACEMENT, 'laser', VECTOR),
    );

    expect(turns).toBe(0);
    expect(value).toEqual(conditionTracedImageForMachine(traced, PLACEMENT, 'laser', VECTOR));
  });
});
