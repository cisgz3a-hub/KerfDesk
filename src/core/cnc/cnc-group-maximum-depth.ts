import type { CncGroup, Job } from '../job';
import { assertNever } from '../scene';
import { cncDepthRepresentationMm, type CncCoordinateRepresentation } from './cnc-output-precision';
import { cncPassCanEmit } from './cnc-pass-emission';

/** Deepest positive stock depth, retaining its exact emitted coordinate text. */
export function cncGroupMaximumDepth(group: CncGroup): CncCoordinateRepresentation {
  let deepest = cncDepthRepresentationMm(0);
  const includeZ = (zMm: number): void => {
    const candidate = cncDepthRepresentationMm(-zMm);
    if (Number.isNaN(candidate.value) || candidate.value > deepest.value) deepest = candidate;
  };
  for (const pass of group.passes) {
    if (!cncPassCanEmit(pass)) continue;
    switch (pass.kind) {
      case 'contour':
        includeZ(pass.zMm);
        break;
      case 'arc':
        includeZ(pass.zMm);
        break;
      case 'path3d':
        if (pass.points.length >= 2) {
          for (const point of pass.points) includeZ(point.z);
        }
        break;
      case 'helical-contour':
        includeZ(pass.startZMm);
        includeZ(pass.zMm);
        break;
      default:
        assertNever(pass, 'CncPass');
    }
  }
  return deepest;
}

/** Deepest positive controller value reached by represented compiled pass motion. */
export function cncGroupMaximumDepthMm(group: CncGroup): number {
  return cncGroupMaximumDepth(group).value;
}

/**
 * Deepest compiled cut of each contiguous bit section, in the order the
 * emitter separates sections with M0 (the same grouping as `cncToolPlan`).
 * Exact at any program length, unlike a bounded re-parse of the emitted text
 * (ADR-572 Amendment 2). A NaN group depth stays NaN, so callers see it.
 */
export function cncToolSectionMaximumDepthsMm(job: Job): ReadonlyArray<number> {
  const depths: number[] = [];
  let previousKey: string | undefined;
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    const key = group.toolId ?? '';
    const depth = cncGroupMaximumDepthMm(group);
    const previous = depths.at(-1);
    if (key === previousKey && previous !== undefined)
      depths[depths.length - 1] = Math.max(previous, depth);
    else depths.push(depth);
    previousKey = key;
  }
  return depths;
}
