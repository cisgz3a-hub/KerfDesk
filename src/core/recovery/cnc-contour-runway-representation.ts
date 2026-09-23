import { cncContourEmissionVertices } from '../cnc/cnc-contour-emission';
import type { CncContourPass } from '../job';
import type { Vec2 } from '../scene';
import {
  backtrackContourPolyline,
  clearedTangentDistanceMm,
  isClearedDistanceSufficient,
} from './cnc-contour-runway-geometry';

const REPRESENTED_RUNWAY_SEARCH_STEPS = 32;

export type RepresentedContourRunway = {
  readonly runwayPolyline: ReadonlyArray<Vec2>;
  readonly recoveryPolyline: ReadonlyArray<Vec2>;
  readonly uncertaintyStartPointIndex: number;
  readonly representedRunwayMm: number;
};

export type RepresentedContourRunwayResult =
  | { readonly kind: 'ok'; readonly runway: RepresentedContourRunway }
  | { readonly kind: 'error'; readonly representedAvailableMm: number };

/** Build the exact contour that a recovery job will emit. A mathematically
 * exact backtrack point can round toward the uncertainty anchor, shortening
 * the physical runway. Keep a known-safe farther represented candidate and
 * narrow toward the requested minimum without ever accepting a short one.
 * A candidate whose representation is unsound (see
 * `isSoundRecoveryRepresentation`) is treated like a short one: the search
 * moves the runway start farther back along already-cleared path. */
export function buildRepresentedContourRunway(
  pass: CncContourPass,
  segmentIndex: number,
  requiredRunwayMm: number,
  availableClearedMm: number,
): RepresentedContourRunwayResult {
  const requested = representedAtBacktrack(pass, segmentIndex, requiredRunwayMm);
  if (
    requested !== null &&
    isClearedDistanceSufficient(requested.representedRunwayMm, requiredRunwayMm)
  ) {
    return { kind: 'ok', runway: requested };
  }

  const maximum = representedAtBacktrack(pass, segmentIndex, availableClearedMm);
  if (
    maximum === null ||
    !isClearedDistanceSufficient(maximum.representedRunwayMm, requiredRunwayMm)
  ) {
    return {
      kind: 'error',
      representedAvailableMm: maximum?.representedRunwayMm ?? 0,
    };
  }

  let unsafeDistance = requiredRunwayMm;
  let safeDistance = availableClearedMm;
  let safe = maximum;
  for (let step = 0; step < REPRESENTED_RUNWAY_SEARCH_STEPS; step += 1) {
    const candidateDistance = (unsafeDistance + safeDistance) / 2;
    const candidate = representedAtBacktrack(pass, segmentIndex, candidateDistance);
    if (
      candidate !== null &&
      isClearedDistanceSufficient(candidate.representedRunwayMm, requiredRunwayMm)
    ) {
      safeDistance = candidateDistance;
      safe = candidate;
    } else {
      unsafeDistance = candidateDistance;
    }
  }
  return { kind: 'ok', runway: safe };
}

function representedAtBacktrack(
  pass: CncContourPass,
  segmentIndex: number,
  distanceMm: number,
): RepresentedContourRunway | null {
  const rawRunway = backtrackContourPolyline(pass.polyline, segmentIndex, distanceMm);
  if (rawRunway === null) return null;
  const uncertaintySourcePointIndex = rawRunway.length - 1;
  const rawRecovery = [...rawRunway, ...pass.polyline.slice(segmentIndex + 1)];
  const vertices = cncContourEmissionVertices({
    ...pass,
    closed: false,
    polyline: rawRecovery,
  });
  const uncertaintyStartPointIndex = vertices.findIndex(
    (vertex) => vertex.sourcePointIndex === uncertaintySourcePointIndex,
  );
  if (uncertaintyStartPointIndex <= 0) return null;
  const recoveryPolyline = vertices.map((vertex) => vertex.point);
  if (!isSoundRecoveryRepresentation(pass, rawRecovery, recoveryPolyline)) return null;
  const representedRunwayMm = clearedTangentDistanceMm(
    recoveryPolyline,
    uncertaintyStartPointIndex,
  );
  return {
    runwayPolyline: recoveryPolyline.slice(0, uncertaintyStartPointIndex + 1),
    recoveryPolyline,
    uncertaintyStartPointIndex,
    representedRunwayMm,
  };
}

/** A recovery adds exactly one new point, the runway start, to geometry the
 * original program already emitted. A start that lands within representation
 * resolution of the next vertex forces the emitter to a finer precision, and
 * GRBL's parser reads the same coordinate differently at a different number
 * of decimals ("2.987" and "2.9870" parse one float32 step apart). So two
 * things must hold before a candidate is usable:
 *
 * 1. Every point shared with the original program emits exactly as it did
 *    there, so the recovery resumes where the tool actually was.
 * 2. The recovery polyline is a fixed point of emission. The supervised
 *    recovery job compiles this polyline again, so what Review shows must be
 *    what that second emission produces.
 */
function isSoundRecoveryRepresentation(
  pass: CncContourPass,
  rawRecovery: ReadonlyArray<Vec2>,
  recoveryPolyline: ReadonlyArray<Vec2>,
): boolean {
  const shared = rawRecovery.slice(1);
  if (recoveryPolyline.length < shared.length) return false;
  if (!samePolyline(recoveryPolyline.slice(recoveryPolyline.length - shared.length), shared)) {
    return false;
  }
  const reEmitted = cncContourEmissionVertices({
    ...pass,
    closed: false,
    polyline: recoveryPolyline,
  });
  return samePolyline(
    reEmitted.map((vertex) => vertex.point),
    recoveryPolyline,
  );
}

function samePolyline(left: ReadonlyArray<Vec2>, right: ReadonlyArray<Vec2>): boolean {
  return (
    left.length === right.length &&
    left.every((point, index) => {
      const other = right[index];
      return other !== undefined && point.x === other.x && point.y === other.y;
    })
  );
}
