// Laser traces reach G-code as few, long moves (tracer audit Finding 5,
// ADR-391). Traces the Arch House logo with Line Art, commits it 100 mm wide
// to a laser project the way the trace dialog does, compiles it and emits
// GRBL. Before ADR-391 every 1.5 px sample became a G1 move: 26,997 moves
// averaging 0.077 mm. The pins: far fewer moves, every compiled path within
// the 0.025 mm machine curve tolerance of its traced outline, every corner
// the tracer found still a vertex at its exact position, and a scene that
// stores what the machine runs.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { parseGcodeWord, stripGcodeComment } from '../../core/invariants';
import { compileJob } from '../../core/job';
import { compilationPolylines } from '../../core/job/compilation-polylines';
import { grblStrategy } from '../../core/output';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type TracedImage,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { boundsFromColoredPaths, TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import { conditionTracedImageForMachine } from '../../ui/trace/trace-machine-conditioning';
import { polylineDeviationBounds } from '../polyline-deviation-bounds';
import { decodePngFile } from './png-decode';

const SOURCE_PATH = join(
  process.cwd(),
  'src',
  '__fixtures__',
  'perceptual',
  'assets',
  'arch-house-langebaan-source.png',
);
const WIDTH_MM = 100;
const TOLERANCE_MM = 0.025;
const ORACLE_ERROR_MM = 0.002;
const CORNER_DEG = 60;
// Kept corners are the tracer's own coordinates, so they match exactly.
const SAME_POINT = 1e-9;
// Measured 2,946 moves against 26,997 for the samples (ratio 0.11). The
// ceilings leave room for tracer changes that add or remove small shapes.
const MAX_MOVES = 6_000;
const MAX_MOVE_RATIO = 0.2;

type Corner = { readonly subpath: number; readonly point: Vec2 };
type ModalState = { rapid: boolean; power: number; armed: boolean };

// Every positioning G1 while the laser is armed at a positive power is one
// burn move, read back from the emitted program itself.
function burnMoveCount(gcode: string): number {
  const state: ModalState = { rapid: true, power: 0, armed: false };
  let moves = 0;
  for (const raw of gcode.split('\n')) {
    const line = stripGcodeComment(raw);
    applyModalWords(state, line);
    const moved = parseGcodeWord(line, 'X') !== null || parseGcodeWord(line, 'Y') !== null;
    if (moved && !state.rapid && state.armed && state.power > 0) moves += 1;
  }
  return moves;
}

function applyModalWords(state: ModalState, line: string): void {
  const m = parseGcodeWord(line, 'M');
  if (m === 3 || m === 4) state.armed = true;
  if (m === 5) state.armed = false;
  const g = parseGcodeWord(line, 'G');
  if (g === 0 || g === 1) state.rapid = g === 0;
  state.power = parseGcodeWord(line, 'S') ?? state.power;
}

function emittedMoves(traced: TracedImage): number {
  const layer = createLayer({ id: 'trace', color: '#000000' });
  const job = compileJob({ objects: [traced], layers: [layer] }, DEFAULT_DEVICE_PROFILE);
  return burnMoveCount(grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE));
}

function tracedAt(
  paths: ColoredPath[],
  grid: { readonly width: number; readonly height: number },
  placement: Transform,
): TracedImage {
  return {
    kind: 'traced-image',
    id: 'logo',
    source: 'arch-house-langebaan-source.png',
    traceSourceId: 'source',
    traceMode: 'filled-contours',
    tracePixelWidth: grid.width,
    tracePixelHeight: grid.height,
    bounds: boundsFromColoredPaths(paths),
    transform: placement,
    paths,
  };
}

function heading(from: Vec2, candidates: ReadonlyArray<Vec2>): number | null {
  const to = candidates.find(
    (point) => Math.hypot(point.x - from.x, point.y - from.y) > SAME_POINT,
  );
  return to === undefined ? null : Math.atan2(to.y - from.y, to.x - from.x);
}

function turnDeg(incoming: number, outgoing: number): number {
  const turn = Math.abs(outgoing - incoming) % (2 * Math.PI);
  return ((turn > Math.PI ? 2 * Math.PI - turn : turn) * 180) / Math.PI;
}

// The corners the tracer found: joints of a fitted ring where the tangent
// turns at least the corner angle, and vertices of a straight-segment subpath
// that turn that much between nonzero legs.
function tracerCorners(curve: CurveSubpath, subpath: number): Corner[] {
  let from = curve.start;
  const pieces = curve.segments.map((segment) => {
    const start = from;
    from = segment.to;
    const handles = segment.kind === 'cubic' ? [segment.control1, segment.control2] : [];
    return {
      end: segment.to,
      leave: heading(start, [...handles, segment.to]),
      back: heading(segment.to, [...[...handles].reverse(), start]),
    };
  });
  const corners: Corner[] = [];
  for (const [index, piece] of pieces.entries()) {
    const next = pieces[index + 1] ?? (curve.closed ? pieces[0] : undefined);
    if (next === undefined || next.leave === null || piece.back === null) continue;
    if (turnDeg(piece.back + Math.PI, next.leave) >= CORNER_DEG) {
      corners.push({ subpath, point: piece.end });
    }
  }
  return corners;
}

describe('Arch House laser trace moves (ADR-391)', () => {
  it(
    'reaches G-code as few long moves within the tolerance, corners kept',
    { timeout: 240_000 },
    async () => {
      const image = decodePngFile(SOURCE_PATH);
      const preset = TRACE_PRESETS['Line Art'];
      if (preset === undefined) throw new Error('expected the Line Art preset');
      const traced = await traceImageToColoredPaths(image, preset);
      const scale = WIDTH_MM / image.width;
      const placement = { ...IDENTITY_TRANSFORM, x: 5, y: 5, scaleX: scale, scaleY: scale };
      const raw = tracedAt(traced, image, placement);
      const committed = conditionTracedImageForMachine(raw, placement, 'laser', {
        options: preset,
        traceOutput: 'vector',
      });

      const samples = tracedAt(
        traced.map((path) => ({ ...path, curves: path.polylines.map(polylineToCurveSubpath) })),
        image,
        placement,
      );
      const moves = emittedMoves(committed);
      expect(moves).toBeLessThanOrEqual(MAX_MOVES);
      expect(moves).toBeLessThanOrEqual(emittedMoves(samples) * MAX_MOVE_RATIO);

      const source = traced.flatMap((path) => path.polylines);
      const compiled = committed.paths.flatMap((path) => compilationPolylines(path, placement));
      expect(compiled).toHaveLength(source.length);
      // The scene stores exactly what the machine runs at this placement.
      expect(committed.paths.flatMap((path) => path.polylines)).toEqual(compiled);
      const toMm = (points: ReadonlyArray<Vec2>): Vec2[] =>
        points.map((point) => ({ x: point.x * scale, y: point.y * scale }));
      let deviation = 0;
      for (const [index, polyline] of compiled.entries()) {
        const bounds = polylineDeviationBounds(
          toMm(polyline.points),
          toMm(source[index]?.points ?? []),
          ORACLE_ERROR_MM,
        );
        deviation = Math.max(deviation, bounds.upperBound);
      }
      expect(deviation).toBeLessThanOrEqual(TOLERANCE_MM + ORACLE_ERROR_MM);

      const curves = traced.flatMap((path) => path.curves ?? []);
      expect(curves).toHaveLength(source.length);
      const corners = curves.flatMap((curve, index) => tracerCorners(curve, index));
      expect(corners.length).toBeGreaterThan(100);
      for (const corner of corners) {
        const kept = compiled[corner.subpath]?.points.some(
          (point) => Math.hypot(point.x - corner.point.x, point.y - corner.point.y) <= SAME_POINT,
        );
        expect(kept, `corner at ${corner.point.x}, ${corner.point.y}`).toBe(true);
      }
    },
  );
});
