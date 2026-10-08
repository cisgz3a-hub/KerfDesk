import { isPositiveD } from 'clipper2-ts';
import { adaptiveIslandSequences } from './adaptive-pocket-islands';
import type { Polyline } from '../scene';
import {
  canonicalAdaptivePocketPaths,
  componentRegions,
  toPolyline,
} from './adaptive-pocket-geometry';
import { sequencesForComponent, type AdaptivePocketSequence } from './adaptive-pocket-sequences';

export type { AdaptivePocketSequence } from './adaptive-pocket-sequences';

export type AdaptivePocketPlan =
  | {
      readonly ok: true;
      readonly sequences: ReadonlyArray<AdaptivePocketSequence>;
      readonly optimalLoadMm: number;
      readonly islandPartitions?: number;
    }
  | { readonly ok: false; readonly reason: string };

const MIN_POINTS = 3;

export function planAdaptivePocket(
  contours: ReadonlyArray<Polyline>,
  toolDiameterMm: number,
  optimalLoadMm: number,
): AdaptivePocketPlan {
  const issue = requestIssue(contours, toolDiameterMm, optimalLoadMm);
  if (issue !== null) return { ok: false, reason: issue };

  const original = canonicalAdaptivePocketPaths(contours);
  if (original === null || original.length === 0) {
    return { ok: false, reason: 'Adaptive clearing could not build a closed pocket region.' };
  }
  if (original.some((path) => !isPositiveD(path))) {
    const island = adaptiveIslandSequences(original, toolDiameterMm, optimalLoadMm);
    return island.ok
      ? {
          ok: true,
          sequences: island.sequences,
          optimalLoadMm,
          islandPartitions: island.partitionCount,
        }
      : island;
  }
  const sequences: AdaptivePocketSequence[] = [];
  for (const component of componentRegions(original)) {
    const componentSequences = sequencesForComponent(component, toolDiameterMm, optimalLoadMm);
    if (!componentSequences.ok) return componentSequences;
    sequences.push(...componentSequences.value);
  }
  return sequences.length === 0
    ? { ok: false, reason: 'Adaptive clearing found no reachable pocket area.' }
    : { ok: true, sequences, optimalLoadMm };
}

export function canonicalAdaptivePocketContours(
  contours: ReadonlyArray<Polyline>,
): ReadonlyArray<Polyline> | null {
  const paths = canonicalAdaptivePocketPaths(contours);
  return paths === null ? null : paths.map(toPolyline);
}

function requestIssue(
  contours: ReadonlyArray<Polyline>,
  toolDiameterMm: number,
  optimalLoadMm: number,
): string | null {
  if (!positiveFinite(toolDiameterMm) || !positiveFinite(optimalLoadMm)) {
    return 'Adaptive bit diameter and optimal load must be positive and finite.';
  }
  if (optimalLoadMm > toolDiameterMm / 2) {
    return 'Adaptive optimal load must not exceed half the bit diameter.';
  }
  return contours.some((contour) => !contour.closed || contour.points.length < MIN_POINTS)
    ? 'Adaptive clearing requires closed pocket contours.'
    : null;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
