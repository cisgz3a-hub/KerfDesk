import type { DeviceProfile } from '../devices';
import type { Polyline } from '../scene';
import { err, ok, type Result } from '../result';
import type { VectorOpError } from '../geometry/vector-path-tools';
import {
  fillMaterialComponents,
  materializeFillContributors,
  type FillContributor,
  type MaterialComponent,
} from './fill-material-components';
import { materialCoverageCells } from './fill-ownership-cells';
import { properContourAncestors } from './proper-contour-containment';
import type { VectorArtwork } from './vector-process-buckets';

export function ownedFillMaterial(
  contributors: ReadonlyArray<FillContributor>,
  device: DeviceProfile,
): Result<
  {
    readonly byObject: ReadonlyMap<VectorArtwork, ReadonlyArray<Polyline>>;
    readonly objectIds: ReadonlyArray<string>;
  },
  { readonly cause: VectorOpError; readonly objectIds: ReadonlyArray<string> }
> {
  const materialized = materializeFillContributors(contributors, device);
  const objectIds = materialized.map(({ owner }) => owner.object.id);
  const components = fillMaterialComponents(materialized);
  if (components.kind === 'error') return err({ cause: components.error, objectIds });
  const ancestors = properContourAncestors(
    components.value.map((component) => ({ polyline: component.shell.points, closed: true })),
  );
  const cells = materialCoverageCells(components.value);
  if (cells.kind === 'error') return err({ cause: cells.error, objectIds });
  const owned = new Map<VectorArtwork, Polyline[]>();
  for (const cell of cells.value) {
    if (cell.contributors.length % 2 === 0) continue;
    const owner = positiveCellOwner(cell.contributors, components.value, ancestors);
    if (owner === undefined) continue;
    const contours = owned.get(owner.object) ?? [];
    for (const contour of cell.contours) contours.push(contour);
    owned.set(owner.object, contours);
  }
  return ok({ byObject: owned, objectIds });
}

// Working default: active negative holes cannot own restored crossing material.
// A positive descendant suppresses its ancestors; unrelated positives use canvas order.
function positiveCellOwner(
  active: ReadonlyArray<number>,
  components: ReadonlyArray<MaterialComponent>,
  ancestors: ReadonlyArray<ReadonlyArray<number>>,
): FillContributor | undefined {
  const positive = active.filter(
    (index) => active.filter((candidate) => ancestors[index]?.includes(candidate)).length % 2 === 0,
  );
  const deepest = positive.filter(
    (index) => !positive.some((candidate) => ancestors[candidate]?.includes(index)),
  );
  let winner: FillContributor | undefined;
  for (const index of deepest) {
    const owner = components[index]?.owner;
    if (owner !== undefined && (winner === undefined || owner.canvasIndex > winner.canvasIndex))
      winner = owner;
  }
  return winner;
}
