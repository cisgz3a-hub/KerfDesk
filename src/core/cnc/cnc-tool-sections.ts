// orderGroupsIntoToolSections — multi-tool job ordering (Phase H.7). The
// compiler's release order (all clearing work first, then profiles,
// inner-before-outer) holds globally. Each phase is grouped into contiguous
// per-bit sections, so a tool may appear once in clearing and again in the
// profile phase. That repeat is necessary: no profile may free a part while
// any later clearing operation remains.

import type { CncGroup } from '../job';
import { isProfileCutType } from './compile-cnc-helpers';

// Groups without a toolId (pre-H.7 fixtures) share one implicit section.
const IMPLICIT_TOOL_KEY = '';

export function orderGroupsIntoToolSections(
  groups: ReadonlyArray<CncGroup>,
): ReadonlyArray<CncGroup> {
  const clearing = groups.filter((group) => !isProfileCutType(group.cutType));
  const profiles = groups.filter((group) => isProfileCutType(group.cutType));
  return [...groupPhaseIntoToolSections(clearing), ...groupPhaseIntoToolSections(profiles)];
}

function groupPhaseIntoToolSections(groups: ReadonlyArray<CncGroup>): ReadonlyArray<CncGroup> {
  const sections = new Map<string, CncGroup[]>();
  for (const group of groups) {
    const key = group.toolId ?? IMPLICIT_TOOL_KEY;
    const bucket = sections.get(key);
    if (bucket === undefined) sections.set(key, [group]);
    else bucket.push(group);
  }
  if (sections.size <= 1) return groups;
  return [...sections.values()].flat();
}
