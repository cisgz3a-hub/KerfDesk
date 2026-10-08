import { FillRule, intersectD } from 'clipper2-ts';
import { polylineToCurveSubpath, type Bounds, type ColoredPath } from '../../core/scene';
import { svgClipRegion } from './svg-clip-region';
import {
  resolveSvgClip,
  type ResolvedSvgClip,
  type SvgClipResolver,
  type SvgClipShape,
} from './svg-clip-resolve';
import { applySvgMatrix, transformSvgCurveSubpath, type SvgMatrix } from './svg-curve-transform';
import { embeddedBitmapSize } from './svg-embedded-bitmap-size';
import type { SvgImageDescriptor } from './svg-import-fragment';
import type { SvgImageSkipReason } from './svg-import-notes';
import type { PresentationState, SvgClipReference } from './svg-presentation';
import { inverseSvgMatrix, svgMatrixToSceneTransform } from './svg-scene-transform';
import { multiplySvgMatrix } from './svg-transform-attribute';
import { parseSvgLengthUserUnitsOrNull } from './svg-units';
import { parsePreserveAspectRatio, viewBoxMatrix, type SvgRect } from './svg-viewport';
import { assertSvgImportPoints } from './svg-import-budget';
import { elementToSubPaths } from './shape-to-polylines';
import { linearScaleMagnitude } from './transform-scale';

export type SvgImageSkip = { readonly kind: 'skipped-image'; readonly reason: SvgImageSkipReason };

const BITMAP_DATA_URL = /^data:image\/(?:png|jpeg|bmp|webp);base64,[a-z0-9+/=\s]+$/i;
// An exporter that sizes the box from a rounded pixel or physical size misses
// the bitmap's aspect ratio by far less than this; within it, a meet or slice
// fit moves or crops no more than 0.05% of the box on each side, so the image
// fills its box as preserveAspectRatio="none" places it.
const ASPECT_TOLERANCE = 1e-3;

// ADR-358 Amendment 3: an image KerfDesk cannot place faithfully is left out
// with its reason, and the rest of the file imports.
export function svgImageElement(
  element: Element,
  state: PresentationState,
  clipResolver: SvgClipResolver,
  identity: { readonly id: string; readonly source: string },
): SvgImageDescriptor | SvgImageSkip {
  const dataUrl = element.getAttribute('href') ?? element.getAttribute('xlink:href');
  // Sanitized external references remain a disclosed omission, never a fetch.
  if (dataUrl === null || dataUrl === '') return skipped('no-data');
  if (!BITMAP_DATA_URL.test(dataUrl)) return skipped('format');
  if (state.opacity !== 1 || state.unsupportedEffects.length > 0) return skipped('effects');
  const box = imageBox(element);
  if (box === null) return skipped('size');
  const bounds = fittedBounds(box, element.getAttribute('preserveAspectRatio'), dataUrl);
  if (bounds === null) return skipped('fit');
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.maxY },
  ];
  assertSvgImportPoints([
    ...corners,
    ...corners.map((point) => applySvgMatrix(state.transform, point)),
  ]);
  // With finite coordinates proven above, the scene transform can only refuse
  // a skewed or collapsed matrix, which a raster object cannot represent.
  let transform: SvgImageDescriptor['transform'];
  try {
    transform = svgMatrixToSceneTransform(state.transform);
  } catch {
    return skipped('shear');
  }
  const imageClip = imageClips(state.clips, state.transform, clipResolver);
  return {
    kind: 'svg-image',
    ...identity,
    dataUrl,
    bounds,
    transform,
    ...(imageClip === undefined ? {} : { imageClip }),
  };
}

function skipped(reason: SvgImageSkipReason): SvgImageSkip {
  return { kind: 'skipped-image', reason };
}

// x and y default to 0; width and height have no usable default here (SVG 2's
// auto sizing from the bitmap is not implemented), and zero renders nothing.
function imageBox(element: Element): SvgRect | null {
  const x = length(element, 'x', 0);
  const y = length(element, 'y', 0);
  const width = length(element, 'width');
  const height = length(element, 'height');
  if (x === null || y === null || width === null || height === null) return null;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function length(element: Element, name: string, fallback?: number): number | null {
  const raw = element.getAttribute(name);
  if (raw === null && fallback !== undefined) return fallback;
  return parseSvgLengthUserUnitsOrNull(raw);
}

// preserveAspectRatio places the bitmap inside its box (SVG 2 embedded.html,
// the image element). It changes nothing when the bitmap already has the box's
// aspect ratio. Otherwise meet scales it uniformly to fit and aligns it, which
// the bounds express exactly; slice would crop it to the box, which a raster
// object cannot express, so it is skipped.
function fittedBounds(box: SvgRect, aspectValue: string | null, dataUrl: string): Bounds | null {
  const full = { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height };
  const aspect = parsePreserveAspectRatio(aspectValue);
  if (aspect.align === 'none') return full;
  const size = embeddedBitmapSize(dataUrl);
  if (size === null) return null;
  const mismatch = (box.width * size.height) / (box.height * size.width);
  if (Math.abs(mismatch - 1) <= ASPECT_TOLERANCE) return full;
  if (aspect.slice) return null;
  const bitmap = { x: 0, y: 0, width: size.width, height: size.height };
  const fit = viewBoxMatrix(bitmap, box, aspect);
  return {
    minX: fit.e,
    minY: fit.f,
    maxX: fit.e + size.width * fit.a,
    maxY: fit.f + size.height * fit.d,
  };
}

function imageClips(
  references: readonly SvgClipReference[],
  imageMatrix: SvgMatrix,
  clipResolver: SvgClipResolver,
): readonly ColoredPath[] | undefined {
  if (references.length === 0) return undefined;
  const inverse = inverseSvgMatrix(imageMatrix);
  let paths: readonly ColoredPath[] | undefined;
  for (const reference of references) {
    const next = clipPaths(resolveSvgClip(reference, clipResolver), inverse);
    paths = paths === undefined ? next : intersectClips(paths, next);
  }
  return paths;
}

// KerfDesk's exporter writes one compound even-odd path per clip; it keeps its
// native curves. Any other clip (SVG's default nonzero rule, basic shapes,
// several shapes, <use>, objectBoundingBox units or nested clips) owns its
// region, flattened at the machine curve tolerance (ADR-358 Amendment 2).
function clipPaths(clip: ResolvedSvgClip, inverse: SvgMatrix): readonly ColoredPath[] {
  const path = compoundEvenOddPath(clip);
  if (path !== null) return [nativeClipPath(path, inverse)];
  const polylines = svgClipRegion([clip]).paths.map((ring) => {
    const points = ring.map((point) => applySvgMatrix(inverse, point));
    assertSvgImportPoints(points);
    return { points, closed: true };
  });
  if (polylines.length === 0) return [];
  return [
    {
      color: '#000000',
      fillRule: 'evenodd',
      polylines,
      curves: polylines.map(polylineToCurveSubpath),
    },
  ];
}

function compoundEvenOddPath(clip: ResolvedSvgClip): SvgClipShape | null {
  const shape = clip.shapes.length === 1 && clip.clips.length === 0 ? clip.shapes[0] : undefined;
  if (shape === undefined || shape.clips.length > 0 || shape.rule !== 'evenodd') return null;
  return shape.element.tagName.toLowerCase() === 'path' ? shape : null;
}

function nativeClipPath(shape: SvgClipShape, inverse: SvgMatrix): ColoredPath {
  const world = shape.matrix;
  const local = multiplySvgMatrix(inverse, world);
  const subpaths = elementToSubPaths(
    shape.element,
    linearScaleMagnitude(world.a, world.b, world.c, world.d),
    shape.viewport,
  );
  const polylines = subpaths.map((subpath) => {
    const points = subpath.points.map((point) => applySvgMatrix(local, point));
    assertSvgImportPoints(points);
    return { points, closed: true };
  });
  return {
    color: '#000000',
    fillRule: 'evenodd',
    polylines,
    curves: subpaths.map((subpath, index) =>
      subpath.curve === undefined
        ? polylineToCurveSubpath(polylines[index] ?? { points: [], closed: true })
        : { ...transformSvgCurveSubpath(subpath.curve, local), closed: true },
    ),
  };
}

function intersectClips(
  left: readonly ColoredPath[],
  right: readonly ColoredPath[],
): readonly ColoredPath[] {
  const rings = (paths: readonly ColoredPath[]) =>
    paths.flatMap((path) => path.polylines.map((line) => [...line.points]));
  const polylines = intersectD(rings(left), rings(right), FillRule.EvenOdd, 6).map((points) => ({
    points,
    closed: true,
  }));
  return [
    {
      color: '#000000',
      fillRule: 'evenodd',
      polylines,
      curves: polylines.map(polylineToCurveSubpath),
    },
  ];
}
