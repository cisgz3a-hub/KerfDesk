import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePngFile } from '../../__fixtures__/perceptual/png-decode';
import type { ColoredPath, CurveSubpath, PathSegment, Polyline } from '../../core/scene';
import { polylineToCurveSubpath } from '../../core/scene';
import { TRACE_PRESETS, traceImageToColoredPaths, type RawImageData } from '../../core/trace';
import { runTraceSteps } from '../../core/trace/trace-steps';
import {
  packTracePaths,
  packedTracePathsTransfer,
  unpackTracePathsSteps,
  type PackedTracePaths,
} from './trace-result-transfer';

// Everything structured clone would hand the UI thread, in visit order: each
// key, each primitive (-0 kept apart from 0), and for each object whether it
// is new or which earlier object it is. Two graphs with the same signature
// have the same values, key order and object sharing.
function graphSignature(root: unknown): string[] {
  const ids = new Map<object, number>();
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) {
      out.push(Object.is(value, -0) ? 'num:-0' : `${typeof value}:${String(value)}`);
      return;
    }
    const seen = ids.get(value);
    if (seen !== undefined) {
      out.push(`ref:${seen}`);
      return;
    }
    ids.set(value, ids.size);
    out.push(Array.isArray(value) ? `array:${value.length}` : 'object');
    for (const key of Object.keys(value)) {
      out.push(`key:${key}`);
      visit((value as Record<string, unknown>)[key]);
    }
  };
  visit(root);
  return out;
}

function unpack(packed: PackedTracePaths): ColoredPath[] {
  // What the worker posts is what the UI thread reads: clone it as postMessage does.
  return runTraceSteps(unpackTracePathsSteps(structuredClone(packed)));
}

function expectRoundTrip(paths: ColoredPath[]): ColoredPath[] {
  const packed = packTracePaths(paths);
  expect(packed).not.toBeNull();
  const unpacked = unpack(packed!);
  expect(graphSignature(unpacked)).toEqual(graphSignature(structuredClone(paths)));
  return unpacked;
}

function crop(image: RawImageData, x: number, y: number, w: number, h: number): RawImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row += 1) {
    const from = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(from, from + w * 4), row * w * 4);
  }
  return { width: w, height: h, data };
}

const STRESS = decodePngFile(
  resolve('src/__fixtures__/perceptual/assets/centerline-stress-test-20260909.png'),
);

describe('packed trace results', () => {
  it.each(['Line Art', 'Centerline', 'Edge Detection', 'Photo shading', 'Line + fill'])(
    'rebuild the %s tracer output exactly as structured clone does',
    async (preset) => {
      const image = crop(STRESS, 300, 300, 220, 220);
      const paths = await traceImageToColoredPaths(image, TRACE_PRESETS[preset]!);
      expect(paths.length).toBeGreaterThan(0);
      expectRoundTrip(paths);
    },
    60_000,
  );

  it('keeps a vertex shared by a polyline and its curve as one object', () => {
    const polyline = {
      points: [
        { x: 0, y: 0 },
        { x: -0, y: 2.5 },
        { x: Number.NaN, y: 1e-300 },
      ],
      closed: false,
    };
    const paths: ColoredPath[] = [
      { color: '#000000', polylines: [polyline], curves: [polylineToCurveSubpath(polyline)] },
    ];
    // The signature sees sharing: a copy that splits the shared vertices fails it.
    const split: ColoredPath[] = [
      { ...paths[0]!, curves: [polylineToCurveSubpath(structuredClone(polyline))] },
    ];
    expect(graphSignature(split)).not.toEqual(graphSignature(structuredClone(paths)));
    const unpacked = expectRoundTrip(paths);
    const [path] = unpacked as [ColoredPath];
    const [curve] = path.curves as [CurveSubpath];
    const { points } = path.polylines[0] as Polyline;
    expect(curve.start).toBe(points[0]);
    expect((curve.segments[0] as PathSegment).to).toBe(points[1]);
    expect(Object.is(points[1]?.x, -0)).toBe(true);
  });

  it('keeps every segment kind, key order and path field', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 3, y: 4 };
    expectRoundTrip([
      {
        color: '#112233',
        operationIds: ['op-1'],
        polylines: [{ closed: true, points: [a, b] }],
        curves: [
          {
            start: a,
            closed: true,
            segments: [
              { kind: 'cubic', control1: { x: 5, y: 6 }, control2: b, to: { x: 7, y: 8 } },
              {
                kind: 'elliptical-arc',
                radiusX: 2.25,
                radiusY: 1.5,
                rotationDeg: -30,
                largeArc: true,
                sweep: false,
                to: a,
              },
              { to: b, kind: 'line' } as never,
            ],
          },
        ],
        strokeWidthMm: 0.3,
        subpathNesting: { parents: [-1], geometryKey: 'k' },
        fillRule: 'evenodd',
      },
      // An explicit undefined key survives structured clone, so it must survive packing.
      { color: '#445566', polylines: [], curves: undefined } as unknown as ColoredPath,
      { color: '#778899', polylines: [{ points: [], closed: false }] },
    ]);
  });

  it('declines what it cannot reproduce exactly, so the paths are posted as before', () => {
    const point = { x: 0, y: 0 };
    const shared = { points: [point], closed: false };
    class Point {
      constructor(
        readonly x: number,
        readonly y: number,
      ) {}
    }
    const cases: unknown[] = [
      [{ color: '#000000', polylines: [{ points: [{ x: 0, y: 0, z: 1 }], closed: false }] }],
      [{ color: '#000000', polylines: [{ points: [{ y: 0, x: 0 }], closed: false }] }],
      [{ color: '#000000', polylines: [{ points: [new Point(0, 0)], closed: false }] }],
      [{ color: '#000000', polylines: [{ points: [{ x: '0', y: 0 }], closed: false }] }],
      [{ color: '#000000', polylines: [{ points: [point], closed: 1 }] }],
      [{ color: '#000000', polylines: [{ points: [point], closed: false, tag: 'x' }] }],
      [{ color: '#000000', polylines: [shared, shared] }],
      [{ color: '#000000', polylines: [], curves: null }],
      [
        {
          color: '#000000',
          polylines: [],
          curves: [{ start: point, segments: [{ kind: 'quad', to: point }], closed: false }],
        },
      ],
    ];
    for (const paths of cases) expect(packTracePaths(paths as ColoredPath[])).toBeNull();
  });

  it('gives a cooperative runner checkpoints on a dense result and rebuilds the same paths', () => {
    const points = Array.from({ length: 40_000 }, (_, index) => ({ x: index, y: index / 3 }));
    const paths: ColoredPath[] = [
      { color: '#000000', polylines: [{ points: points.slice(0, 20_000), closed: false }] },
      { color: '#ff0000', polylines: [{ points: points.slice(20_000), closed: true }] },
    ];
    const packed = packTracePaths(paths)!;
    expect(packedTracePathsTransfer(packed)).toEqual([
      packed.coords.buffer,
      packed.structure.buffer,
      packed.numbers.buffer,
    ]);
    const steps = unpackTracePathsSteps(structuredClone(packed));
    let checkpoints = 0;
    let step = steps.next(true);
    while (step.done !== true) {
      checkpoints += 1;
      step = steps.next(true);
    }
    // One start-up yield, then at least one per 8,192 rebuilt vertices.
    expect(checkpoints).toBeGreaterThan(1);
    expect(graphSignature(step.value)).toEqual(graphSignature(structuredClone(paths)));
  });
});
