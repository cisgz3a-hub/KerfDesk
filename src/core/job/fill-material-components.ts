// Normalize each path's own fill rule, union within one object, retain intrinsic holes.
import type { DeviceProfile } from '../devices';
import { toMachineCoords } from '../devices';
import {
  applyTransform,
  isClosedEnough,
  pathUsesOperation,
  type Polyline,
  type Layer,
} from '../scene';
import { ok, type Result } from '../result';
import {
  normalizeClosedPolylinesEvenOddChecked,
  normalizeClosedPolylinesNonZeroChecked,
  normalizeClosedPolylineTreeNonZeroChecked,
} from '../geometry/polygon-difference';
import type { VectorOpError } from '../geometry/vector-path-tools';
import { compilationPolylines } from './compilation-polylines';
import type { VectorArtwork } from './vector-process-buckets';

export type FillContributor = {
  readonly object: VectorArtwork;
  readonly layer: Layer;
  readonly canvasIndex: number;
};
export type MaterialComponent = {
  readonly owner: FillContributor;
  readonly contours: ReadonlyArray<Polyline>;
  readonly shell: Polyline;
};

export type MaterializedFillContributor = {
  readonly owner: FillContributor;
  readonly paths: ReadonlyArray<{
    readonly contours: ReadonlyArray<Polyline>;
    readonly rule: 'nonzero' | 'evenodd';
  }>;
};

// Flatten and transform each actual contributor once, including the source list used if an engine fails.
export function materializeFillContributors(
  contributors: ReadonlyArray<FillContributor>,
  device: DeviceProfile,
): MaterializedFillContributor[] {
  return contributors.flatMap((owner) => {
    const paths = owner.object.paths.flatMap((path) => {
      if (!pathUsesOperation(owner.object, path, owner.layer)) return [];
      const contours = compilationPolylines(path, owner.object.transform)
        .map((polyline) => ({
          points: polyline.points.map((p) =>
            toMachineCoords(applyTransform(p, owner.object.transform), device),
          ),
          closed: polyline.closed,
        }))
        .filter((polyline) => polyline.points.length >= 3 && isClosedEnough(polyline))
        .map((polyline) => ({ ...polyline, closed: true }));
      const rule = path.fillRule ?? (owner.object.kind === 'text' ? 'nonzero' : 'evenodd');
      return contours.length === 0 ? [] : [{ contours, rule }];
    });
    return paths.length === 0 ? [] : [{ owner, paths }];
  });
}

export function fillMaterialComponents(
  contributors: ReadonlyArray<MaterializedFillContributor>,
): Result<ReadonlyArray<MaterialComponent>, VectorOpError> {
  const components: MaterialComponent[] = [];
  for (const { owner, paths } of contributors) {
    const normalized: Polyline[] = [];
    for (const path of paths) {
      const resolved =
        path.rule === 'nonzero'
          ? normalizeClosedPolylinesNonZeroChecked(path.contours)
          : normalizeClosedPolylinesEvenOddChecked(path.contours);
      if (resolved.kind === 'error') return resolved;
      for (const contour of resolved.value) normalized.push(contour);
    }
    const tree = normalizeClosedPolylineTreeNonZeroChecked(normalized);
    if (tree.kind === 'error') return tree;
    tree.value.forEach((node, index) => {
      if (node.isHole) return;
      components.push({
        owner,
        shell: node.contour,
        contours: [
          node.contour,
          ...tree.value
            .filter((child) => child.isHole && child.parentIndex === index)
            .map((child) => child.contour),
        ],
      });
    });
  }
  return ok(components);
}
