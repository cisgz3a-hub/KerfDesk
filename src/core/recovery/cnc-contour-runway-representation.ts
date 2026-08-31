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
 * narrow toward the requested minimum without ever accepting a short one. */
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
