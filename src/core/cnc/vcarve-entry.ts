import type { CncContourPass, CncPass, CncPath3dPass } from '../job';
import {
  formatGcodeCoordinateMm,
  GCODE_COORDINATE_DECIMAL_PLACES,
} from '../gcode/coordinate-format';
import type { Polyline, Vec2 } from '../scene';

const COORD_EPSILON_MM = 1e-9;
const GCODE_COORDINATE_QUANTUM_MM = 10 ** -GCODE_COORDINATE_DECIMAL_PLACES;

export type VCarveRampEntryPlan =
  | {
      readonly ok: true;
      readonly passes: ReadonlyArray<CncPass>;
      readonly revolutions: number;
      readonly motionSegments: number;
    }
  | { readonly ok: false; readonly reason: string };

// Replace a ring's discrete same-XY depth ladder with a continuous spiral down
// that exact contour. The number of laps satisfies BOTH the operator's maximum
// angle and depth-per-pass. A final level lap restores the requested V-groove
// everywhere after the descending laps. There is deliberately no straight-
// plunge fallback inside this planner: callers decide how to report an error.
export function planVCarveRampEntry(
  polyline: Polyline,
  targetDepthMm: number,
  depthPerPassMm: number,
  rampAngleDeg: number,
): VCarveRampEntryPlan {
  const inputIssue = validateRampInputs(polyline, targetDepthMm, depthPerPassMm, rampAngleDeg);
  if (inputIssue !== null) return { ok: false, reason: inputIssue };
  const sourcePoints = withoutDuplicateClosure(polyline.points);
  const ring = ringAtEmitPrecision(entryRing(sourcePoints));
  const segmentLengths = ringSegmentLengths(ring);
  const translationSafeSegmentLengths = ringSegmentTranslationSafeLengths(ring);
  const perimeterMm = segmentLengths.reduce((sum, length) => sum + length, 0);
  if (ring.length < 4 || !Number.isFinite(perimeterMm) || !(perimeterMm > COORD_EPSILON_MM)) {
    return { ok: false, reason: 'V-carve ramp entry requires a non-degenerate closed contour.' };
  }

  const targetZMm = coordinateAtEmitPrecision(-targetDepthMm);
  const targetDepthQuanta = Math.round(Math.abs(targetZMm) / GCODE_COORDINATE_QUANTUM_MM);
  if (!Number.isSafeInteger(targetDepthQuanta)) return numericCountIssue();
  const depthPerPassQuanta = Math.min(
    targetDepthQuanta,
    Math.floor(depthPerPassMm / GCODE_COORDINATE_QUANTUM_MM + 1e-12),
  );
  const tangent = Math.tan((rampAngleDeg * Math.PI) / 180);
  const segmentCapacityQuanta = translationSafeSegmentLengths.map((lengthMm) =>
    Math.min(
      targetDepthQuanta,
      Math.floor((lengthMm * tangent) / GCODE_COORDINATE_QUANTUM_MM + 1e-12),
    ),
  );
  const angleCapacityPerLap = segmentCapacityQuanta.reduce((sum, capacity) => sum + capacity, 0);
  const descentCapacityPerLap = Math.min(depthPerPassQuanta, angleCapacityPerLap);
  if (targetDepthQuanta < 1 || descentCapacityPerLap < 1) {
    return {
      ok: false,
      reason:
        'The requested V-carve ramp cannot express a non-vertical descent at the ' +
        '0.001 mm G-code coordinate precision. Use a larger manufacturer-approved ramp angle, ' +
        'increase depth per pass, or enlarge/remove the microscopic detail.',
    };
  }
  const revolutions = Math.max(1, Math.ceil(targetDepthQuanta / descentCapacityPerLap));
  const ringSegments = ring.length - 1;
  const totalSegments = (revolutions + 1) * ringSegments;
  if (!Number.isSafeInteger(totalSegments)) return numericCountIssue();

  const ramp: CncPath3dPass = {
    kind: 'path3d',
    points: spiralPoints(ring, segmentCapacityQuanta, targetDepthQuanta, revolutions),
    closed: false,
    lateralFeed: 'plunge',
  };
  const cleanup: CncContourPass = {
    kind: 'contour',
    zMm: targetZMm,
    polyline: ring,
    closed: true,
  };
  return {
    ok: true,
    passes: [ramp, cleanup],
    revolutions,
    motionSegments: totalSegments,
  };
}

function ringAtEmitPrecision(ring: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const points: Vec2[] = [];
  for (const point of ring) {
    const emitted = {
      x: coordinateAtEmitPrecision(point.x),
      y: coordinateAtEmitPrecision(point.y),
    };
    const previous = points.at(-1);
    if (previous === undefined || !samePoint(previous, emitted)) points.push(emitted);
  }
  const first = points[0];
  const last = points.at(-1);
  if (first !== undefined && last !== undefined && !samePoint(first, last)) points.push(first);
  return points;
}

function validateRampInputs(
  polyline: Polyline,
  targetDepthMm: number,
  depthPerPassMm: number,
  rampAngleDeg: number,
): string | null {
  if (
    !positiveFinite(targetDepthMm) ||
    !positiveFinite(depthPerPassMm) ||
    !positiveFinite(rampAngleDeg)
  ) {
    return 'V-carve ramp angle, target depth, and depth per pass must be positive and finite.';
  }
  if (rampAngleDeg >= 90) {
    return 'V-carve ramp angle must be less than 90 degrees.';
  }
  if (!polyline.closed || withoutDuplicateClosure(polyline.points).length < 3) {
    return 'V-carve ramp entry requires a closed contour.';
  }
  return null;
}

function entryRing(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  if (points.length < 2) return points;
  let bestIndex = -1;
  let bestLengthMm = 0;
  let bestMidpoint: Vec2 | null = null;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (start === undefined || end === undefined) continue;
    const lengthMm = Math.hypot(end.x - start.x, end.y - start.y);
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    if (
      lengthMm > bestLengthMm + COORD_EPSILON_MM ||
      (Math.abs(lengthMm - bestLengthMm) <= COORD_EPSILON_MM &&
        lexicographicallyBefore(midpoint, bestMidpoint))
    ) {
      bestIndex = index;
      bestLengthMm = lengthMm;
      bestMidpoint = midpoint;
    }
  }
  if (bestIndex < 0 || bestMidpoint === null) return points;
  return [
    bestMidpoint,
    ...points.slice(bestIndex + 1),
    ...points.slice(0, bestIndex + 1),
    bestMidpoint,
  ];
}

function withoutDuplicateClosure(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points[points.length - 1];
  return first !== undefined && last !== undefined && samePoint(first, last)
    ? points.slice(0, -1)
    : points;
}

function ringSegmentLengths(ring: ReadonlyArray<Vec2>): ReadonlyArray<number> {
  const lengths: number[] = [];
  for (let index = 1; index < ring.length; index += 1) {
    const previous = ring[index - 1];
    const point = ring[index];
    lengths.push(
      previous === undefined || point === undefined
        ? 0
        : Math.hypot(point.x - previous.x, point.y - previous.y),
    );
  }
  return lengths;
}

// Job-origin placement adds one shared XY offset after CAM. In exact decimal
// arithmetic that preserves every segment vector, but JavaScript binary floats
// can put the two translated endpoints on opposite sides of a toFixed(3) tie.
// The emitted component can therefore be one 0.001 mm quantum shorter. Budget
// descent against that lower bound so the configured angle remains a true
// maximum after placement and final G-code formatting.
function ringSegmentTranslationSafeLengths(ring: ReadonlyArray<Vec2>): ReadonlyArray<number> {
  const lengths: number[] = [];
  for (let index = 1; index < ring.length; index += 1) {
    const previous = ring[index - 1];
    const point = ring[index];
    if (previous === undefined || point === undefined) {
      lengths.push(0);
      continue;
    }
    const dx = Math.max(0, Math.abs(point.x - previous.x) - GCODE_COORDINATE_QUANTUM_MM);
    const dy = Math.max(0, Math.abs(point.y - previous.y) - GCODE_COORDINATE_QUANTUM_MM);
    lengths.push(Math.hypot(dx, dy));
  }
  return lengths;
}

function spiralPoints(
  ring: ReadonlyArray<Vec2>,
  segmentCapacityQuanta: ReadonlyArray<number>,
  targetDepthQuanta: number,
  revolutions: number,
): CncPath3dPass['points'] {
  const first = ring[0] as Vec2;
  const points = [{ x: first.x, y: first.y, z: 0 }];
  const capacityPerLap = segmentCapacityQuanta.reduce((sum, capacity) => sum + capacity, 0);
  const totalCapacity = capacityPerLap * revolutions;
  let cumulativeCapacity = 0;
  let assignedDepthQuanta = 0;
  for (let revolution = 0; revolution < revolutions; revolution += 1) {
    for (let index = 1; index < ring.length; index += 1) {
      const point = ring[index];
      if (point === undefined) continue;
      cumulativeCapacity += segmentCapacityQuanta[index - 1] ?? 0;
      assignedDepthQuanta = Math.floor(
        (targetDepthQuanta * cumulativeCapacity) / totalCapacity + 1e-12,
      );
      points.push({
        x: point.x,
        y: point.y,
        z: coordinateAtEmitPrecision(-assignedDepthQuanta * GCODE_COORDINATE_QUANTUM_MM),
      });
    }
  }
  return points;
}

function coordinateAtEmitPrecision(value: number): number {
  return Number(formatGcodeCoordinateMm(value));
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= COORD_EPSILON_MM && Math.abs(a.y - b.y) <= COORD_EPSILON_MM;
}

function lexicographicallyBefore(candidate: Vec2, current: Vec2 | null): boolean {
  if (current === null) return true;
  if (candidate.x !== current.x) return candidate.x < current.x;
  return candidate.y < current.y;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function numericCountIssue(): VCarveRampEntryPlan {
  return {
    ok: false,
    reason:
      'The requested V-carve ramp cannot be represented as a safe JavaScript motion count. ' +
      'Use a larger manufacturer-approved ramp angle or enlarge/remove microscopic detail.',
  };
}
