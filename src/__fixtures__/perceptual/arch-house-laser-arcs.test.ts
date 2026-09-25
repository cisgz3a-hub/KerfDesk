// Native G2/G3 arcs for traced laser output (ADR-407). Traces the Arch House
// logo with Line Art, commits it 100 mm wide the way the trace dialog does,
// and compiles it for a GRBL 1.1 laser. Pins: far fewer burn moves than the G1
// program for the same trace; what GRBL executes (each arc as mc_arc's chords
// at the stock $12) stays within the 0.025 mm machine curve tolerance of the
// canonical curves; every corner the tracer found stays a move end at its
// exact position; the app's own parser reads the program back; the job bounds
// hold every executed point; a machine without arcs gets the G1 program.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { controllerArcPoints } from '../../core/gcode-view/controller-arc-points';
import { arcSweep } from '../../core/geometry/arc-fit';
import {
  compileJob,
  computeJobBounds,
  type CutGroup,
  type CutSegment,
  type Job,
  type JobBounds,
} from '../../core/job';
import { validCutArcMoves } from '../../core/job/cut-arc-moves';
import { grblStrategy } from '../../core/output';
import {
  applyTransform,
  createLayer,
  flattenCurveSubpath,
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type CurveSubpath,
  type TracedImage,
  type Vec2,
} from '../../core/scene';
import { toMachineCoords } from '../../core/devices';
import { boundsFromColoredPaths, TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import { parseGcodeProgram } from '../../io/gcode/parse-gcode-program';
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
const ORACLE_ERROR_MM = 0.001;
const GRBL_ARC_TOLERANCE_MM = 0.002;
const ARCS: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grbl-v1.1' };
// Measured 1,508 burn moves against 2,946 for the G1 program (ratio 0.51).
const MAX_MOVE_RATIO = 0.65;

function burnMoves(gcode: string): number {
  return gcode.split('\n').filter((line) => /^G[123] .*X/.test(line)).length;
}

function cutGroup(job: Job): CutGroup {
  const group = job.groups[0];
  if (group?.kind !== 'cut') throw new Error('expected one cut group');
  return group;
}

// What GRBL runs for a segment: its lines, and each arc as mc_arc's chords.
function executed(start: Vec2, group: CutGroup, index: number): Vec2[] {
  const segment = group.segments[index];
  const moves = segment === undefined ? null : validCutArcMoves(segment);
  if (segment === undefined || moves === null) return [...(segment?.polyline ?? [])];
  const points = [start];
  let from = start;
  for (const move of moves) {
    if (move.kind === 'arc') {
      const radius = Math.hypot(from.x - move.center.x, from.y - move.center.y);
      const startAngle = Math.atan2(from.y - move.center.y, from.x - move.center.x);
      const sweep = arcSweep(from, move.to, move.center, move.clockwise);
      const signed = move.clockwise ? -sweep : sweep;
      const chords = controllerArcPoints(
        move.center,
        radius,
        startAngle,
        signed,
        GRBL_ARC_TOLERANCE_MM,
      );
      points.push(...chords.slice(1, -1));
    }
    points.push(move.to);
    from = move.to;
  }
  return points;
}

function canonicalInMachine(curve: CurveSubpath, traced: TracedImage): Vec2[] {
  const scale = Math.abs(traced.transform.scaleX);
  const flat = flattenCurveSubpath(curve, { toleranceMm: 0.0002 / scale });
  if (flat.kind !== 'ok') throw new Error('flatten failed');
  const points = flat.polyline.points.map((point) =>
    toMachineCoords(applyTransform(point, traced.transform), ARCS),
  );
  return curve.closed ? [...points, points[0] as Vec2] : points;
}

async function tracedArchHouse(): Promise<TracedImage> {
  const image = decodePngFile(SOURCE_PATH);
  const preset = TRACE_PRESETS['Line Art'];
  if (preset === undefined) throw new Error('expected the Line Art preset');
  const paths = await traceImageToColoredPaths(image, preset);
  const scale = WIDTH_MM / image.width;
  const placement = { ...IDENTITY_TRANSFORM, x: 5, y: 5, scaleX: scale, scaleY: scale };
  const raw: TracedImage = {
    kind: 'traced-image',
    id: 'logo',
    source: 'arch-house-langebaan-source.png',
    traceSourceId: 'source',
    traceMode: 'filled-contours',
    tracePixelWidth: image.width,
    tracePixelHeight: image.height,
    bounds: boundsFromColoredPaths(paths),
    transform: placement,
    paths,
  };
  return conditionTracedImageForMachine(raw, placement, 'laser', {
    options: preset,
    traceOutput: 'vector',
  });
}

function parsedCutMm(gcode: string): number {
  const parsed = parseGcodeProgram(gcode);
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  return parsed.summary.cutMm;
}

function expectInside(points: ReadonlyArray<Vec2>, bounds: JobBounds): void {
  const outside = points.filter(
    (point) =>
      point.x < bounds.minX - 1e-9 ||
      point.x > bounds.maxX + 1e-9 ||
      point.y < bounds.minY - 1e-9 ||
      point.y > bounds.maxY + 1e-9,
  );
  expect(outside).toEqual([]);
}

// Every joint of a fitted ring turning 60 degrees or more is a move end at its
// exact mapped position.
function expectCornersKept(curve: CurveSubpath, segment: CutSegment, traced: TracedImage): void {
  const moves = validCutArcMoves(segment);
  if (moves === null) return;
  const ends = new Set(moves.map((move) => `${move.to.x},${move.to.y}`));
  for (const corner of sharpJoints(curve)) {
    const at = toMachineCoords(applyTransform(corner, traced.transform), ARCS);
    expect(ends.has(`${at.x},${at.y}`), `corner ${at.x}, ${at.y}`).toBe(true);
  }
}

describe('Arch House laser arcs (ADR-407)', () => {
  it(
    'burns with far fewer moves as G2/G3, within the tolerance as executed',
    { timeout: 240_000 },
    async () => {
      const traced = await tracedArchHouse();
      const scene = { objects: [traced], layers: [createLayer({ id: 'l', color: '#000000' })] };
      const off: DeviceProfile = { ...ARCS, laserArcMoves: 'off' };
      const job = compileJob(scene, ARCS);
      const gcode = grblStrategy.emit(job, ARCS);
      const lines = grblStrategy.emit(job, off);
      expect(gcode).toMatch(/^G[23] /m);
      expect(burnMoves(gcode)).toBeLessThanOrEqual(burnMoves(lines) * MAX_MOVE_RATIO);
      // No arc capability: the G1 program, byte for byte.
      const offJob = compileJob(scene, off);
      expect(grblStrategy.emit(offJob, off)).toBe(lines);
      expect(cutGroup(offJob).segments.every((segment) => segment.arcMoves === undefined)).toBe(
        true,
      );
      expect(parsedCutMm(gcode)).toBeCloseTo(parsedCutMm(lines), -1);

      const group = cutGroup(job);
      const curves = traced.paths.flatMap(
        (path) => path.curves ?? path.polylines.map((polyline) => polylineToCurveSubpath(polyline)),
      );
      expect(group.segments).toHaveLength(curves.length);
      const bounds = computeJobBounds(job);
      if (bounds === null) throw new Error('expected bounds');
      let deviation = 0;
      for (const [index, curve] of curves.entries()) {
        const segment = group.segments[index];
        const start = segment?.polyline[0];
        if (segment === undefined || start === undefined) throw new Error('missing segment');
        const run = executed(start, group, index);
        expectInside(run, bounds);
        const canonical = canonicalInMachine(curve, traced);
        deviation = Math.max(
          deviation,
          polylineDeviationBounds(run, canonical, ORACLE_ERROR_MM).upperBound,
        );
        expectCornersKept(curve, segment, traced);
      }
      // Arcs are checked before 3-decimal rounding, which moves an arc at most
      // 0.002 mm and is part of the 0.025 mm budget (arc-fit-limits.ts).
      expect(deviation).toBeLessThanOrEqual(TOLERANCE_MM - 0.002 + ORACLE_ERROR_MM);
    },
  );
});

function sharpJoints(curve: CurveSubpath): Vec2[] {
  const out: Vec2[] = [];
  let from = curve.start;
  const legs = curve.segments.map((segment) => {
    const start = from;
    from = segment.to;
    const leave = segment.kind === 'cubic' ? segment.control1 : segment.to;
    const back = segment.kind === 'cubic' ? segment.control2 : start;
    return {
      end: segment.to,
      out: Math.atan2(leave.y - start.y, leave.x - start.x),
      in: Math.atan2(segment.to.y - back.y, segment.to.x - back.x),
    };
  });
  for (let index = 0; index + 1 < legs.length; index += 1) {
    const a = legs[index];
    const b = legs[index + 1];
    if (a === undefined || b === undefined) continue;
    let turn = Math.abs(b.out - a.in) % (2 * Math.PI);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn >= Math.PI / 3) out.push(a.end);
  }
  return out;
}
