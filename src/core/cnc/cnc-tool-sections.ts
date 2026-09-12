// orderGroupsIntoToolSections — multi-tool job ordering (Phase H.7). The
// compiler's release order (all clearing work first, then profiles,
// inner-before-outer) holds globally. Each phase groups ready work by bit, but
// a finish must wait for its own secondary clearing stages. A tool can recur
// within the clearing phase as well as in the final profile phase.

import type { CncGroup } from '../job';
import { isProfileCutType } from './compile-cnc-helpers';
import { CncReadyToolSections } from './cnc-ready-tool-sections';

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
  const sections: ToolSection[] = [];
  const byTool = new Map<string, ToolSection>();
  const sectionForGroup: ToolSection[] = [];
  for (const [index, group] of groups.entries()) {
    const key = group.toolId ?? IMPLICIT_TOOL_KEY;
    let section = byTool.get(key);
    if (section === undefined) {
      section = { rank: sections.length, indexes: [], next: 0, queued: false };
      sections.push(section);
      byTool.set(key, section);
    }
    section.indexes.push(index);
    sectionForGroup.push(section);
  }
  if (sections.length <= 1) return groups;
  return orderReadySections(groups, sections, sectionForGroup);
}

type ToolSection = {
  readonly rank: number;
  readonly indexes: number[];
  next: number;
  queued: boolean;
};

function orderReadySections(
  groups: ReadonlyArray<CncGroup>,
  sections: ReadonlyArray<ToolSection>,
  sectionForGroup: ReadonlyArray<ToolSection>,
): ReadonlyArray<CncGroup> {
  const remaining = new Map<number, number>();
  const dependents = new Map<number, number[]>();
  for (const [index, prerequisites] of secondaryClearingDependencies(groups)) {
    remaining.set(index, prerequisites.length);
    for (const prior of prerequisites) {
      const followers = dependents.get(prior) ?? [];
      followers.push(index);
      dependents.set(prior, followers);
    }
  }
  const ready = new CncReadyToolSections();
  const isReady = (index: number | undefined): index is number =>
    index !== undefined && (remaining.get(index) ?? 0) === 0;
  const enqueue = (section: ToolSection | undefined): void => {
    if (section === undefined || section.queued) return;
    const index = section.indexes[section.next];
    if (isReady(index)) {
      ready.push(section.rank);
      section.queued = true;
    }
  };
  sections.forEach(enqueue);
  const result: CncGroup[] = [];
  for (let rank = ready.pop(); rank !== undefined; rank = ready.pop()) {
    const section = sections[rank] as ToolSection;
    section.queued = false;
    let index = section.indexes[section.next];
    while (isReady(index)) {
      result.push(groups[index] as CncGroup);
      section.next += 1;
      for (const dependent of dependents.get(index) ?? []) {
        remaining.set(dependent, (remaining.get(dependent) ?? 0) - 1);
        if (sectionForGroup[dependent] !== section) enqueue(sectionForGroup[dependent]);
      }
      index = section.indexes[section.next];
    }
  }
  // Dependencies point backward in source order, so some section is always
  // ready. Preserve complete source order if malformed input violates that.
  return result.length === groups.length ? result : groups;
}

/** Secondary provenance identifies the operation whose primary path consumes it. */
function secondaryClearingDependencies(
  groups: ReadonlyArray<CncGroup>,
): ReadonlyMap<number, ReadonlyArray<number>> {
  const clearingByOperation = new Map<string, number[]>();
  const prerequisites = new Map<number, ReadonlyArray<number>>();
  for (const [index, group] of groups.entries()) {
    const primaryTool = group.layerPrimaryToolId ?? group.toolId ?? IMPLICIT_TOOL_KEY;
    const key = JSON.stringify([group.layerId, group.sourceObjectId ?? null, primaryTool]);
    const clearing = clearingByOperation.get(key) ?? [];
    // A secondary rest stage can itself consume an earlier clearing proof.
    // Include nested stages targeting this tool as well as stages owned by
    // the final primary tool, before registering the current secondary.
    const ownKey = JSON.stringify([
      group.layerId,
      group.sourceObjectId ?? null,
      group.toolId ?? IMPLICIT_TOOL_KEY,
    ]);
    const earlier = new Set([...clearing, ...(clearingByOperation.get(ownKey) ?? [])]);
    if (earlier.size > 0) prerequisites.set(index, [...earlier]);
    if (primaryTool !== (group.toolId ?? IMPLICIT_TOOL_KEY)) {
      clearing.push(index);
      clearingByOperation.set(key, clearing);
    }
  }
  return prerequisites;
}
