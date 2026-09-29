// Which operations of a compiled job actually cut holding tabs (ADR-258
// Amendment 4). Job Review reads this rather than the layer settings, so it
// names tabs only where the passes carry them: an open path never gets one,
// whatever its operation asks for.
//
// A tab is a Z-rise inside one continuous path3d pass, and its wall is the
// same-XY vertical pair cnc-tab-ramp.ts emits (ADR-258). No other profile
// motion climbs in place: ramps and leads move along the path as they descend.
//
// Pure: no clock, no randomness, no I/O.

import type { CncPass, Job } from '../job';
import { isProfileCutType } from './compile-cnc-helpers';

const EPS = 1e-9;

/** The operations whose compiled profile passes rise into at least one tab. */
export function tabbedProfileLayerIds(job: Job): ReadonlySet<string> {
  const layerIds = new Set<string>();
  for (const group of job.groups) {
    if (group.kind !== 'cnc' || !isProfileCutType(group.cutType)) continue;
    if (group.passes.some(passRisesIntoTab)) layerIds.add(group.layerId);
  }
  return layerIds;
}

/** True when the pass climbs a vertical tab wall: an upward step at one XY. */
export function passRisesIntoTab(pass: CncPass): boolean {
  if (pass.kind !== 'path3d') return false;
  for (let index = 1; index < pass.points.length; index += 1) {
    const from = pass.points[index - 1];
    const to = pass.points[index];
    if (from === undefined || to === undefined) continue;
    const inPlace = Math.abs(to.x - from.x) <= EPS && Math.abs(to.y - from.y) <= EPS;
    if (inPlace && to.z > from.z + EPS) return true;
  }
  return false;
}
