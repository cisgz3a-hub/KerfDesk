// The Fill pool plan kept between frames (ADR-683 Amendment 3, performance
// audit S2-P2-4). A plan reads only each object, its compile run, and per
// path the contours it burns, their rule, its paint kind and the Fill
// operations that burn it, plus the box of each photo drawn between. A frame
// that brings the same of all of those (by identity, or by value for the
// strings) gets the same plan: a pan, a zoom inside one flattening bucket or a
// hover plans nothing. Two slots, so two canvases drawn in turn keep theirs.

import type { AABB } from '../../core/scene';
import type { FillPoolRuns } from '../../core/scene/fill-operations';
import {
  bindPlannedPools,
  planPools,
  type FillPoolPlan,
  type PlannedPools,
  type ResolvedVector,
} from './fill-pools';

type Slot = { readonly signature: ReadonlyArray<unknown>; readonly planned: PlannedPools };

const MAX_SLOTS = 2;
let slots: Slot[] = [];

/** `planFillPools`, reusing the last plan made from the same inputs. */
export function cachedFillPoolPlan(
  entries: ReadonlyArray<ResolvedVector | undefined>,
  drawnBox: (index: number) => AABB | null,
  runOf: FillPoolRuns,
): FillPoolPlan {
  const signature = planSignature(entries, drawnBox, runOf);
  let slot = slots.find((candidate) => sameSignature(candidate.signature, signature));
  if (slot === undefined) slot = { signature, planned: planPools(entries, drawnBox, runOf) };
  slots = [slot, ...slots.filter((candidate) => candidate !== slot)].slice(0, MAX_SLOTS);
  return bindPlannedPools(slot.planned, entries);
}

export function resetFillPoolPlansForTests(): void {
  slots = [];
}

function planSignature(
  entries: ReadonlyArray<ResolvedVector | undefined>,
  drawnBox: (index: number) => AABB | null,
  runOf: FillPoolRuns,
): unknown[] {
  const items: unknown[] = [entries.length];
  entries.forEach((entry, index) => {
    if (entry === undefined) {
      const box = drawnBox(index);
      items.push(box === null ? null : `${box.minX},${box.minY},${box.maxX},${box.maxY}`);
      return;
    }
    items.push(entry.object, runOf(entry.object), entry.display.paths.length);
    for (const path of entry.display.paths) {
      items.push(path.fillDisplay, path.fillRule, path.paint.kind, path.fillOperations.length);
      for (const { operationId, color, output } of path.fillOperations) {
        items.push(operationId, color, output);
      }
    }
  });
  return items;
}

function sameSignature(a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
