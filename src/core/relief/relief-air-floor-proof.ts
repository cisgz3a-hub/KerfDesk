// A relief floor may survive later placement only when the same output
// primitive repeats exactly the same XY vertices. Area unions, source-space
// collinearity and tolerance cannot certify the final rounded cutter path.
import {
  cncContourEmissionVertices,
  representedCncCoordinateMm,
} from '../cnc/coordinate-representation';
import type { CncContourPass, CncPass, CncPath3dPass } from '../job';
import type { Vec2 } from '../scene';

type FlooredPass = CncContourPass | CncPath3dPass;
type Cut = {
  readonly kind: FlooredPass['kind'];
  readonly points: ReadonlyArray<Vec2>;
  readonly sourceHigh: number;
  readonly emittedHigh: number;
};

export function keepProvenAirFloors(
  passes: ReadonlyArray<CncPass>,
  ceilings: ReadonlyArray<number | null>,
  cutterRadiusMm: number,
): CncPass[] {
  const earlier: Cut[] = [];
  return passes.map((pass, index) => {
    if (pass.kind !== 'contour' && pass.kind !== 'path3d') return pass;
    const cut = cutOf(pass);
    const next = provenPass(pass, cut, earlier, ceilings[index] ?? null, cutterRadiusMm);
    if (cut !== null) earlier.push(cut);
    return next;
  });
}

function provenPass(
  pass: FlooredPass,
  cut: Cut | null,
  earlier: ReadonlyArray<Cut>,
  ceiling: number | null,
  radius: number,
): CncPass {
  if (pass.airFloorZMm === undefined) return pass;
  const { airFloorZMm: floor, ...withoutFloor } = pass;
  if (
    cut === null ||
    ceiling === null ||
    !Number.isFinite(ceiling) ||
    !(radius > 0) ||
    !Number.isFinite(radius)
  ) {
    return withoutFloor;
  }
  const emittedCeiling = Math.max(ceiling, representedCncCoordinateMm(ceiling));
  const proven = earlier.some(
    (prior) =>
      prior.sourceHigh <= ceiling && prior.emittedHigh <= emittedCeiling && repeats(prior, cut),
  );
  if (!proven) return withoutFloor;
  // Preserve the cutter rise and never round the floor below proven stock.
  const representedFloor = Math.max(
    floor,
    floor + emittedCeiling - ceiling,
    representedCncCoordinateMm(floor),
  );
  return { ...pass, airFloorZMm: Math.ceil(representedFloor * 1000) / 1000 };
}

function cutOf(pass: FlooredPass): Cut | null {
  const points = pass.kind === 'contour' ? pass.polyline : pass.points;
  if (points.length < 2) return null;
  if (pass.kind === 'contour' && cncContourEmissionVertices(pass).length < 2) return null;
  const sourceHigh =
    pass.kind === 'contour'
      ? pass.zMm
      : pass.points.reduce((high, point) => Math.max(high, point.z), Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(sourceHigh)) return null;
  return {
    kind: pass.kind,
    points,
    sourceHigh,
    emittedHigh: representedCncCoordinateMm(sourceHigh),
  };
}

function repeats(first: Cut, second: Cut): boolean {
  return (
    first.kind === second.kind &&
    first.points.length === second.points.length &&
    second.points.every((point, index) => {
      const previous = first.points[index];
      return previous !== undefined && point.x === previous.x && point.y === previous.y;
    })
  );
}
