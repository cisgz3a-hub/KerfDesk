// Which operation an artwork export writes a path under, in which colour, and
// how a Fill operation's objects become the one region they burn (ADR-681).
//
// Colour: LightBurn's model is "colour is the layer", so the file carries one
// colour per operation and distinct operations stay distinct in it.
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

export type ExportColors = {
  /** The colour a path is written in. */
  readonly ofPath: (object: ExportVectorObject, path: ColoredPath) => string;
  /** The colour an operation's paths (and its fill compound) are written in. */
  readonly ofOperation: (operation: Layer) => string;
};

/**
 * One colour per operation in the file. A path keeps its own colour while that
 * colour alone names its operation in this export (an imported SVG's colours,
 * a LightBurn layer), so a re-exported file still looks as authored (ADR-358).
 * An operation whose paths carry several colours, or share one with another
 * operation (shapes drawn in the first operation's colour, Assign selection to
 * operation), is written in the operation's own colour; if that would make two
 * operations share a colour, every operation is. A path on no operation keeps
 * its colour.
 */
export function planExportColors(
  project: Project,
  objects: ReadonlyArray<SceneObject>,
): ExportColors {
  const usage = operationPathColors(project, objects);
  const written = new Map<string, string>();
  for (const [id, { operation, colors }] of usage.byOperation) {
    const [only, ...others] = colors;
    const keeps = only !== undefined && others.length === 0 && usage.sharers(only[0]) === 1;
    written.set(id, keeps ? only[1] : operation.color);
  }
  const distinct = new Set([...written.values()].map((color) => color.toLowerCase()));
  if (distinct.size < written.size) {
    for (const [id, { operation }] of usage.byOperation) written.set(id, operation.color);
  }
  const ofOperation = (operation: Layer): string => written.get(operation.id) ?? operation.color;
  return {
    ofOperation,
    ofPath: (object, path) => {
      const operation = exportOperationForPath(project, object, path);
      return operation === undefined ? path.color : ofOperation(operation);
    },
  };
}

type ColorUsage = {
  /** Each exported operation with its paths' colours, keyed lower-case, as first written. */
  readonly byOperation: ReadonlyMap<
    string,
    { readonly operation: Layer; readonly colors: Array<[string, string]> }
  >;
  /** How many operations have paths in this lower-case colour. */
  readonly sharers: (color: string) => number;
};

function operationPathColors(project: Project, objects: ReadonlyArray<SceneObject>): ColorUsage {
  const byOperation = new Map<
    string,
    { readonly operation: Layer; readonly colors: Array<[string, string]> }
  >();
  const operationsByColor = new Map<string, Set<string>>();
  for (const object of objects) {
    if (object.kind === 'raster-image' || object.kind === 'relief' || !('paths' in object))
      continue;
    for (const path of object.paths) {
      const operation = exportOperationForPath(project, object, path);
      if (operation === undefined) continue;
      const key = path.color.toLowerCase();
      const entry = byOperation.get(operation.id) ?? { operation, colors: [] };
      if (!entry.colors.some(([seen]) => seen === key)) entry.colors.push([key, path.color]);
      byOperation.set(operation.id, entry);
      operationsByColor.set(key, (operationsByColor.get(key) ?? new Set()).add(operation.id));
    }
  }
  return { byOperation, sharers: (color) => operationsByColor.get(color)?.size ?? 0 };
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
