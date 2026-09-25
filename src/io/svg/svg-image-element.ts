import { FillRule, intersectD } from 'clipper2-ts';
import { polylineToCurveSubpath, type ColoredPath } from '../../core/scene';
import { applySvgMatrix, transformSvgCurveSubpath, type SvgMatrix } from './svg-curve-transform';
import type { SvgIdResolver } from './svg-id-resolver';
import type { SvgImageDescriptor } from './svg-import-fragment';
import type { PresentationState, SvgClipReference } from './svg-presentation';
import { inverseSvgMatrix, svgMatrixToSceneTransform } from './svg-scene-transform';
import { multiplySvgMatrix, parseSvgTransform } from './svg-transform-attribute';
import { parseSvgLengthUserUnitsOrNull } from './svg-units';
import { assertSvgImportPoints } from './svg-import-budget';
import { elementToSubPaths } from './shape-to-polylines';
import { linearScaleMagnitude } from './transform-scale';

export function svgImageElement(
  element: Element,
  state: PresentationState,
  resolveId: SvgIdResolver,
  identity: { readonly id: string; readonly source: string },
): SvgImageDescriptor | null {
  const dataUrl = element.getAttribute('href') ?? element.getAttribute('xlink:href');
  // Sanitized external references remain a disclosed omission, never a fetch.
  if (dataUrl === null || dataUrl === '') return null;
  validateImagePresentation(element, state, dataUrl);
  const x = length(element, 'x', 0);
  const y = length(element, 'y', 0);
  const width = length(element, 'width');
  const height = length(element, 'height');
  if (width <= 0 || height <= 0) throw new Error('SVG image dimensions must be positive.');
  const bounds = { minX: x, minY: y, maxX: x + width, maxY: y + height };
  assertSvgImportPoints([
    { x, y },
    { x: x + width, y: y + height },
    ...[
      { x, y },
      { x: x + width, y },
      { x, y: y + height },
      { x: x + width, y: y + height },
    ].map((point) => applySvgMatrix(state.transform, point)),
  ]);
  const imageClip = imageClips(state.clips, state.transform, resolveId);
  return {
    kind: 'svg-image',
    ...identity,
    dataUrl,
    bounds,
    transform: svgMatrixToSceneTransform(state.transform),
    ...(imageClip === undefined ? {} : { imageClip }),
  };
}

function length(element: Element, name: string, fallback?: number): number {
  const raw = element.getAttribute(name);
  if (raw === null && fallback !== undefined) return fallback;
  const value = parseSvgLengthUserUnitsOrNull(raw);
  if (value === null) throw new Error('SVG image ' + name + ' must be an absolute length.');
  return value;
}

function imageClips(
  references: readonly SvgClipReference[],
  imageMatrix: SvgMatrix,
  resolveId: SvgIdResolver,
): readonly ColoredPath[] | undefined {
  if (references.length === 0) return undefined;
  const inverse = inverseSvgMatrix(imageMatrix);
  let paths: readonly ColoredPath[] | undefined;
  for (const reference of references) {
    const next = clipPaths(reference, inverse, resolveId);
    paths = paths === undefined ? next : intersectClips(paths, next);
  }
  return paths;
}

function clipPaths(
  reference: SvgClipReference,
  inverse: SvgMatrix,
  resolveId: SvgIdResolver,
): readonly ColoredPath[] {
  const { clip, path } = clipShape(reference, resolveId);
  if (path === undefined) return [];
  const world = multiplySvgMatrix(
    multiplySvgMatrix(reference.transform, parseSvgTransform(clip.getAttribute('transform'))),
    parseSvgTransform(path.getAttribute('transform')),
  );
  const local = multiplySvgMatrix(inverse, world);
  const subpaths = elementToSubPaths(
    path,
    linearScaleMagnitude(world.a, world.b, world.c, world.d),
  );
  const polylines = subpaths.map((subpath) => {
    const points = subpath.points.map((point) => applySvgMatrix(local, point));
    assertSvgImportPoints(points);
    return { points, closed: true };
  });
  return [
    {
      color: '#000000',
      fillRule: 'evenodd',
      polylines,
      curves: subpaths.map((subpath, index) =>
        subpath.curve === undefined
          ? polylineToCurveSubpath(polylines[index] ?? { points: [], closed: true })
          : { ...transformSvgCurveSubpath(subpath.curve, local), closed: true },
      ),
    },
  ];
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

function validateImagePresentation(
  element: Element,
  state: PresentationState,
  dataUrl: string,
): void {
  if (!/^data:image\/(?:png|jpeg|bmp|webp);base64,[a-z0-9+/=\s]+$/i.test(dataUrl))
    throw new Error('SVG images must embed PNG, JPEG, BMP or WebP bitmap data.');
  if (state.opacity !== 1 || state.unsupportedEffects.length > 0)
    throw new Error(
      'SVG image opacity, filters and SVG masks are not supported; use an opaque image with a clip path.',
    );
  const aspect = element.getAttribute('preserveAspectRatio')?.trim() ?? 'xMidYMid meet';
  if (aspect !== 'none')
    throw new Error(
      'SVG image aspect fitting is not supported. Export the image with preserveAspectRatio="none".',
    );
}

function clipShape(
  reference: SvgClipReference,
  resolveId: SvgIdResolver,
): { clip: Element; path: Element | undefined } {
  const clip = resolveId(reference.id);
  if (clip === null || clip.tagName.toLowerCase() !== 'clippath')
    throw new Error('SVG image clip path is missing: ' + reference.id);
  if (clip.getAttribute('clipPathUnits') !== 'userSpaceOnUse')
    throw new Error('Only userSpaceOnUse SVG image clips are supported.');
  const children = Array.from(clip.children).filter(
    (child) => !['title', 'desc'].includes(child.tagName.toLowerCase()),
  );
  if (children.length === 0) return { clip, path: undefined };
  if (children.length !== 1 || children[0]?.tagName.toLowerCase() !== 'path')
    throw new Error('SVG image clips must contain one compound path.');
  const path = children[0];
  validateClipRule(clip, path);
  return { clip, path };
}

function validateClipRule(clip: Element, path: Element): void {
  const rule = path.getAttribute('clip-rule') ?? clip.getAttribute('clip-rule') ?? 'nonzero';
  if (rule !== 'evenodd') throw new Error('Only even-odd SVG image clips are supported.');
  if (path.hasAttribute('clip-path') || clip.hasAttribute('clip-path'))
    throw new Error('A clip inside an SVG clip definition is not supported.');
}
