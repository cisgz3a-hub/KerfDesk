// Optional Cut Planner fields read from a .lf2 file. Each is kept absent when
// a file never set it, so such a project saves byte for byte as it was read.

import { CUT_DIRECTIONS } from '../../core/job/directional-order';
import {
  clampOverlapMergeTolerance,
  isLineStartRegion,
  type Project,
} from '../../core/scene/project';

export function normalizedLineStartRegion(
  value: unknown,
): Pick<Project['optimization'], 'lineStartRegion'> {
  return isLineStartRegion(value) ? { lineStartRegion: value } : {};
}

// LBG-C13.
export function overlapMergeTolerance(
  value: unknown,
): Pick<Project['optimization'], 'overlapMergeToleranceMm'> {
  return typeof value === 'number' && Number.isFinite(value)
    ? { overlapMergeToleranceMm: clampOverlapMergeTolerance(value) }
    : {};
}

// LightBurn Order by direction; an unknown value keeps the planner.
export function normalizedCutDirection(
  value: unknown,
): Pick<Project['optimization'], 'cutDirection'> {
  const direction = CUT_DIRECTIONS.find((candidate) => candidate === value);
  return direction === undefined ? {} : { cutDirection: direction };
}
