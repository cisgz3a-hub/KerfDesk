// White fills in an imported design are the material showing through, not
// paint to burn (ADR-686). A laser cannot "un-burn" an area, so a white shape
// painted over a darker fill becomes a hole in that fill, and the white shape
// itself is left out. SVG paints in document order, so a white shape only
// knocks out the fills painted before it; a darker shape painted after it stays
// whole, and a white background painted first knocks out nothing.
//
// Only white fills are paper, and only beside a darker fill in the same import:
// a design drawn entirely in white (for dark material) keeps burning its shapes.

import { differenceD, FillRule, intersectD, type PathsD } from 'clipper2-ts';
import { IDENTITY_TRANSFORM, type ColoredPath, type ImportedSvg } from '../scene/scene-object';
import type { SceneObject, Transform } from '../scene';
import { canonicalizeVectorPaths } from './vector-path-canonical';
import {
  normalizeVectorObjectRegion,
  unionNormalizedRegions,
  VECTOR_PATH_PRECISION_DECIMALS,
} from './vector-path-regions';
import { boundsForPaths, pathDToPolyline, tryVectorOp } from './vector-path-tools';

export const KNOCKOUT_WHITE = '#ffffff';

export type WhiteFillKnockout = {
  /** The import's objects that changed, by id. */
  readonly changed: ReadonlyMap<string, ImportedSvg>;
  /** Objects left with no paths once their white shapes are out. */
  readonly removedIds: ReadonlySet<string>;
  /** White shapes left out of the artwork. */
  readonly whiteShapes: number;
  /** Darker shapes a white shape cut into. */
  readonly knockedShapes: number;
};

/** What an import's notice reports about its white shapes. */
export type WhiteKnockout = {
  /** White shapes left unburned. */
  readonly whiteShapes: number;
  /** Import parts that held only white shapes and so are gone. */
  readonly removedObjects: number;
};

type Box = { minX: number; minY: number; maxX: number; maxY: number };

type FillShape = {
  readonly object: ImportedSvg;
  readonly pathIndex: number;
  readonly path: ColoredPath;
  readonly box: Box;
};

type WhiteRegion = { readonly order: number; readonly shape: FillShape; readonly region: PathsD };

/**
 * Knock the white fills of one import out of the fills painted before them.
 * `objects` is the import in paint order. Null when the import has no white
 * fill beside a darker one, so nothing changes.
 */
export function knockOutWhiteFills(objects: ReadonlyArray<SceneObject>): WhiteFillKnockout | null {
  const shapes = objects.flatMap(fillShapes);
  const whites: WhiteRegion[] = [];
  let hasDark = false;
  shapes.forEach((shape, order) => {
    if (!isWhite(shape.path)) {
      hasDark = true;
      return;
    }
    // A white shape that cannot form an area is still paper: it is left out
    // and simply cuts nothing.
    const region = shapeRegion(shape);
    whites.push({ order, shape, region: region ?? [] });
  });
  if (whites.length === 0 || !hasDark) return null;

  const replaced = new Map<ImportedSvg, (ColoredPath | null)[]>();
  const pathsOf = (object: ImportedSvg): (ColoredPath | null)[] => {
    const existing = replaced.get(object);
    if (existing !== undefined) return existing;
    const created: (ColoredPath | null)[] = [...object.paths];
    replaced.set(object, created);
    return created;
  };
  let knockedShapes = 0;
  shapes.forEach((shape, order) => {
    if (isWhite(shape.path)) {
      pathsOf(shape.object)[shape.pathIndex] = null;
      return;
    }
    const above = whites.filter(
      (white) =>
        white.order > order &&
        white.region.length > 0 &&
        sameTransform(white.shape.object.transform, shape.object.transform) &&
        boxesOverlap(white.shape.box, shape.box),
    );
    if (above.length === 0) return;
    const knocked = knockOut(shape, above);
    if (knocked === undefined) return;
    knockedShapes += 1;
    pathsOf(shape.object)[shape.pathIndex] = knocked;
  });

  const changed = new Map<string, ImportedSvg>();
  const removedIds = new Set<string>();
  for (const [object, paths] of replaced) {
    const kept = paths.filter((path): path is ColoredPath => path !== null);
    if (kept.length === 0) {
      removedIds.add(object.id);
      continue;
    }
    changed.set(object.id, {
      ...object,
      paths: kept,
      bounds: boundsForPaths(kept) ?? object.bounds,
    });
  }
  return { changed, removedIds, whiteShapes: whites.length, knockedShapes };
}

function fillShapes(object: SceneObject): FillShape[] {
  if (object.kind !== 'imported-svg' || object.svgImport?.mode !== 'fill') return [];
  return object.paths.flatMap((path, pathIndex) => {
    const box = pathBox(path);
    return box === null ? [] : [{ object, pathIndex, path, box }];
  });
}

function isWhite(path: ColoredPath): boolean {
  return path.color.toLowerCase() === KNOCKOUT_WHITE;
}

/**
 * The darker shape less every white region painted over it; undefined when
 * no white region actually covers part of it, so it keeps its exact curves.
 */
function knockOut(
  shape: FillShape,
  whites: ReadonlyArray<WhiteRegion>,
): ColoredPath | null | undefined {
  const subject = shapeRegion(shape);
  if (subject === null) return undefined;
  const clip = unionNormalizedRegions(whites.map((white) => white.region));
  if (clip.kind === 'error') return undefined;
  const result = tryVectorOp(() => {
    const overlap = intersectD(
      subject,
      clip.value,
      FillRule.NonZero,
      VECTOR_PATH_PRECISION_DECIMALS,
    );
    if (overlap.length === 0) return undefined;
    return canonicalizeVectorPaths(
      differenceD(subject, clip.value, FillRule.NonZero, VECTOR_PATH_PRECISION_DECIMALS),
    );
  });
  if (result.kind === 'error' || result.value === undefined) return undefined;
  if (result.value.length === 0) return null;
  // The difference's rings never cross, so even-odd and the engine's ring
  // directions agree; even-odd also holds if a later edit reverses one.
  const { curves: _curves, subpathNesting: _nesting, ...rest } = shape.path;
  return { ...rest, fillRule: 'evenodd', polylines: result.value.map(pathDToPolyline) };
}

// One path in its object's own coordinates: every vector part of one import
// shares the import's placement, so regions compare without baking it in.
function shapeRegion(shape: FillShape): PathsD | null {
  const local: ImportedSvg = {
    kind: 'imported-svg',
    id: shape.object.id,
    source: shape.object.source,
    bounds: shape.object.bounds,
    transform: IDENTITY_TRANSFORM,
    paths: [shape.path],
  };
  const region = normalizeVectorObjectRegion(local);
  return region.kind === 'ok' && region.value.length > 0 ? region.value : null;
}

function pathBox(path: ColoredPath): Box | null {
  const bounds = boundsForPaths([path]);
  return bounds === null ? null : { ...bounds };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

function sameTransform(a: Transform, b: Transform): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.scaleX === b.scaleX &&
    a.scaleY === b.scaleY &&
    a.rotationDeg === b.rotationDeg &&
    a.mirrorX === b.mirrorX &&
    a.mirrorY === b.mirrorY
  );
}
