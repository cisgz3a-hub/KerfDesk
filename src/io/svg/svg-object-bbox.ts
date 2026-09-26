// Object bounding box of an SVG element in its own user space: the box that
// clipPathUnits="objectBoundingBox" maps its 0..1 coordinates onto (SVG 1.1
// §14.3.5, §7.11). It is the geometry of the element and its rendered
// descendants, before any stroke, clip or effect. Native curves contribute
// their exact extrema; circles and ellipses use the importer's inscribed
// outlines, so their box is at most that outline's chord tolerance small.
// Text is not measured, because the importer cannot outline it.

import { curveSubpathBounds, type Bounds, type Vec2 } from '../../core/scene';
import { elementToSubPaths } from './shape-to-polylines';
import { applySvgMatrix, transformSvgCurveSubpath, type SvgMatrix } from './svg-curve-transform';
import type { SvgIdResolver } from './svg-id-resolver';
import { numAttr, svgPresentationStyles } from './svg-presentation';
import type { SvgStyleCascade } from './svg-stylesheet';
import {
  multiplySvgMatrix,
  parseSvgTransform,
  translateSvgMatrix,
} from './svg-transform-attribute';
import { parseSvgLengthUserUnitsOrNull } from './svg-units';
import { linearScaleMagnitude } from './transform-scale';

const IDENTITY: SvgMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
// Matches the importer's walk: these never render in place.
const NOT_RENDERED = new Set(['defs', 'symbol', 'clippath', 'mask', 'marker', 'pattern']);
const MAX_DEPTH = 256;

type Context = { readonly resolveId: SvgIdResolver; readonly cascade: SvgStyleCascade };
type Box = { minX: number; minY: number; maxX: number; maxY: number };

export function svgObjectBoundingBox(
  element: Element,
  resolveId: SvgIdResolver,
  cascade: SvgStyleCascade,
): Bounds | null {
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  contentBounds(element, IDENTITY, { resolveId, cascade }, box, 0);
  return Number.isFinite(box.minX) && Number.isFinite(box.minY) ? box : null;
}

// The element's own content under `matrix`; its own transform is the caller's.
function contentBounds(
  element: Element,
  matrix: SvgMatrix,
  context: Context,
  box: Box,
  depth: number,
): void {
  if (depth > MAX_DEPTH) return;
  const tag = element.tagName.toLowerCase();
  if (SHAPES.has(tag)) shapeBounds(element, matrix, box);
  else if (tag === 'image') imageBounds(element, matrix, box);
  else if (tag === 'use') boundsOfUse(element, matrix, context, box, depth);
  else if (tag !== 'text') {
    for (const child of Array.from(element.children)) {
      childBounds(child, matrix, context, box, depth + 1);
    }
  }
}

function childBounds(
  child: Element,
  matrix: SvgMatrix,
  context: Context,
  box: Box,
  depth: number,
): void {
  if (NOT_RENDERED.has(child.tagName.toLowerCase())) return;
  const styles = svgPresentationStyles(child, context.cascade);
  if ((styles.get('display') ?? child.getAttribute('display'))?.trim() === 'none') return;
  const transform = parseSvgTransform(styles.get('transform') ?? child.getAttribute('transform'));
  contentBounds(child, multiplySvgMatrix(matrix, transform), context, box, depth);
}

function boundsOfUse(
  use: Element,
  matrix: SvgMatrix,
  context: Context,
  box: Box,
  depth: number,
): void {
  const href = use.getAttribute('href') ?? use.getAttribute('xlink:href');
  const target = href?.startsWith('#') === true ? context.resolveId(href.slice(1)) : null;
  if (target === null || target === use) return;
  const placed = multiplySvgMatrix(
    matrix,
    translateSvgMatrix(numAttr(use, 'x'), numAttr(use, 'y')),
  );
  const tag = target.tagName.toLowerCase();
  if (tag !== 'symbol' && tag !== 'defs') {
    childBounds(target, placed, context, box, depth + 1);
    return;
  }
  for (const child of Array.from(target.children)) {
    childBounds(child, placed, context, box, depth + 1);
  }
}

function shapeBounds(element: Element, matrix: SvgMatrix, box: Box): void {
  const scale = linearScaleMagnitude(matrix.a, matrix.b, matrix.c, matrix.d);
  for (const subpath of elementToSubPaths(element, scale)) {
    if (subpath.curve === undefined) {
      for (const point of subpath.points) include(box, applySvgMatrix(matrix, point));
      continue;
    }
    const bounds = curveSubpathBounds(transformSvgCurveSubpath(subpath.curve, matrix));
    include(box, { x: bounds.minX, y: bounds.minY });
    include(box, { x: bounds.maxX, y: bounds.maxY });
  }
}

function imageBounds(element: Element, matrix: SvgMatrix, box: Box): void {
  const length = (name: string) => parseSvgLengthUserUnitsOrNull(element.getAttribute(name)) ?? 0;
  const x = length('x');
  const y = length('y');
  const width = length('width');
  const height = length('height');
  if (width <= 0 || height <= 0) return;
  for (const corner of [
    { x, y },
    { x: x + width, y },
    { x, y: y + height },
    { x: x + width, y: y + height },
  ]) {
    include(box, applySvgMatrix(matrix, corner));
  }
}

function include(box: Box, point: Vec2): void {
  box.minX = Math.min(box.minX, point.x);
  box.minY = Math.min(box.minY, point.y);
  box.maxX = Math.max(box.maxX, point.x);
  box.maxY = Math.max(box.maxY, point.y);
}
