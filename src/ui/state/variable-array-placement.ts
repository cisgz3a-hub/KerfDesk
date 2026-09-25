import {
  arrayPlacements,
  combinedBBox,
  type ArrayPlacement,
  type ArraySpec,
  type Bounds,
  type SceneObject,
} from '../../core/scene';
import type { ArrayMaterialization } from './array-actions';

/** Layout is transient; later value changes and manual moves never reflow the saved array. */
export function variableArrayMaterialization(
  spec: ArraySpec,
  selectedIds: ReadonlySet<string>,
  sources: ReadonlyArray<ReadonlyArray<SceneObject>>,
): ArrayMaterialization | null {
  const selections = sources.map((slot) => slot.filter((object) => selectedIds.has(object.id)));
  const bounds = selections.flatMap((selected) => {
    const bound = combinedBBox(selected);
    return bound === null ? [] : [bound];
  });
  const first = bounds[0];
  const envelope = combinedBBox(selections.flat());
  if (first === undefined || envelope === null || bounds.length !== sources.length) return null;
  // Grid fits the largest current value. Point Rotation keeps one pivot at the first copy.
  const placements = arrayPlacements(spec.kind === 'grid' ? envelope : first, spec);
  return {
    bounds: envelope,
    sources,
    placements:
      spec.kind === 'circular'
        ? placements.map((placement, index) => recenter(placement, first, bounds[index] ?? first))
        : placements,
  };
}

function recenter(placement: ArrayPlacement, first: Bounds, current: Bounds): ArrayPlacement {
  // Keep the requested ring and tangent, centring each differently sized badge on its ring point.
  return {
    ...placement,
    dx: placement.dx + (first.minX + first.maxX - current.minX - current.maxX) / 2,
    dy: placement.dy + (first.minY + first.maxY - current.minY - current.maxY) / 2,
  };
}
