// Commit-level pin for the CNC trace fairing pass (chatter audit 2026-07-25):
// a CNC vector trace must commit machinable geometry — no sub-minimum G1
// segments, no 15-25deg heading-jitter train — while a laser commit passes the
// tracer's output through untouched. The dense jittery ring below reproduces
// the measured chatter class (audit: ~0.6px segments, p95 turn ~20deg).

import { describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('./trace-commit-result', () => ({
  resolveTraceCommitResult: vi.fn(),
}));

import {
  applyTransform,
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  LASER_MACHINE_CONFIG,
  polylineToCurveSubpath,
  type ColoredPath,
  type Layer,
  type MachineConfig,
  type Polyline,
  type Project,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { maximumPointDistanceToPolyline } from '../../__fixtures__/polyline-distance';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileCncJob } from '../../core/cnc';
import { positionTraceOverRasterSource } from '../state/trace-placement';
import { commit } from './ImportImageDialog';
import { TRACE_PRESETS } from '../../core/trace';
import type { TraceOptions } from '../../core/trace';
import { resolveTraceCommitResult } from './trace-commit-result';

const SEED_PX = 500;
const SEED_MM = 50; // 0.1 mm/px — the app's 254-DPI import default
const RING_R_PX = 200;
const RING_VERTS = 500;
const JITTER_AMPLITUDE_PX = 0.45;
const MIN_SEGMENT_MM = 0.4;
const MAX_DEVIATION_MM = 0.05;
const MM_PER_PX = SEED_MM / SEED_PX;
const MIN_SEGMENT_TOLERANCE = 0.95;
const FLOAT_TOLERANCE_MM = 1e-6;
const COMPILED_LENGTH_PRECISION = 8;
const TRACE_COLOR = '#000000';
const TRANSFORM_CASES: ReadonlyArray<{
  readonly name: string;
  readonly scaleX: number;
  readonly scaleY: number;
}> = [
  { name: '0.1x uniform', scaleX: 0.1, scaleY: 0.1 },
  { name: '1x uniform', scaleX: 1, scaleY: 1 },
  { name: '10x uniform', scaleX: 10, scaleY: 10 },
  { name: 'anisotropic', scaleX: 0.1, scaleY: 0.2 },
];

function seedRaster(scaleX = 1, scaleY = 1): RasterImage {
  return {
    kind: 'raster-image',
    id: 'src-1',
    source: 'ring.png',
    dataUrl: 'data:image/png;base64,AAA',
    pixelWidth: SEED_PX,
    pixelHeight: SEED_PX,
    bounds: { minX: 0, minY: 0, maxX: SEED_MM, maxY: SEED_MM },
    transform: { ...IDENTITY_TRANSFORM, scaleX, scaleY },
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

// Deterministic jittered circle in trace-pixel space — the audit's measured
// chatter geometry: ~2.5px chords with +-0.45px radial noise.
function jitteredRing(): Polyline {
  const points = [];
  for (let i = 0; i < RING_VERTS; i += 1) {
    const theta = (i / RING_VERTS) * 2 * Math.PI;
    const noise = Math.sin(i * 12.9898) * 43758.5453;
    const r = RING_R_PX + (noise - Math.floor(noise) - 0.5) * 2 * JITTER_AMPLITUDE_PX;
    points.push({ x: 250 + r * Math.cos(theta), y: 250 + r * Math.sin(theta) });
  }
  const first = points[0];
  if (first === undefined) throw new Error('expected a nonempty jittered ring');
  points.push({ ...first });
  return { points, closed: true };
}

function mockTraceResult(): ColoredPath[] {
  const polyline = jitteredRing();
  const paths: ColoredPath[] = [
    {
      color: TRACE_COLOR,
      polylines: [polyline],
      curves: [polylineToCurveSubpath(polyline)],
    },
  ];
  vi.mocked(resolveTraceCommitResult).mockResolvedValue({
    paths,
    bounds: { minX: 49, minY: 49, maxX: 451, maxY: 451 },
    width: SEED_PX,
    height: SEED_PX,
  });
  return paths;
}

type CommitContext = Parameters<typeof commit>[1];
type TestCommitContext = CommitContext & {
  readonly traceExistingImage: Mock<CommitContext['traceExistingImage']>;
  readonly commitRasterizedTrace: Mock<CommitContext['commitRasterizedTrace']>;
  readonly pushToast: Mock<CommitContext['pushToast']>;
  readonly close: Mock<CommitContext['close']>;
  readonly setBusy: Mock<CommitContext['setBusy']>;
};

function ctxWith(machine: MachineConfig, source = seedRaster()): TestCommitContext {
  const base = createProject();
  const project: Project = {
    ...base,
    machine,
    scene: { ...base.scene, objects: [source] },
  };
  return {
    traceExistingImage: vi.fn<CommitContext['traceExistingImage']>(),
    commitRasterizedTrace: vi.fn<CommitContext['commitRasterizedTrace']>(),
    pushToast: vi.fn<CommitContext['pushToast']>(),
    close: vi.fn<CommitContext['close']>(),
    setBusy: vi.fn<CommitContext['setBusy']>(),
    getCurrentProject: () => project,
  };
}

function commitArgs(seed: RasterImage): Parameters<typeof commit>[0] {
  const options: TraceOptions | undefined = TRACE_PRESETS['Smooth'];
  if (options === undefined) throw new Error('expected the Smooth trace preset');
  return {
    file: new File(['x'], 'ring.png', { type: 'image/png' }),
    options,
    seed,
    traceOutput: 'vector',
  };
}

function committedTrace(ctx: TestCommitContext): TracedImage {
  const traced = ctx.traceExistingImage.mock.calls[0]?.[1];
  if (traced === undefined) throw new Error('expected one committed trace');
  return traced;
}

function committedPolyline(ctx: TestCommitContext): Polyline {
  const traced = committedTrace(ctx);
  const polyline = traced.paths[0]?.polylines[0];
  if (polyline === undefined) throw new Error('expected one committed trace polyline');
  return polyline;
}

function segmentLengths(polyline: Polyline): number[] {
  const out: number[] = [];
  for (let i = 1; i < polyline.points.length; i += 1) {
    const a = polyline.points[i - 1];
    const b = polyline.points[i];
    if (a !== undefined && b !== undefined) {
      out.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
  }
  return out;
}

function positionedPolyline(source: RasterImage, traced: TracedImage): Polyline {
  const positioned = positionTraceOverRasterSource(source, traced);
  const local = positioned.paths[0]?.polylines[0];
  if (local === undefined) throw new Error('expected one committed trace polyline');
  return {
    closed: local.closed,
    points: local.points.map((point) => applyTransform(point, positioned.transform)),
  };
}

function compiledContourLengths(source: RasterImage, traced: TracedImage): number[] {
  const positioned = positionTraceOverRasterSource(source, traced);
  const layer: Layer = {
    ...createLayer({ id: 'cnc-trace', color: TRACE_COLOR }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'engrave',
      tabsEnabled: false,
    },
  };
  const group = compileCncJob(
    { objects: [positioned], layers: [layer] },
    DEFAULT_DEVICE_PROFILE,
    DEFAULT_CNC_MACHINE_CONFIG,
  ).groups[0];
  if (group?.kind !== 'cnc') throw new Error('expected one compiled CNC group');
  const pass = group.passes.find((candidate) => candidate.kind === 'contour');
  if (pass?.kind !== 'contour') throw new Error('expected one compiled contour pass');
  return segmentLengths({ closed: pass.closed, points: pass.polyline });
}

function turnAnglesDeg(polyline: Polyline): number[] {
  const out: number[] = [];
  const pts = polyline.points;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    if (a === undefined || b === undefined || c === undefined) continue;
    const inLen = Math.hypot(b.x - a.x, b.y - a.y);
    const outLen = Math.hypot(c.x - b.x, c.y - b.y);
    if (inLen < 1e-9 || outLen < 1e-9) continue;
    const dot = ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (inLen * outLen);
    out.push((Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI);
  }
  return out;
}

describe('CNC trace commit fairs the toolpath (chatter audit)', () => {
  it.each(TRANSFORM_CASES)(
    'enforces the physical chord floor through $name placement and compilation',
    async ({ scaleX, scaleY }) => {
      const rawPaths = mockTraceResult();
      const seed = seedRaster();
      const liveSource = seedRaster(scaleX, scaleY);
      const ctx = ctxWith(DEFAULT_CNC_MACHINE_CONFIG, liveSource);

      await commit(commitArgs(seed), ctx);

      const traced = committedTrace(ctx);
      const committedPointCount = traced.paths[0]?.polylines[0]?.points.length;
      if (committedPointCount === undefined) throw new Error('expected committed trace points');
      expect(committedPointCount).toBeLessThanOrEqual(RING_VERTS + 1);
      const minimumPhysicalChord = MIN_SEGMENT_MM * MIN_SEGMENT_TOLERANCE;
      const positioned = positionedPolyline(liveSource, traced);
      const positionedLengths = segmentLengths(positioned);
      const compiledLengths = compiledContourLengths(liveSource, traced);
      const rawPolyline = rawPaths[0]?.polylines[0];
      if (rawPolyline === undefined) throw new Error('expected raw trace geometry');
      const placement = positionTraceOverRasterSource(liveSource, traced).transform;
      const rawWorldPoints = rawPolyline.points.map((point) => applyTransform(point, placement));
      expect(maximumPointDistanceToPolyline(positioned.points, rawWorldPoints)).toBeLessThanOrEqual(
        MAX_DEVIATION_MM + FLOAT_TOLERANCE_MM,
      );
      expect(Math.min(...positionedLengths.slice(0, -1))).toBeGreaterThanOrEqual(
        minimumPhysicalChord,
      );
      expect(Math.min(...compiledLengths.slice(0, -1))).toBeGreaterThanOrEqual(
        minimumPhysicalChord,
      );
      expect(compiledLengths).toHaveLength(positionedLengths.length);
      for (const [index, positionedLength] of positionedLengths.entries()) {
        expect(compiledLengths[index]).toBeCloseTo(positionedLength, COMPILED_LENGTH_PRECISION);
      }
    },
  );

  it('commits machinable geometry on CNC: min segment and even headings', async () => {
    mockTraceResult();
    const ctx = ctxWith(DEFAULT_CNC_MACHINE_CONFIG);
    await commit(commitArgs(seedRaster()), ctx);
    expect(ctx.traceExistingImage).toHaveBeenCalledTimes(1);
    const polyline = committedPolyline(ctx);
    const minSegPx = MIN_SEGMENT_MM / MM_PER_PX;
    const segs = segmentLengths(polyline);
    // Closing segment may be shorter; every other chord respects the floor.
    const interior = segs.slice(0, -1);
    expect(Math.min(...interior)).toBeGreaterThanOrEqual(minSegPx * 0.95);
    const turns = turnAnglesDeg(polyline).sort((a, b) => a - b);
    const p95 = turns[Math.floor(turns.length * 0.95)] ?? 0;
    expect(p95).toBeLessThanOrEqual(10);
    // Fidelity: faired vertices stay within jitter + smoothing budget of the
    // ideal r=200 circle.
    for (const p of polyline.points) {
      const r = Math.hypot(p.x - 250, p.y - 250);
      expect(Math.abs(r - RING_R_PX)).toBeLessThanOrEqual(1.2);
    }
    // Ring invariant (ADR-100 third amendment): explicit return to start.
    const first = polyline.points[0];
    const last = polyline.points.at(-1);
    if (first === undefined || last === undefined) throw new Error('expected a nonempty ring');
    expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeLessThanOrEqual(1e-6);
    expect(polyline.closed).toBe(true);
  });

  it('rebuilds curves from the faired polylines so the CNC compiler cuts them', async () => {
    mockTraceResult();
    const ctx = ctxWith(DEFAULT_CNC_MACHINE_CONFIG);
    await commit(commitArgs(seedRaster()), ctx);
    const traced = committedTrace(ctx);
    const polyline = traced.paths[0]?.polylines[0];
    if (polyline === undefined) throw new Error('expected one committed polyline');
    const curve = traced.paths[0]?.curves?.[0];
    expect(curve).toBeDefined();
    // collect-cnc-contours flattens curves, not polylines — stale curves would
    // silently feed the machine the unfaired geometry.
    expect(curve?.segments.length).toBe(polyline.points.length - 1);
    expect(curve?.segments.every((s) => s.kind === 'line')).toBe(true);
  });

  it('welds fragmented centerline chains on CNC so cut count drops', async () => {
    // A drawn circle whose trace fragmented into 4 arc pieces with 0.4 mm
    // gaps (4px at this scale) — the audit's Centerline pecking class: every
    // fragment is a retract->reposition->plunge cycle on CNC. The weld must
    // join them and close the ring; nothing may be deleted.
    const arcs: Polyline[] = [];
    for (let k = 0; k < 4; k += 1) {
      const points = [];
      const start = (k * Math.PI) / 2 + 0.01;
      const end = ((k + 1) * Math.PI) / 2 - 0.01;
      for (let i = 0; i <= 40; i += 1) {
        const theta = start + ((end - start) * i) / 40;
        points.push({ x: 250 + RING_R_PX * Math.cos(theta), y: 250 + RING_R_PX * Math.sin(theta) });
      }
      arcs.push({ points, closed: false });
    }
    vi.mocked(resolveTraceCommitResult).mockResolvedValue({
      paths: [{ color: '#000000', polylines: arcs }],
      bounds: { minX: 49, minY: 49, maxX: 451, maxY: 451 },
      width: SEED_PX,
      height: SEED_PX,
    });
    const ctx = ctxWith(DEFAULT_CNC_MACHINE_CONFIG);
    await commit(commitArgs(seedRaster()), ctx);
    const traced = committedTrace(ctx);
    const polylines = traced.paths[0]?.polylines ?? [];
    // 4 pecks become 1 closed cut.
    expect(polylines.length).toBe(1);
    expect(polylines[0]?.closed).toBe(true);
    const pts = polylines[0]?.points ?? [];
    const first = pts[0];
    const last = pts.at(-1);
    if (first === undefined || last === undefined) throw new Error('expected a welded ring');
    expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeLessThanOrEqual(1e-6);
    // Fidelity: still the same circle.
    for (const p of pts) {
      expect(Math.abs(Math.hypot(p.x - 250, p.y - 250) - RING_R_PX)).toBeLessThanOrEqual(1.2);
    }
  });

  it('keeps dash gaps and standalone dots un-welded on CNC', async () => {
    // Two dashes 1.5 mm apart (drawn content) plus a far-away short tick:
    // the weld gap is crack-scale, not dash-scale — nothing joins, nothing
    // is deleted.
    const dash = (x0: number): Polyline => ({
      points: Array.from({ length: 21 }, (_, i) => ({ x: x0 + i, y: 100 })),
      closed: false,
    });
    vi.mocked(resolveTraceCommitResult).mockResolvedValue({
      paths: [{ color: '#000000', polylines: [dash(100), dash(135), dash(400)] }],
      bounds: { minX: 49, minY: 49, maxX: 451, maxY: 451 },
      width: SEED_PX,
      height: SEED_PX,
    });
    const ctx = ctxWith(DEFAULT_CNC_MACHINE_CONFIG);
    await commit(commitArgs(seedRaster()), ctx);
    const traced = committedTrace(ctx);
    expect(traced.paths[0]?.polylines.length).toBe(3);
  });

  it('passes laser commits through untouched', async () => {
    const rawPaths = mockTraceResult();
    const ctx = ctxWith(LASER_MACHINE_CONFIG);
    await commit({ ...commitArgs(seedRaster()), traceFillStyle: 'scanline' }, ctx);

    expect(committedTrace(ctx).paths).toEqual(rawPaths);
  });
});
