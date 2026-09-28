// Corners of a sampled contour for Optimize Shapes (LBG-T22), and the runs
// between them. A corner is a joint between two source pieces where the
// outline turns by more than the corner angle; it never moves and stays
// sharp, and each run between corners is smoothed and fitted on its own.
//
// A joint where a curve meets anything is a drawn corner by its exact
// tangents. A vertex between two straight lines may instead be pixel noise: a
// staircase turns 90 degrees at every pixel yet runs straight overall, and a
// jittery trace turns sharply at random. While smoothing, such a vertex counts
// only if the outline's direction just before it and just after it (the
// principal direction of the points there, which averages the jitter out)
// also differs by more than the corner angle, judged both over one smoothing
// distance each side and over two. Noise finer than the smoothing is then
// smoothed away, and a real corner, whose sides run straight into it, is kept.

import type { Vec2 } from '../../scene/scene-object';
import type { ContourSamples } from './contour-samples';
import { windowDirection } from './outline-window';

// A window stops after this many points: plenty to average jitter over.
const MAX_WINDOW_POINTS = 256;

export type ContourRun = {
  /** From one corner (or open end) to the next, both included. */
  readonly points: ReadonlyArray<Vec2>;
  /** A closed contour without corners: the points wrap round, the first is not repeated. */
  readonly periodic: boolean;
};

export function contourCorners(
  samples: ContourSamples,
  cornerAngleRad: number,
  probeMm: number,
): number[] {
  const corners: number[] = [];
  for (const joint of samples.joints) {
    if (!(joint.turnRad > cornerAngleRad)) continue;
    if (
      joint.betweenLines &&
      probeMm > 0 &&
      !turnsOverWindows(samples, joint.index, probeMm, cornerAngleRad)
    ) {
      continue;
    }
    corners.push(joint.index);
  }
  return corners;
}

// A corner turns at one point, so it shows the same turn over one smoothing
// distance and over two; jitter rarely turns that far at both scales at once.
function turnsOverWindows(
  samples: ContourSamples,
  index: number,
  windowMm: number,
  cornerAngleRad: number,
): boolean {
  return (
    windowTurn(samples, index, windowMm) > cornerAngleRad &&
    windowTurn(samples, index, 2 * windowMm) > cornerAngleRad
  );
}

/** The runs between consecutive corners, in order along the contour. */
export function contourRuns(samples: ContourSamples, corners: ReadonlyArray<number>): ContourRun[] {
  const { points } = samples;
  const n = points.length;
  if (!samples.closed) {
    const bounds = [0, ...corners.filter((index) => index > 0 && index < n - 1), n - 1];
    const runs: ContourRun[] = [];
    for (let k = 0; k + 1 < bounds.length; k += 1) {
      runs.push({
        points: points.slice(bounds[k], (bounds[k + 1] as number) + 1),
        periodic: false,
      });
    }
    return runs;
  }
  if (corners.length === 0) return [{ points, periodic: true }];
  const runs: ContourRun[] = [];
  corners.forEach((from, k) => {
    const next = corners[k + 1] ?? (corners[0] as number) + n;
    const run: Vec2[] = [];
    for (let index = from; index <= next; index += 1) run.push(points[index % n] as Vec2);
    runs.push({ points: run, periodic: false });
  });
  return runs;
}

// The turn between the outline's direction over the window behind the vertex
// and over the window ahead of it. A vertex closer than one window to an open
// end cannot be told from noise, so it reads as no turn and is smoothed like
// the rest (anything that close to a pinned end is finer than the smoothing).
function windowTurn(samples: ContourSamples, index: number, windowMm: number): number {
  const incoming = windowDirection(samples, index, -1, windowMm, false, MAX_WINDOW_POINTS);
  if (incoming === null) return 0;
  const outgoing = windowDirection(samples, index, 1, windowMm, false, MAX_WINDOW_POINTS);
  if (outgoing === null) return 0;
  const cos = incoming.x * outgoing.x + incoming.y * outgoing.y;
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}
