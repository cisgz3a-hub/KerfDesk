// White fills in an imported design are the material showing through, not
// paint to burn (ADR-686). A laser cannot "un-burn" an area, so a white shape
// painted over a darker fill becomes a hole in that fill, and the white shape
// itself is left out. SVG paints in document order, so a white shape only
// knocks out the fills painted before it; a darker shape painted after it stays
// whole, and a white background painted first knocks out nothing.
//
// Only white fills are paper, and only beside a darker fill in the same import:
// a design drawn entirely in white (for dark material) keeps burning its shapes.
// Only flat, opaque, unmasked white is paper: a path the parser marked
// `whiteInk` (see-through, a gradient, masked) or the operator chose to burn
// is ink like any colour, so it is a shape a paper white can cut into
// (ADR-686 Amendments 1 and 3).

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
  /** For each changed object, the index each kept path had before (Re-import maps by it). */
  readonly keptPaths: ReadonlyMap<string, ReadonlyArray<number>>;
  /** White shapes left out of the artwork. */
  readonly whiteShapes: number;
  /** Darker shapes a white shape cut into. */
  readonly knockedShapes: number;
};

/** What an import's notice reports about its white shapes. */
export type WhiteKnockout = {
  /** White shapes left unburned (0 when the import only has ink whites). */
  readonly whiteShapes: number;
  /** Import parts that held only white shapes and so are gone. */
  readonly removedObjects: number;
  /** Darker shapes the white shapes were cut out of. */
  readonly knockedShapes: number;
  /** White shapes the file paints as ink (see-through, gradient, masked), which burn. */
  readonly inkWhites: number;
};

export type WhiteFillKnockoutOptions = {
  /** Paths the knock-out leaves alone: neither paper nor a shape to cut into. */
  readonly skip?: (object: ImportedSvg, path: ColoredPath) => boolean;
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
export function knockOutWhiteFills(
  objects: ReadonlyArray<SceneObject>,
  options: WhiteFillKnockoutOptions = {},
): WhiteFillKnockout | null {
  const skip = options.skip;
  const shapes = objects
    .flatMap(fillShapes)
    .filter((shape) => skip === undefined || !skip(shape.object, shape.path));
  const whites: WhiteRegion[] = [];
  let hasDark = false;
  shapes.forEach((shape, order) => {
    if (!isPaperWhite(shape.path)) {
      if (isDarkFill(shape.path)) hasDark = true;
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
    if (isPaperWhite(shape.path)) {
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
  const keptPaths = new Map<string, number[]>();
  for (const [object, paths] of replaced) {
    const kept = paths.filter((path): path is ColoredPath => path !== null);
    if (kept.length === 0) {
      removedIds.add(object.id);
      continue;
    }
    keptPaths.set(
      object.id,
      paths.flatMap((path, index) => (path === null ? [] : [index])),
    );
    changed.set(object.id, {
      ...object,
      paths: kept,
      bounds: boundsForPaths(kept) ?? object.bounds,
    });
  }
  return { changed, removedIds, keptPaths, whiteShapes: whites.length, knockedShapes };
}

/**
 * White fills the import paints as ink, beside a darker fill: the import notice
 * names them, since they burn although they are white (ADR-686 Amendment 1).
 * The operator's own choice to burn white (`kept`) is not counted.
 */
export function countInkWhiteFills(objects: ReadonlyArray<SceneObject>): number {
  const paths = objects.flatMap(fillShapes).map((shape) => shape.path);
  if (!paths.some(isDarkFill)) return 0;
  return paths.filter(
    (path) => isWhiteColor(path) && path.whiteInk !== undefined && path.whiteInk !== 'kept',
  ).length;
}

/**
 * A fill that makes an import more than a white design (Decision 2): any other
 * colour, or a gradient that shades out of white. See-through, masked or kept
 * white is still white paint, so a design for slate drawn only in white keeps
 * burning every shape, highlights included.
 */
export function isDarkFill(path: ColoredPath): boolean {
  return !isWhiteColor(path) || path.whiteInk === 'gradient';
}

/** A fill the knock-out takes for bare material: flat, opaque, unmasked white. */
export function isPaperWhite(path: ColoredPath): boolean {
  return isWhiteColor(path) && path.whiteInk === undefined;
}

// An SVG import's Fill parts, the ones the knock-out reads. A fragment not yet
// placed carries its mode as an operation override instead (svgSourceMode).
function fillShapes(object: SceneObject): FillShape[] {
  if (object.kind !== 'imported-svg') return [];
  if ((object.svgImport?.mode ?? object.operationOverride?.mode) !== 'fill') return [];
  return object.paths.flatMap((path, pathIndex) => {
    const box = pathBox(path);
    return box === null ? [] : [{ object, pathIndex, path, box }];
  });
}

function isWhiteColor(path: ColoredPath): boolean {
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
