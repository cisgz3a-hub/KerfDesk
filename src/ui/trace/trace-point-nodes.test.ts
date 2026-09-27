import { describe, expect, it, vi } from 'vitest';
import type { ColoredPath, CurveSubpath } from '../../core/scene';
import { traceImageToContourColoredPaths } from '../../core/trace/contour-trace';
import type { RawImageData, TraceOptions } from '../../core/trace/trace-image';
import { TRACE_PRESETS } from '../../core/trace/trace-presets';
import { traceNodeCount, traceNodes, TRACE_NODE_KINDS } from './trace-point-nodes';
import { paintTracePoints, type TracePointsWindow } from './trace-points-canvas';

const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;

function context(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 1000;
  const result = canvas.getContext('2d');
  if (result === null) throw new Error('Missing canvas fixture');
  for (const method of ['arc', 'rect', 'setTransform', 'beginPath'] as const) {
    Object.defineProperty(result, method, { value: () => undefined, configurable: true });
  }
  return result;
}

/** A zoomed window over the whole trace, so no two nodes share a density cell. */
function zoomedWindow(width: number, height: number, scale: number): TracePointsWindow {
  return {
    left: 0,
    top: 0,
    width: width * scale,
    height: height * scale,
    scaleX: scale,
    scaleY: scale,
  };
}

function paintedMarkers(paths: ReadonlyArray<ColoredPath>, window: TracePointsWindow) {
  const ctx = context();
  const arc = vi.spyOn(ctx, 'arc');
  const rect = vi.spyOn(ctx, 'rect');
  const drawn = paintTracePoints(ctx, paths, window, 1, 'purple');
  return { drawn, round: arc.mock.calls.length, square: rect.mock.calls.length };
}

function kindsOf(paths: ReadonlyArray<ColoredPath>): string[] {
  return [...traceNodes(paths).kinds].map((code) => TRACE_NODE_KINDS[code] ?? 'unknown');
}

function curvePath(...curves: CurveSubpath[]): ColoredPath[] {
  return [{ color: '#000000', polylines: [], curves }];
}

/** Antialiased five-lobed blob: a curve-heavy source whose measured loop
 *  takes the fitted-cubic tail. */
function blob(size: number): RawImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  const centre = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let ink = 0;
      for (let sy = 0; sy < 4; sy += 1) {
        for (let sx = 0; sx < 4; sx += 1) {
          const px = x + (sx + 0.5) / 4 - centre;
          const py = y + (sy + 0.5) / 4 - centre;
          const angle = Math.atan2(py, px);
          const radius =
            size * 0.36 * (1 + 0.18 * Math.sin(5 * angle) + 0.06 * Math.cos(3 * angle));
          if (Math.hypot(px, py) <= radius) ink += 1;
        }
      }
      const value = Math.round(255 * (1 - ink / 16));
      const base = (y * size + x) * 4;
      data.set([value, value, value, 255], base);
    }
  }
  return { width: size, height: size, data };
}

describe('trace preview nodes', () => {
  it('paints fewer nodes as Optimize rises, although the polyline samples do not fall', () => {
    const size = 160;
    const image = blob(size);
    const trace = (optimize: number) =>
      traceImageToContourColoredPaths(image, { ...LINE_ART, optimize });
    const low = trace(0);
    const high = trace(2);
    expect(
      low.every((path) => path.curves?.some((c) => c.segments.some((s) => s.kind === 'cubic'))),
    ).toBe(true);
    const samples = (paths: ColoredPath[]) =>
      paths.flatMap((path) => path.polylines).reduce((total, p) => total + p.points.length, 0);
    const window = zoomedWindow(size, size, 8);
    const lowPaint = paintedMarkers(low, window);
    const highPaint = paintedMarkers(high, window);
    expect(lowPaint.drawn).toBe(traceNodeCount(low));
    expect(highPaint.drawn).toBe(traceNodeCount(high));
    expect(highPaint.drawn).toBeLessThan(lowPaint.drawn);
    // The compatibility view is a dense sampling, not the editable nodes.
    expect(samples(high)).toBeGreaterThanOrEqual(samples(low));
    expect(lowPaint.drawn).toBeLessThan(samples(low) / 4);
    // A smooth blob fitted with G1 cubics has smooth (round) nodes only.
    expect(highPaint.square).toBe(0);
    expect(highPaint.round).toBe(highPaint.drawn);
  });

  it('marks corner joints square and smooth G1 joints round', () => {
    const stadium: CurveSubpath = {
      start: { x: 20, y: 0 },
      closed: true,
      segments: [
        { kind: 'line', to: { x: 80, y: 0 } },
        {
          kind: 'cubic',
          control1: { x: 110, y: 0 },
          control2: { x: 110, y: 40 },
          to: { x: 80, y: 40 },
        },
        { kind: 'line', to: { x: 20, y: 40 } },
        {
          kind: 'cubic',
          control1: { x: -10, y: 40 },
          control2: { x: -10, y: 0 },
          to: { x: 20, y: 0 },
        },
      ],
    };
    const triangle: CurveSubpath = {
      start: { x: 0, y: 60 },
      closed: true,
      segments: [
        { kind: 'line', to: { x: 40, y: 60 } },
        { kind: 'line', to: { x: 20, y: 90 } },
      ],
    };
    const openWave: CurveSubpath = {
      start: { x: 0, y: 120 },
      closed: false,
      segments: [
        {
          kind: 'cubic',
          control1: { x: 10, y: 100 },
          control2: { x: 20, y: 100 },
          to: { x: 30, y: 120 },
        },
        {
          kind: 'cubic',
          control1: { x: 40, y: 140 },
          control2: { x: 50, y: 140 },
          to: { x: 60, y: 120 },
        },
        {
          kind: 'cubic',
          control1: { x: 60, y: 100 },
          control2: { x: 70, y: 100 },
          to: { x: 90, y: 120 },
        },
      ],
    };
    const paths = curvePath(stadium, triangle, openWave);
    // Closed stadium: the closing point repeats the start, so 4 nodes, all G1.
    // Triangle closes with an implicit edge: 3 line corners. Open wave: ends
    // are corners, the G1 joint is smooth, the cusp at (60,120) is a corner.
    expect(kindsOf(paths)).toEqual([
      ...['smooth', 'smooth', 'smooth', 'smooth'],
      ...['corner', 'corner', 'corner'],
      ...['corner', 'smooth', 'corner', 'corner'],
    ]);
    expect(paintedMarkers(paths, zoomedWindow(120, 150, 8))).toEqual({
      drawn: 11,
      round: 5,
      square: 6,
    });
  });

  it('lets a corner win a shared density cell over a round marker that comes first', () => {
    // One smooth G1 joint at (10,0) and, in a later path, a square corner a
    // fraction of a pixel away: at fit zoom they share one 2px cell.
    const smoothFirst: CurveSubpath = {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [
        {
          kind: 'cubic',
          control1: { x: 3, y: 0 },
          control2: { x: 7, y: 0 },
          to: { x: 10, y: 0 },
        },
        {
          kind: 'cubic',
          control1: { x: 13, y: 0 },
          control2: { x: 17, y: 0 },
          to: { x: 30, y: 0 },
        },
      ],
    };
    const cornerLater: CurveSubpath = {
      start: { x: 10.2, y: 0.2 },
      closed: false,
      segments: [{ kind: 'line', to: { x: 10.2, y: 20 } }],
    };
    const paths = curvePath(smoothFirst, cornerLater);
    expect(kindsOf(paths)).toEqual(['corner', 'smooth', 'corner', 'corner', 'corner']);
    const fit: TracePointsWindow = {
      left: 0,
      top: 0,
      width: 40,
      height: 30,
      scaleX: 1,
      scaleY: 1,
    };
    // The open ends at (0,0), (30,0), (10.2,20) are squares; the (10,0) cell
    // shows the corner at (10.2,0.2), not the smooth joint that came first.
    expect(paintedMarkers(paths, fit)).toEqual({ drawn: 4, round: 0, square: 4 });
    // Zoomed in far enough to separate them, both markers show.
    expect(paintedMarkers(paths, zoomedWindow(40, 30, 16))).toEqual({
      drawn: 5,
      round: 1,
      square: 4,
    });
  });

  it('reads arc tangents: a circle of two arcs is smooth, an arc meeting a line square-on is a corner', () => {
    const circle: CurveSubpath = {
      start: { x: 0, y: 50 },
      closed: true,
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: 50,
          radiusY: 50,
          rotationDeg: 0,
          largeArc: false,
          sweep: true,
          to: { x: 100, y: 50 },
        },
        {
          kind: 'elliptical-arc',
          radiusX: 50,
          radiusY: 50,
          rotationDeg: 0,
          largeArc: false,
          sweep: true,
          to: { x: 0, y: 50 },
        },
      ],
    };
    const halfDisc: CurveSubpath = {
      start: { x: 0, y: 200 },
      closed: true,
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: 50,
          radiusY: 50,
          rotationDeg: 0,
          largeArc: false,
          sweep: true,
          to: { x: 100, y: 200 },
        },
        { kind: 'line', to: { x: 0, y: 200 } },
      ],
    };
    const tangentLine: CurveSubpath = {
      start: { x: 0, y: 300 },
      closed: false,
      segments: [
        { kind: 'line', to: { x: 50, y: 300 } },
        // Quarter ellipse leaving along +x: its start tangent continues the line.
        {
          kind: 'elliptical-arc',
          radiusX: 60,
          radiusY: 30,
          rotationDeg: 0,
          largeArc: false,
          sweep: true,
          to: { x: 110, y: 330 },
        },
      ],
    };
    expect(kindsOf(curvePath(circle, halfDisc, tangentLine))).toEqual([
      'smooth',
      'smooth',
      'corner',
      'corner',
      'corner',
      'smooth',
      'corner',
    ]);
  });

  it('still shows the polyline points of a path without curves, as round samples', () => {
    const paths: ColoredPath[] = [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 1, y: 1 },
              { x: 9, y: 1 },
              { x: 9, y: 9 },
            ],
          },
          // An explicitly repeated closing point is one node, not two.
          {
            closed: true,
            points: [
              { x: 20, y: 20 },
              { x: 30, y: 20 },
              { x: 25, y: 28 },
              { x: 20, y: 20 },
            ],
          },
        ],
      },
    ];
    expect(traceNodeCount(paths)).toBe(6);
    expect(kindsOf(paths)).toEqual(Array(6).fill('sample'));
    expect(paintedMarkers(paths, zoomedWindow(40, 40, 8))).toEqual({
      drawn: 6,
      round: 6,
      square: 0,
    });
  });

  it('keeps a large trace cheap: nodes build once and a fit-view repaint stays bounded', () => {
    const subpaths = 2000;
    const segments = 100;
    const curves: CurveSubpath[] = Array.from({ length: subpaths }, (_, ring) => {
      const cx = 50 + (ring % 50) * 40;
      const cy = 50 + Math.floor(ring / 50) * 40;
      return {
        start: { x: cx + 15, y: cy },
        closed: true,
        segments: Array.from({ length: segments }, (_, index) => {
          const a0 = (2 * Math.PI * index) / segments;
          const a1 = (2 * Math.PI * (index + 1)) / segments;
          const k = (4 / 3) * Math.tan((a1 - a0) / 4) * 15;
          return {
            kind: 'cubic' as const,
            control1: {
              x: cx + 15 * Math.cos(a0) - k * Math.sin(a0),
              y: cy + 15 * Math.sin(a0) + k * Math.cos(a0),
            },
            control2: {
              x: cx + 15 * Math.cos(a1) + k * Math.sin(a1),
              y: cy + 15 * Math.sin(a1) - k * Math.cos(a1),
            },
            to: { x: cx + 15 * Math.cos(a1), y: cy + 15 * Math.sin(a1) },
          };
        }),
      };
    });
    const paths = curvePath(...curves);
    const started = performance.now();
    const nodes = traceNodes(paths);
    expect(nodes.count).toBe(subpaths * segments);
    const fit: TracePointsWindow = {
      left: 0,
      top: 0,
      width: 1000,
      height: 1000,
      scaleX: 0.5,
      scaleY: 0.5,
    };
    const ctx = context();
    const drawn = paintTracePoints(ctx, paths, fit, 1, 'purple');
    const firstPaint = performance.now() - started;
    // Density thinning: at most one marker per 2px cell of the window.
    expect(drawn).toBeLessThanOrEqual(502 * 502);
    expect(drawn).toBeLessThan(nodes.count);
    const repaintStarted = performance.now();
    paintTracePoints(ctx, paths, { ...fit, left: 200, top: 100 }, 1, 'purple');
    const repaint = performance.now() - repaintStarted;
    // The flat node list is cached per result; repaints never rebuild it.
    expect(traceNodes(paths)).toBe(nodes);
    // Generous CI bounds: the build is linear and a repaint walks a typed array.
    expect(firstPaint).toBeLessThan(2000);
    expect(repaint).toBeLessThan(1000);
  });
});
