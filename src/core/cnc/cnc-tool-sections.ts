// orderGroupsIntoToolSections — multi-tool job ordering (Phase H.7). The
// compiler's safety order (clearing work first, profiles last,
// inner-before-outer) holds WITHIN each bit; across bits the job becomes
// contiguous per-bit sections so the operator changes each bit exactly
// once. Sections without profile cuts run before sections with them — a
// profile can free the part, and a freed part must never be re-machined by
// a later bit.

import type { CncGroup } from '../job';
import { isProfileCutType } from './compile-cnc-job';

// Groups without a toolId (pre-H.7 fixtures) share one implicit section.
const IMPLICIT_TOOL_KEY = '';

export function orderGroupsIntoToolSections(
  groups: ReadonlyArray<CncGroup>,
): ReadonlyArray<CncGroup> {
  const sections = new Map<string, CncGroup[]>();
  for (const group of groups) {
    const key = group.toolId ?? IMPLICIT_TOOL_KEY;
    const bucket = sections.get(key);
    if (bucket === undefined) sections.set(key, [group]);
    else bucket.push(group);
  }
  if (sections.size <= 1) return groups;
  const ordered = [...sections.values()];
  // Stable partition: profile-free sections keep their relative order and
  // run first; profile-carrying sections follow in their relative order.
  return [
    ...ordered.filter((section) => !sectionHasProfile(section)),
    ...ordered.filter((section) => sectionHasProfile(section)),
  ].flat();
}

function sectionHasProfile(section: ReadonlyArray<CncGroup>): boolean {
  return section.some((group) => isProfileCutType(group.cutType));
}
