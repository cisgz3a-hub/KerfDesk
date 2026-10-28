// Which operation an artwork export writes a path under, in which colour, and
// how a Fill operation's objects become the one region they burn (ADR-681).
//
// Colour: LightBurn's model is "colour is the layer", so a path is written in
// the colour of the operation it burns on, not the colour it happened to be
// drawn in. Distinct operations stay distinct in the file.
//
// Fill: the compiler pools every object on a Fill operation under even-odd
// parity (fill-rule.ts, ADR-486 Amendment 2), so a shape drawn inside another
// on the same operation is a hole, as in LightBurn. A file that paints each
// object as its own filled path shows their union instead, and an importer
// that reads it as drawn fills the hole. An operation with two or more filled
// objects is therefore written as ONE even-odd compound path in world
// millimetres. An object keeps its exact curves when its own contours already
// have even-odd parity (every shape, ordinary text); one whose own contours
// overlap (script text with Weld off, overlapping paths) is written as the
// region the compiler resolves for it.

import { compilationPolylines } from '../../core/job/compilation-polylines';
import {
  normalizeClosedPolylinesEvenOddChecked,
  normalizeClosedPolylinesNonZeroChecked,
} from '../../core/geometry/polygon-difference';
import { signedAreaMm2 } from '../../core/geometry/polyline-orientation';
import {
  applyTransform,
  pathUsesOperation,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Layer,
  type Polyline,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';
import { transformCurveSubpathExact } from '../../core/vector-export/affine-curves';
import { svgObjectMatrix } from './export-svg-paths';

export type ExportVectorObject = Extract<SceneObject, { readonly paths: readonly ColoredPath[] }>;

/** The operation a path is exported under: the first scene operation it uses. */
export function exportOperationForPath(
  project: Project,
  object: ExportVectorObject,
  path: ColoredPath,
): Layer | undefined {
  return project.scene.layers.find((layer) => pathUsesOperation(object, path, layer));
}

/** Whether that operation fills this object (its effective mode, after overrides). */
export function exportOperationFills(
  operation: Layer | undefined,
  object: ExportVectorObject,
): boolean {
  return operation !== undefined && effectiveOperationForObject(operation, object).mode === 'fill';
}

/** The operation's colour; a path on no operation keeps its own. */
export function exportPathColor(operation: Layer | undefined, path: ColoredPath): string {
  return operation?.color ?? path.color;
}

export type FillCompound = {
  readonly operation: Layer;
  /** World-millimetre closed contours; their even-odd parity is the burned region. */
  readonly curves: ReadonlyArray<CurveSubpath>;
};

export type FillCompoundPlan = {
  /** Compounds keyed by the index of their first member object, where they are written. */
  readonly atObject: ReadonlyMap<number, ReadonlyArray<FillCompound>>;
  /** Whether a compound carries the closed contours of this path. */
  readonly pooled: (object: SceneObject, pathIndex: number) => boolean;
};

type Member = { readonly object: ExportVectorObject; readonly pathIndexes: number[] };
type Pool = { readonly operation: Layer; readonly first: number; readonly members: Member[] };

export function planFillCompounds(
  project: Project,
  objects: ReadonlyArray<SceneObject>,
): FillCompoundPlan {
  const pools = new Map<string, Pool>();
  objects.forEach((object, index) => {
    if (object.kind === 'raster-image' || object.kind === 'relief' || !('paths' in object)) return;
    object.paths.forEach((path, pathIndex) => {
      const operation = exportOperationForPath(project, object, path);
      if (operation === undefined || !exportOperationFills(operation, object)) return;
      if (!authoredCurves(path).some((curve) => curve.closed && curve.segments.length > 0)) return;
      const pool = pools.get(operation.id) ?? { operation, first: index, members: [] };
      const last = pool.members.at(-1);
      if (last?.object === object) last.pathIndexes.push(pathIndex);
      else pool.members.push({ object, pathIndexes: [pathIndex] });
      pools.set(operation.id, pool);
    });
  });
  const atObject = new Map<number, FillCompound[]>();
  const pooled = new Map<SceneObject, Set<number>>();
  for (const pool of pools.values()) {
    // One object alone already paints what it burns, path by path.
    if (pool.members.length < 2) continue;
    const curves = pool.members.flatMap((member) =>
      parityCurves(
        member.object,
        member.pathIndexes.map((pathIndex) => member.object.paths[pathIndex] as ColoredPath),
      ),
    );
    // Nothing burns (every region is empty): the members' own paths say so as well.
    if (curves.length === 0) continue;
    for (const member of pool.members) {
      const indexes = pooled.get(member.object) ?? new Set<number>();
      for (const pathIndex of member.pathIndexes) indexes.add(pathIndex);
      pooled.set(member.object, indexes);
    }
    const list = atObject.get(pool.first) ?? [];
    list.push({ operation: pool.operation, curves });
    atObject.set(pool.first, list);
  }
  return {
    atObject,
    pooled: (object, pathIndex) => pooled.get(object)?.has(pathIndex) === true,
  };
}

// A 0.03 mm square: a difference this small never shows in a burn.
const PARITY_AREA_TOLERANCE_MM2 = 1e-3;

/** Closed contours whose even-odd parity, pooled with other objects, is this object's own region. */
function parityCurves(
  object: ExportVectorObject,
  paths: ReadonlyArray<ColoredPath>,
): CurveSubpath[] {
  const matrix = svgObjectMatrix(object.transform);
  const exact = paths.flatMap((path) =>
    authoredCurves(path)
      .filter((curve) => curve.closed && curve.segments.length > 0)
      .map((curve) => transformCurveSubpathExact(curve, matrix)),
  );
  if (paths.length === 1 && fillRuleOf(object, paths[0] as ColoredPath) === 'evenodd') return exact;
  const region = resolvedRegion(object, paths);
  const parity = normalizeClosedPolylinesEvenOddChecked(
    paths.flatMap((path) => worldClosedPolylines(object, path)),
  );
  // An engine failure leaves the compiler on these raw contours too (layer-fill.ts).
  if (region === null || parity.kind === 'error') return exact;
  const regionArea = regionAreaMm2(region);
  // Even-odd of all contours always lies inside the object's region, so equal
  // areas mean equal regions.
  if (regionArea - regionAreaMm2(parity.value) <= PARITY_AREA_TOLERANCE_MM2 + regionArea * 1e-9) {
    return exact;
  }
  return region.map((polyline) => polylineToCurveSubpath({ ...polyline, closed: true }));
}

/** Each path by its own rule, then the paths unioned, as layer-fill.ts burns one object. */
function resolvedRegion(
  object: ExportVectorObject,
  paths: ReadonlyArray<ColoredPath>,
): ReadonlyArray<Polyline> | null {
  const batches: Polyline[] = [];
  for (const path of paths) {
    const closed = worldClosedPolylines(object, path);
    const resolved =
      fillRuleOf(object, path) === 'nonzero'
        ? normalizeClosedPolylinesNonZeroChecked(closed)
        : normalizeClosedPolylinesEvenOddChecked(closed);
    if (resolved.kind === 'error') return null;
    batches.push(...resolved.value);
  }
  const union = normalizeClosedPolylinesNonZeroChecked(batches);
  return union.kind === 'ok' ? union.value : null;
}

function worldClosedPolylines(object: ExportVectorObject, path: ColoredPath): Polyline[] {
  return compilationPolylines(path, object.transform)
    .filter((polyline) => polyline.closed)
    .map((polyline) => ({
      closed: true,
      points: polyline.points.map((point) => applyTransform(point, object.transform)),
    }));
}

function regionAreaMm2(contours: ReadonlyArray<Polyline>): number {
  // Normalized contours wind one way for outlines and the other for holes.
  return Math.abs(contours.reduce((sum, contour) => sum + signedAreaMm2(contour.points), 0));
}

function fillRuleOf(object: ExportVectorObject, path: ColoredPath): 'evenodd' | 'nonzero' {
  return path.fillRule ?? (object.kind === 'text' ? 'nonzero' : 'evenodd');
}

function authoredCurves(path: ColoredPath): ReadonlyArray<CurveSubpath> {
  return path.curves ?? path.polylines.map(polylineToCurveSubpath);
}
