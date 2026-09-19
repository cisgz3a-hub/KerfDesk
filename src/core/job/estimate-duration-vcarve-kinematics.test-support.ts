import { DEFAULT_DEVICE_PROFILE } from '../devices';

type Point = { readonly x: number; readonly y: number; readonly z: number };
type Bucket = 'cut' | 'feedTravel' | 'rapid';
type MotionExpectation = Record<Bucket, number> & {
  readonly roundOffSeconds: Record<Bucket, number>;
};
type Move = {
  readonly distance: number;
  readonly direction: Point;
  readonly velocity: number;
  readonly bucket: Bucket;
  readonly stopAfter: boolean;
};

// Independent fixture oracle: every junction is constrained by every other
// junction through v² <= u² + 2ad, rather than calling the production planner.
// The hand-built route retains M3/M5 stops and rapid/feed boundaries while
// entry plunges and the profile share the same acceleration envelope.
export function expectedVcarveMotion(
  points: ReadonlyArray<Point>,
  feeds: ReadonlyArray<number>,
  safeZ: number,
  plungeFeed: number,
): MotionExpectation {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) throw new Error('A profile is required');
  const rapidFeed = DEFAULT_DEVICE_PROFILE.maxFeed;
  const origin = { x: 0, y: 0, z: 0 };
  const liftedOrigin = { ...origin, z: safeZ };
  const entry = { ...first, z: safeZ };
  const retracted = { ...last, z: safeZ };
  const moves: Move[] = [];
  appendMove(moves, origin, liftedOrigin, rapidFeed, true, true);
  appendMove(moves, liftedOrigin, entry, rapidFeed, true);
  appendMove(moves, entry, first, plungeFeed);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const feed = feeds[index - 1];
    if (from === undefined || to === undefined || feed === undefined) {
      throw new Error('Every profile segment needs an explicit emitted feed');
    }
    appendMove(moves, from, to, feed);
  }
  appendMove(moves, last, retracted, rapidFeed, true, true);
  appendMove(moves, retracted, liftedOrigin, rapidFeed, true);
  return motionSeconds(moves);
}

function appendMove(
  moves: Move[],
  from: Point,
  to: Point,
  feed: number,
  rapid = false,
  stopAfter = false,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance <= 1e-9) return;
  // Every feed move inside the cut belongs to the cut bucket, rises included:
  // drilling.test.ts pins that a peck cycle prices each vertical peck *and its
  // chip clear* rather than their zero XY projection, and the emitter draws no
  // distinction either. Only a rapid is travel.
  moves.push({
    distance,
    direction: { x: dx / distance, y: dy / distance, z: dz / distance },
    velocity: Math.min(feed, DEFAULT_DEVICE_PROFILE.maxFeed) / 60,
    bucket: rapid ? 'rapid' : 'cut',
    stopAfter,
  });
}

function motionSeconds(moves: ReadonlyArray<Move>): MotionExpectation {
  const accel = DEFAULT_DEVICE_PROFILE.accelMmPerSec2;
  const route = [0];
  for (const move of moves) route.push((route.at(-1) ?? 0) + move.distance);
  const caps = [0];
  for (let index = 1; index < moves.length; index += 1) {
    const previous = moves[index - 1];
    const next = moves[index];
    caps.push(previous === undefined || next === undefined ? 0 : junctionCap(previous, next));
  }
  caps.push(0);
  const speeds = caps.map((_, index) =>
    Math.sqrt(
      Math.min(
        ...caps.map(
          (cap, other) =>
            cap ** 2 + 2 * accel * Math.abs((route[index] ?? 0) - (route[other] ?? 0)),
        ),
      ),
    ),
  );
  const result = {
    cut: 0,
    feedTravel: 0,
    rapid: 0,
    roundOffSeconds: { cut: 0, feedTravel: 0, rapid: 0 },
  };
  for (const [index, move] of moves.entries()) {
    const entry = speeds[index] ?? 0;
    const exit = speeds[index + 1] ?? 0;
    const peak = Math.min(
      move.velocity,
      Math.sqrt(accel * move.distance + (entry ** 2 + exit ** 2) / 2),
    );
    const rampDistance = (2 * peak ** 2 - entry ** 2 - exit ** 2) / (2 * accel);
    result[move.bucket] +=
      (2 * peak - entry - exit) / accel + Math.max(0, move.distance - rampDistance) / peak;
    // Production partial-time integration subtracts squared speeds at rest.
    // Round-off O(epsilon * max(v², 2ad)) under that square root becomes
    // O(sqrt(epsilon * max(v², 2ad)) / a) seconds. Bound the short chain of
    // arithmetic operations by 16 epsilons per move; coordinates/feeds retain
    // exact assertions, and the represented-coordinate regression exceeds it.
    result.roundOffSeconds[move.bucket] +=
      Math.sqrt(16 * Number.EPSILON * Math.max(peak ** 2, 2 * accel * move.distance)) / accel;
  }
  return result;
}

function junctionCap(previous: Move, next: Move): number {
  if (previous.stopAfter || (previous.bucket === 'rapid') !== (next.bucket === 'rapid')) return 0;
  const dot =
    previous.direction.x * next.direction.x +
    previous.direction.y * next.direction.y +
    previous.direction.z * next.direction.z;
  const halfAngle = Math.sqrt((1 + Math.max(-1, Math.min(1, dot))) / 2);
  const limit =
    halfAngle === 1
      ? Number.POSITIVE_INFINITY
      : Math.sqrt(
          (DEFAULT_DEVICE_PROFILE.accelMmPerSec2 *
            DEFAULT_DEVICE_PROFILE.junctionDeviationMm *
            halfAngle) /
            (1 - halfAngle),
        );
  return Math.min(previous.velocity, next.velocity, limit);
}
