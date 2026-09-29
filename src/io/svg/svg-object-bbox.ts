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
import { svgRenderedChildren } from './svg-conditional-processing';
import type { SvgIdResolver } from './svg-id-resolver';
import { numAttr, svgPresentationStyles } from './svg-presentation';
import type { SvgStyleCascade } from './svg-stylesheet';
import {
  multiplySvgMatrix,
  parseSvgTransform,
  translateSvgMatrix,
} from './svg-transform-attribute';
import { parseSvgLengthUserUnitsOrNull } from './svg-units';
import {
  createSvgUseBudget,
  spendSvgUseElement,
  svgUseTarget,
  type SvgUseBudget,
} from './svg-use-expansion';
import {
  svgViewportAt,
  svgViewportTransform,
  viewportLength,
  type SvgViewportSize,
} from './svg-viewport';
import { linearScaleMagnitude } from './transform-scale';

const IDENTITY: SvgMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
// Matches the importer's walk: these never render in place.
const NOT_RENDERED = new Set(['defs', 'symbol', 'clippath', 'mask', 'marker', 'pattern']);
const MAX_DEPTH = 256;

type Context = {
  readonly resolveId: SvgIdResolver;
  readonly cascade: SvgStyleCascade;
  /** Elements being measured through, so a circular <use> is left out as in the walk. */
  readonly active: Set<Element>;
  readonly budget: SvgUseBudget;
};
type Box = { minX: number; minY: number; maxX: number; maxY: number };
/** A user space: its matrix, and the viewport its percentages resolve against. */
type Space = { readonly matrix: SvgMatrix; readonly viewport: SvgViewportSize };
type UseSize = { readonly width: number | null; readonly height: number | null };

export function svgObjectBoundingBox(
  element: Element,
  resolveId: SvgIdResolver,
  cascade: SvgStyleCascade,
): Bounds | null {
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const active = new Set<Element>();
  for (let at = element.parentElement; at !== null; at = at.parentElement) active.add(at);
  const budget = createSvgUseBudget(element.ownerDocument.documentElement);
  const space = { matrix: IDENTITY, viewport: svgViewportAt(element) };
  contentBounds(element, space, { resolveId, cascade, active, budget }, box, 0);
  return Number.isFinite(box.minX) && Number.isFinite(box.minY) ? box : null;
}

// The element's own content in `space`; its own transform is the caller's.
function contentBounds(
  element: Element,
  space: Space,
  context: Context,
  box: Box,
  depth: number,
): void {
  if (depth > MAX_DEPTH) return;
  if (context.budget.nesting > 0) spendSvgUseElement(context.budget);
  const tag = element.tagName.toLowerCase();
  if (SHAPES.has(tag)) shapeBounds(element, space.matrix, box);
  else if (tag === 'image') imageBounds(element, space.matrix, box);
  else if (tag === 'use') boundsOfUse(element, space, context, box, depth);
  else if (tag === 'svg' && element !== element.ownerDocument.documentElement) {
    viewportBounds(element, space, context, box, depth, { width: null, height: null });
  } else if (tag !== 'text') childrenBounds(element, space, context, box, depth);
}

function childrenBounds(
  element: Element,
  space: Space,
  context: Context,
  box: Box,
  depth: number,
): void {
  context.active.add(element);
  for (const child of svgRenderedChildren(element)) {
    if (NOT_RENDERED.has(child.tagName.toLowerCase())) continue;
    const placed = elementSpace(child, space, context);
    if (placed !== null) contentBounds(child, placed, context, box, depth + 1);
  }
  context.active.delete(element);
}

// `space` with the element's transform applied; null when it is not displayed.
function elementSpace(element: Element, space: Space, context: Context): Space | null {
  const styles = svgPresentationStyles(element, context.cascade);
  if ((styles.get('display') ?? element.getAttribute('display'))?.trim() === 'none') return null;
  const transform = parseSvgTransform(styles.get('transform') ?? element.getAttribute('transform'));
  return { ...space, matrix: multiplySvgMatrix(space.matrix, transform) };
}

// A nested <svg>, or the <symbol> or <svg> a <use> instantiates, maps its
// content into its viewport (the importer's walk does the same).
function viewportBounds(
  element: Element,
  space: Space,
  context: Context,
  box: Box,
  depth: number,
  size: UseSize,
): void {
  const viewport = svgViewportTransform(element, space.viewport, size);
  if (viewport === null) return;
  const content = {
    matrix: multiplySvgMatrix(space.matrix, viewport.matrix),
    viewport: viewport.viewport,
  };
  childrenBounds(element, content, context, box, depth);
}

function boundsOfUse(use: Element, space: Space, context: Context, box: Box, depth: number): void {
  const target = svgUseTarget(use, context.resolveId, context.active);
  if (target === null || target === 'circular') return;
  const placed = {
    ...space,
    matrix: multiplySvgMatrix(
      space.matrix,
      translateSvgMatrix(numAttr(use, 'x'), numAttr(use, 'y')),
    ),
  };
  const size = {
    width: viewportLength(use, 'width', space.viewport.width),
    height: viewportLength(use, 'height', space.viewport.height),
  };
  context.active.add(use);
  context.budget.nesting += 1;
  instanceBounds(target, placed, context, box, { depth: depth + 1, size });
  context.budget.nesting -= 1;
  context.active.delete(use);
}

function instanceBounds(
  target: Element,
  placed: Space,
  context: Context,
  box: Box,
  at: { readonly depth: number; readonly size: UseSize },
): void {
  const tag = target.tagName.toLowerCase();
  if (tag === 'defs' || tag === 'symbol' || tag === 'svg') {
    spendSvgUseElement(context.budget);
    const own = tag === 'svg' ? elementSpace(target, placed, context) : placed;
    if (own === null) return;
    if (tag === 'defs') childrenBounds(target, own, context, box, at.depth);
    else viewportBounds(target, own, context, box, at.depth, at.size);
  } else if (!NOT_RENDERED.has(tag)) {
    const own = elementSpace(target, placed, context);
    if (own !== null) contentBounds(target, own, context, box, at.depth);
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
