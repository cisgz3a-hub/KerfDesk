import {
  applyTransform,
  pathUsesOperation,
  polylineToCurveSubpath,
  type Bounds,
  type ColoredPath,
  type Project,
  type RasterImage,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';
import { err, ok, type Result } from '../../core/result';
import {
  svgCurvePoints,
  svgMatrixAttribute,
  svgNumber,
  svgPathData,
  worldSvgCurves,
  xmlText,
} from './export-svg-paths';

type VectorObject = Extract<SceneObject, { readonly paths: readonly ColoredPath[] }>;
type SvgElement = { readonly markup: string; readonly bounds: Bounds };
export type SvgArtworkExport = { readonly svg: string; readonly objectCount: number };

/** Artwork interchange only: no controller placement, toolpaths or operation side effects. */
export function exportSceneSvg(
  project: Project,
  selectedIds?: readonly string[],
): Result<SvgArtworkExport, string> {
  const selected = selectedIds === undefined ? null : new Set(selectedIds);
  const objects = project.scene.objects.filter(
    (object) => selected === null || selected.has(object.id),
  );
  if (objects.length === 0) return err('There is no artwork to export.');
  const relief = objects.find((object) => object.kind === 'relief');
  if (relief !== undefined)
    return err('SVG cannot contain a 3D relief. Select only vector and image artwork.');
  try {
    const elements = objects.map((object, index) => exportObject(object, index, project));
    const bounds = unionBounds(elements.map((element) => element.bounds));
    const width = Math.max(0.01, bounds.maxX - bounds.minX);
    const height = Math.max(0.01, bounds.maxY - bounds.minY);
    const viewBox = [bounds.minX, bounds.minY, width, height].map(svgNumber).join(' ');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"' +
      ' width="' +
      svgNumber(width) +
      'mm" height="' +
      svgNumber(height) +
      'mm"' +
      ' viewBox="' +
      viewBox +
      '" overflow="visible">\n' +
      '<desc>KerfDesk artwork. Text is outlined; machine settings are not included.</desc>\n' +
      elements.map((element) => element.markup).join('\n') +
      '\n</svg>\n';
    return ok({ svg, objectCount: objects.length });
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

function exportObject(object: SceneObject, index: number, project: Project): SvgElement {
  if (object.kind === 'raster-image') return exportImage(object, index, project);
  if (object.kind === 'relief') throw new Error('A 3D relief cannot be represented in SVG.');
  const elements = object.paths.map((path) => vectorElement(object, path, project));
  if (elements.length === 0) throw new Error('Artwork ' + object.id + ' contains no paths.');
  const title =
    object.kind === 'text'
      ? object.content
      : object.kind === 'shape'
        ? object.spec.kind
        : object.source;
  return {
    markup:
      '<g id="artwork-' +
      index +
      '"><title>' +
      xmlText(title) +
      '</title>' +
      elements.map((element) => element.markup).join('') +
      '</g>',
    bounds: unionBounds(elements.map((element) => element.bounds)),
  };
}

function vectorElement(object: VectorObject, path: ColoredPath, project: Project): SvgElement {
  const curves = path.curves ?? path.polylines.map(polylineToCurveSubpath);
  const transform = ' transform="' + svgMatrixAttribute(object.transform) + '"';
  const operation = project.scene.layers.find((layer) => pathUsesOperation(object, path, layer));
  const fill =
    operation !== undefined && effectiveOperationForObject(operation, object).mode === 'fill';
  const color = xmlText(path.color);
  const fillRule = path.fillRule ?? (object.kind === 'text' ? 'nonzero' : 'evenodd');
  const closed = curves.filter((curve) => curve.closed);
  const open = curves.filter((curve) => !curve.closed);
  const filled =
    fill && closed.length > 0
      ? '<path d="' +
        svgPathData(closed) +
        '"' +
        transform +
        ' fill="' +
        color +
        '" fill-rule="' +
        fillRule +
        '" stroke="none"/>'
      : '';
  const stroked = fill ? open : curves;
  const line =
    stroked.length > 0
      ? '<path d="' +
        svgPathData(stroked) +
        '"' +
        transform +
        ' fill="none" stroke="' +
        color +
        '" stroke-width="0.1" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>'
      : '';
  return {
    markup: filled + line,
    bounds: boundsOfPoints(svgCurvePoints(worldSvgCurves(path, object.transform))),
  };
}

function exportImage(image: RasterImage, index: number, project: Project): SvgElement {
  if (image.imageAsset !== undefined)
    throw new Error('Image source pixels must be loaded before SVG export.');
  if (
    image.dataUrl === undefined ||
    !/^data:image\/(?:png|jpeg|bmp|webp);base64,[a-z0-9+/=\s]+$/i.test(image.dataUrl)
  ) {
    throw new Error('Image ' + image.source + ' needs embedded bitmap pixels for SVG export.');
  }
  const b = image.bounds;
  const clip = imageClip(image, index, project);
  const element =
    '<image x="' +
    svgNumber(b.minX) +
    '" y="' +
    svgNumber(b.minY) +
    '" width="' +
    svgNumber(b.maxX - b.minX) +
    '" height="' +
    svgNumber(b.maxY - b.minY) +
    '" preserveAspectRatio="none" transform="' +
    svgMatrixAttribute(image.transform) +
    '" xlink:href="' +
    xmlText(image.dataUrl) +
    '"/>';
  return {
    markup:
      clip === '' ? element : clip + '<g clip-path="url(#mask-' + index + ')">' + element + '</g>',
    bounds: boundsOfPoints(
      [
        { x: b.minX, y: b.minY },
        { x: b.maxX, y: b.minY },
        { x: b.minX, y: b.maxY },
        { x: b.maxX, y: b.maxY },
      ].map((point) => applyTransform(point, image.transform)),
    ),
  };
}

function imageClip(image: RasterImage, index: number, project: Project): string {
  if (image.imageMaskId === undefined) return '';
  const mask = project.scene.objects.find((object) => object.id === image.imageMaskId);
  if (mask === undefined || !('paths' in mask))
    throw new Error('The image mask is missing or is not vector artwork.');
  const paths = mask.paths
    .map((path) => {
      const curves = (path.curves ?? path.polylines.map(polylineToCurveSubpath)).filter(
        (curve) => curve.closed,
      );
      return (
        '<path d="' +
        svgPathData(curves) +
        '" transform="' +
        svgMatrixAttribute(mask.transform) +
        '" clip-rule="' +
        (path.fillRule ?? (mask.kind === 'text' ? 'nonzero' : 'evenodd')) +
        '"/>'
      );
    })
    .join('');
  return (
    '<defs><clipPath id="mask-' +
    index +
    '" clipPathUnits="userSpaceOnUse">' +
    paths +
    '</clipPath></defs>'
  );
}

function boundsOfPoints(points: Iterable<Vec2>): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const point of points) {
    svgNumber(point.x);
    svgNumber(point.y);
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX)) throw new Error('Artwork contains no exportable points.');
  return { minX, minY, maxX, maxY };
}

function unionBounds(bounds: readonly Bounds[]): Bounds {
  return boundsOfPoints(
    bounds.flatMap((b) => [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.maxY },
    ]),
  );
}
