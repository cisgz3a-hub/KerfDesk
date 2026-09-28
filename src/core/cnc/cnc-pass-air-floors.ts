// An air floor is retained only for an exactly repeated source path emitted
// by the same primitive. Identical coordinates stay identical under later
// placement and rounding. Raw collinearity or a small tolerance cannot prove
// this: points on opposite sides of an output grid boundary can diverge.
import { sampleCircularArcPoints } from '../geometry/circular-arc';
import type { CncPass } from '../job';
import type { Vec2 } from '../scene';
import { cncContourEmissionPrecision } from './cnc-contour-emission';
import { representedCncCoordinateMm } from './cnc-output-precision';

type Trace = {
  readonly kind: 'contour' | 'path3d' | 'arc';
  readonly points: ReadonlyArray<Vec2>;
  readonly highestZ: number;
  readonly clockwise?: boolean;
};

export function withPassAirFloors(passes: ReadonlyArray<CncPass>): ReadonlyArray<CncPass> {
  const cut: Trace[] = [];
  let changed = false;
  const out = passes.map((pass) => {
    const trace = traceOf(pass);
    const floored = trace === null ? pass : withFloor(pass, trace, cut);
    if (trace !== null) cut.push(trace);
    if (floored !== pass) changed = true;
    return floored;
  });
  return changed ? out : passes;
}

function withFloor(pass: CncPass, trace: Trace, cut: ReadonlyArray<Trace>): CncPass {
  if (pass.kind === 'helical-contour' || pass.airFloorZMm !== undefined) return pass;
  if (pass.kind === 'contour' && pass.stayDownEntry === true) return pass;
  if (pass.kind === 'path3d' && pass.stayDownLink === true) return pass;
  let floor = Number.POSITIVE_INFINITY;
  for (const earlier of cut) {
    if (earlier.highestZ < floor && repeats(earlier, trace)) floor = earlier.highestZ;
  }
  return Number.isFinite(floor) ? { ...pass, airFloorZMm: floor } : pass;
}

function traceOf(pass: CncPass): Trace | null {
  switch (pass.kind) {
    case 'contour':
      if (cncContourEmissionPrecision(pass) === null) return null;
      // closed is metadata; the emitter cuts only supplied vertices.
      return trace('contour', pass.polyline, pass.zMm);
    case 'path3d':
      if (pass.points.length < 2) return null;
      return trace(
        'path3d',
        pass.points,
        pass.points.reduce((high, point) => Math.max(high, point.z), Number.NEGATIVE_INFINITY),
      );
    case 'arc': {
      if (sampleCircularArcPoints(pass).length < 2) return null;
      const result = trace('arc', [pass.start, pass.end, pass.center], pass.zMm);
      return result === null ? null : { ...result, clockwise: pass.clockwise };
    }
    case 'helical-contour':
      // A helix and its following contour have different output primitives.
      return null;
  }
}

function trace(kind: Trace['kind'], points: ReadonlyArray<Vec2>, z: number): Trace | null {
  if (
    !Number.isFinite(z) ||
    points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
  ) {
    return null;
  }
  // A floor must not sit below the Z actually retained by the controller.
  const highestZ = Math.ceil(Math.max(z, representedCncCoordinateMm(z)) * 1000) / 1000;
  return { kind, points, highestZ };
}

function repeats(earlier: Trace, later: Trace): boolean {
  return (
    earlier.kind === later.kind &&
    earlier.clockwise === later.clockwise &&
    earlier.points.length === later.points.length &&
    later.points.every((point, index) => {
      const previous = earlier.points[index];
      return previous !== undefined && point.x === previous.x && point.y === previous.y;
    })
  );
}
