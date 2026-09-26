// Splits one canonical subpath, already mapped to machine millimetres, into
// the runs the arc fitter works on (ADR-432):
//   - smooth runs: curve pieces (cubics, elliptical arcs) and any lines joined
//     to them with a tangent turn of at most ARC_FIT_SMOOTH_JOINT_DEG, sampled
//     densely with their exact tangents;
//   - straight runs: consecutive line segments whose vertices turn by less than
//     ARC_FIT_CORNER_DEG, kept as their own vertices.
// Every other joint, the seam of a closed subpath and both ends of an open one
// stay break points at their exact positions.

import type { Vec2 } from '../../scene';
import { ARC_FIT_CORNER_DEG, ARC_FIT_SMOOTH_JOINT_DEG } from './arc-fit-limits';
import type { SmoothRun } from './fit-runs';
import { sampleMappedPiece, type MappedPiece } from './mapped-pieces';

export type FitRun =
  | { readonly kind: 'smooth'; readonly run: SmoothRun }
  | { readonly kind: 'straight'; readonly vertices: ReadonlyArray<Vec2> };

const COS_SMOOTH = Math.cos((ARC_FIT_SMOOTH_JOINT_DEG * Math.PI) / 180);
const COS_CORNER = Math.cos((ARC_FIT_CORNER_DEG * Math.PI) / 180);

export function splitIntoFitRuns(pieces: ReadonlyArray<MappedPiece>): FitRun[] {
  const runs: FitRun[] = [];
  let group: MappedPiece[] = [];
  const flush = (): void => {
    if (group.length > 0) runs.push(runOf(group));
    group = [];
  };
  for (const piece of pieces) {
    const previous = group[group.length - 1];
    if (previous !== undefined && !continuesRun(previous, piece, group)) flush();
    group.push(piece);
  }
  flush();
  return runs;
}

// A curve piece joins a group through a smooth joint; a line joins a straight
// group through a non-corner vertex, or a curved group through a smooth joint.
function continuesRun(
  previous: MappedPiece,
  next: MappedPiece,
  group: ReadonlyArray<MappedPiece>,
): boolean {
  const turnCos = dot(previous.endTangent, next.startTangent);
  const groupIsStraight = group.every((piece) => piece.kind === 'line');
  if (groupIsStraight && next.kind === 'line') return turnCos > COS_CORNER;
  if (groupIsStraight && group.length > 1) return false;
  return turnCos >= COS_SMOOTH;
}

function runOf(group: ReadonlyArray<MappedPiece>): FitRun {
  if (group.every((piece) => piece.kind === 'line')) {
    const first = group[0] as MappedPiece;
    return { kind: 'straight', vertices: [first.start, ...group.map((piece) => piece.end)] };
  }
  const points: Vec2[] = [];
  const tangentsIn: Vec2[] = [];
  const tangentsOut: Vec2[] = [];
  for (const piece of group) {
    const samples = sampleMappedPiece(piece);
    const offset = points.length === 0 ? 0 : 1;
    if (offset === 1) tangentsOut[tangentsOut.length - 1] = samples.tangentsOut[0] as Vec2;
    for (let index = offset; index < samples.points.length; index += 1) {
      points.push(samples.points[index] as Vec2);
      tangentsIn.push(samples.tangentsIn[index] as Vec2);
      tangentsOut.push(samples.tangentsOut[index] as Vec2);
    }
  }
  return { kind: 'smooth', run: { points, tangentsIn, tangentsOut } };
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}
