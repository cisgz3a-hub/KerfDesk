// keepProvenAirFloors — a relief roughing pass keeps its air floor (ADR-489)
// only where the passes cut before it prove it, geometrically (ADR-489
// Amendment 1).
//
// A pass's floor stands the cutter's rise at its full radius above the pass's
// cover ceiling (its level's slice top). An earlier cut made no higher than
// that ceiling, within d of a point, leaves the stock there no higher than
// the ceiling plus the rise at d, so the cutter's tip at the floor clears it.
// The floor is proven when every point within the cutter's radius of the
// pass's path lies within that radius of such a cut: the pass's path lies in
// the union of those cuts' sweeps eroded by the radius. Nothing assumes the
// level above left no stock between its rings.
//
// Earlier sweeps are conservative: stock beyond their true reach never
// counts as cut, however thin it is. Exact centre-line retraces are proven
// separately, so polygon offset rounding cannot discard that common case.

import {
  EndType,
  FillRule,
  inflatePathsD,
  JoinType,
  unionD,
  type PathD,
  type PathsD,
} from 'clipper2-ts';
import { polylineStaysInside } from '../geometry/polyline-stays-inside';
import { tryVectorOp } from '../geometry/vector-path-tools';
import type { CncContourPass, CncPass, CncPath3dPass } from '../job';
import { cncContourEmissionVertices } from '../cnc/coordinate-representation';
import { ReliefCutPathCoverage } from './relief-cut-path-coverage';

const PRECISION_DECIMALS = 4;
// The 0.0001 mm grid rounds each swept path and each offset by up to
// 0.00007 mm.
const GRID_ROUNDING_MM = 0.0003;
const MITER_LIMIT = 2;
const COVER_ARC_TOLERANCE_MM = 0.006;
const ERODE_ARC_TOLERANCE_MM = 0.001;
// At least the erosion's chord error plus the grid's rounding, so the
// erosion never admits a point nearer the cover's edge than the radius.
const ERODE_MARGIN_MM = 0.0015;
// Keep the swept polygon inside the real cutter reach after grid rounding.
const COVER_SLACK_MM = -GRID_ROUNDING_MM;
// Long paths are swept in pieces this many segments long and unioned, which
// Clipper does several times faster than one path of thousands of vertices.
const SWEEP_PIECE_SEGMENTS = 60;
const CEILING_EPS_MM = 1e-6;

type FlooredPass = CncContourPass | CncPath3dPass;

// Where a pass may stand with its floor proven at one ceiling: the union of
// the sweeps of the cuts before `upTo` at or below it, eroded by the radius.
type Cover = {
  readonly upTo: number;
  readonly sweep: PathsD;
  readonly inside: PathsD;
  readonly retrace: ReliefCutPathCoverage;
};

// A stretch of a pass's path, points `from` to `to` inclusive.
type Run = { readonly from: number; readonly to: number };

type Proof = {
  readonly passes: ReadonlyArray<CncPass>;
  readonly radiusMm: number;
  readonly covers: Map<number, Cover>;
  // Each run's sweep, by pass index and run, so a pass counted at two
  // ceilings (its own level's and the next one's) is swept once.
  readonly sweeps: Map<string, PathsD>;
};

/**
 * The passes, each keeping its air floor only when the passes before it
 * prove it. `ceilings[i]` is the height pass i's floor stands its full-radius
 * rise above; null, or a radius that is not positive, keeps no floor.
 */
export function keepProvenAirFloors(
  passes: ReadonlyArray<CncPass>,
  ceilings: ReadonlyArray<number | null>,
  cutterRadiusMm: number,
): CncPass[] {
  const proof: Proof = { passes, radiusMm: cutterRadiusMm, covers: new Map(), sweeps: new Map() };
  return passes.map((pass, index) => {
    if (!isFloored(pass)) return pass;
    const ceiling = ceilings[index] ?? null;
    if (ceiling === null || !(cutterRadiusMm > 0) || !Number.isFinite(cutterRadiusMm)) {
      return withoutFloor(pass);
    }
    const proven = tryVectorOp(() => liesInside(pathOf(pass), coverBefore(proof, index, ceiling)));
    return proven.kind === 'ok' && proven.value ? pass : withoutFloor(pass);
  });
}

function isFloored(pass: CncPass): pass is FlooredPass & { readonly airFloorZMm: number } {
  return (pass.kind === 'contour' || pass.kind === 'path3d') && pass.airFloorZMm !== undefined;
}

function withoutFloor(pass: FlooredPass): CncPass {
  const { airFloorZMm: _floor, ...rest } = pass;
  return rest;
}

// The cover at `ceiling`, extended to every pass before `index`.
function coverBefore(proof: Proof, index: number, ceiling: number): Cover {
  const known = proof.covers.get(ceiling) ?? {
    upTo: 0,
    sweep: [],
    inside: [],
    retrace: new ReliefCutPathCoverage(),
  };
  if (known.upTo === index) return known;
  const added: PathsD = [];
  for (let earlier = known.upTo; earlier < index; earlier += 1) {
    const pass = proof.passes[earlier];
    if (pass === undefined || (pass.kind !== 'contour' && pass.kind !== 'path3d')) continue;
    for (const run of runsAtOrBelow(pass, ceiling)) {
      known.retrace.add(pathOf(pass).slice(run.from, run.to + 1));
      added.push(...runSweep(proof, earlier, run));
    }
  }
  const cover =
    added.length === 0
      ? { ...known, upTo: index }
      : withInside(
          proof,
          index,
          unionD(known.sweep, added, FillRule.NonZero, PRECISION_DECIMALS),
          known.retrace,
        );
  proof.covers.set(ceiling, cover);
  return cover;
}

function withInside(
  proof: Proof,
  upTo: number,
  sweep: PathsD,
  retrace: ReliefCutPathCoverage,
): Cover {
  const inside = inflatePathsD(
    sweep,
    -(proof.radiusMm + ERODE_MARGIN_MM),
    JoinType.Round,
    EndType.Polygon,
    MITER_LIMIT,
    PRECISION_DECIMALS,
    ERODE_ARC_TOLERANCE_MM,
  );
  return { upTo, sweep, inside, retrace };
}

// Every point within the conservatively rounded radius of a run, swept
// piece by piece; the pieces overlap where they meet, as the path does.
function runSweep(proof: Proof, index: number, run: Run): PathsD {
  const key = `${index}:${run.from}:${run.to}`;
  const known = proof.sweeps.get(key);
  if (known !== undefined) return known;
  const pass = proof.passes[index] as FlooredPass;
  const path = pathOf(pass).slice(run.from, run.to + 1);
  const pieces: PathsD = [];
  for (let start = 0; start === 0 || start < path.length - 1; start += SWEEP_PIECE_SEGMENTS) {
    const piece = path.slice(start, start + SWEEP_PIECE_SEGMENTS + 1);
    pieces.push(
      ...inflatePathsD(
        [piece],
        proof.radiusMm + COVER_SLACK_MM,
        JoinType.Round,
        EndType.Round,
        MITER_LIMIT,
        PRECISION_DECIMALS,
        COVER_ARC_TOLERANCE_MM,
      ),
    );
  }
  const sweep = unionD(pieces, [], FillRule.NonZero, PRECISION_DECIMALS);
  proof.sweeps.set(key, sweep);
  return sweep;
}

// True when no part of the path leaves the cover's inside. A plain crossing
// test on the unrounded path: Clipper's open-path clip looped forever on a
// ramp that doubled back along a 0.001 mm-wide loop.
function liesInside(path: PathD, cover: Cover): boolean {
  return cover.retrace.covers(path) || polylineStaysInside(path, cover.inside);
}

function pathOf(pass: FlooredPass): PathD {
  const points = pass.kind === 'contour' ? pass.polyline : pass.points;
  const path = points.map((point) => ({ x: point.x, y: point.y }));
  const first = path[0];
  return pass.closed && first !== undefined ? [...path, first] : path;
}

// The stretches of a pass cut no higher than `ceiling`: all of a contour at
// or below it, and each run of a 3D path's points at or below it (the moves
// into and out of a run, which rise above it part way, are left out). A run
// of one point is swept as a disc.
function runsAtOrBelow(pass: FlooredPass, ceiling: number): ReadonlyArray<Run> {
  if (!passEmitsCut(pass)) return [];
  const low = (z: number): boolean => z <= ceiling + CEILING_EPS_MM;
  const last = pathOf(pass).length - 1;
  if (pass.kind === 'contour') return low(pass.zMm) ? [{ from: 0, to: last }] : [];
  const runs: Run[] = [];
  let from = -1;
  for (let index = 0; index <= last; index += 1) {
    // A closed path's last point is its first again.
    const point = pass.points[index] ?? pass.points[0];
    if (point !== undefined && low(point.z)) {
      if (from < 0) from = index;
    } else if (from >= 0) {
      runs.push({ from, to: index - 1 });
      from = -1;
    }
  }
  if (from >= 0) runs.push({ from, to: last });
  return runs;
}

function passEmitsCut(pass: FlooredPass): boolean {
  return pass.kind === 'contour'
    ? cncContourEmissionVertices(pass).length >= 2
    : pass.points.length >= 2;
}
