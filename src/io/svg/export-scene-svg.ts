import {
  applyTransform,
  isClosedEnough,
  polylineToCurveSubpath,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type Project,
  type RasterImage,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { CLOSURE_EPS_MM } from '../../core/scene/polyline-closure';
import { err, ok, type Result } from '../../core/result';
import {
  DEFAULT_EXPORT_PRECISION_MM,
  decimalGridAtMost,
  formatGridIndex,
  outwardGridIndices,
} from '../../core/vector-export/decimal-grid';
import { formatSvgPathData } from '../../core/vector-export/svg-path-data';
import { svgMatrixAttribute, svgNumber, xmlText } from './export-svg-paths';
import { vectorPathElement, type SvgVectorOptions } from './export-svg-vector';

const MIN_PAGE_EXTENT_MM = 0.01;

type SvgElement = { readonly markup: string; readonly bounds: Bounds };
export type SvgArtworkExport = { readonly svg: string; readonly objectCount: number };

export type SceneSvgExportOptions = {
  /**
   * World-millimetre coordinate grid (default 0.001 mm). No written point
   * moves by more than half a grid diagonal. `null` keeps every coordinate
   * exactly as stored.
   */
  readonly precisionMm?: number | null;
  /** Put each outer contour and its direct holes in their own `<g>`. */
  readonly groupContours?: boolean;
};

/** Artwork interchange only: no controller placement, toolpaths or operation side effects. */
export function exportSceneSvg(
  project: Project,
  selectedIds?: readonly string[],
  exportOptions: SceneSvgExportOptions = {},
): Result<SvgArtworkExport, string> {
  const options: SvgVectorOptions = {
    precisionMm:
      exportOptions.precisionMm === undefined
        ? DEFAULT_EXPORT_PRECISION_MM
        : exportOptions.precisionMm,
    groupContours: exportOptions.groupContours ?? false,
  };
  const selected = selectedIds === undefined ? null : new Set(selectedIds);
  const objects = project.scene.objects.filter(
    (object) => selected === null || selected.has(object.id),
  );
  if (objects.length === 0) return err('There is no artwork to export.');
  const relief = objects.find((object) => object.kind === 'relief');
  if (relief !== undefined)
    return err('SVG cannot contain a 3D relief. Select only vector and image artwork.');
  try {
    const elements = objects.map((object, index) => exportObject(object, index, project, options));
    const page = pageBox(
      unionBounds(elements.map((element) => element.bounds)),
      options.precisionMm,
    );
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"' +
      ' width="' +
      page.width +
      'mm" height="' +
      page.height +
      'mm"' +
      ' viewBox="' +
      page.viewBox +
      '" overflow="visible">\n' +
      '<desc>KerfDesk artwork. Text is outlined; machine settings are not included.</desc>\n' +
      elements.map((element) => element.markup).join('\n') +
      '\n</svg>\n';
    return ok({ svg, objectCount: objects.length });
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

/** The page is the exact artwork box, rounded outward onto the world grid. */
function pageBox(
  bounds: Bounds,
  precisionMm: number | null,
): { readonly width: string; readonly height: string; readonly viewBox: string } {
  if (precisionMm === null || !(precisionMm > 0)) {
    const width = svgNumber(Math.max(MIN_PAGE_EXTENT_MM, bounds.maxX - bounds.minX));
    const height = svgNumber(Math.max(MIN_PAGE_EXTENT_MM, bounds.maxY - bounds.minY));
    return {
      width,
      height,
      viewBox: [svgNumber(bounds.minX), svgNumber(bounds.minY), width, height].join(' '),
    };
  }
  const grid = decimalGridAtMost(precisionMm);
  const x = outwardGridIndices(bounds.minX, bounds.maxX, grid);
  const y = outwardGridIndices(bounds.minY, bounds.maxY, grid);
  // A zero-extent page (a lone horizontal line) keeps the historical
  // 0.01 mm minimum box, or one grid step when the grid is coarser.
  const minimum = Math.max(1, Math.round(MIN_PAGE_EXTENT_MM / grid.step));
  const text = (index: number): string => formatGridIndex(index, grid);
  const width = text(Math.max(minimum, x.hi - x.lo));
  const height = text(Math.max(minimum, y.hi - y.lo));
  return { width, height, viewBox: [text(x.lo), text(y.lo), width, height].join(' ') };
}

function exportObject(
  object: SceneObject,
  index: number,
  project: Project,
  options: SvgVectorOptions,
): SvgElement {
  if (object.kind === 'raster-image') return exportImage(object, index, project);
  if (object.kind === 'relief') throw new Error('A 3D relief cannot be represented in SVG.');
  const elements = object.paths.map((path) => vectorPathElement(object, path, project, options));
  if (elements.length === 0) throw new Error('Artwork ' + object.id + ' contains no paths.');
  const drawn = elements.flatMap((element) => (element.bounds === null ? [] : [element.bounds]));
  if (drawn.length === 0) throw new Error('Artwork contains no exportable points.');
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
    bounds: unionBounds(drawn),
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
    markup: clipImageElement(image, index, project, element),
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

function clipImageElement(
  image: RasterImage,
  index: number,
  project: Project,
  element: string,
): string {
  let markup = element;
  if (image.imageClip !== undefined) {
    const id = 'image-clip-' + index;
    markup =
      compoundClip(image.imageClip, image.transform, id) +
      '<g clip-path="url(#' +
      id +
      ')">' +
      markup +
      '</g>';
  }
  const external = imageMaskClip(image, index, project);
  return external === ''
    ? markup
    : external + '<g clip-path="url(#mask-' + index + ')">' + markup + '</g>';
}

function imageMaskClip(image: RasterImage, index: number, project: Project): string {
  if (image.imageMaskId === undefined) return '';
  const mask = project.scene.objects.find((object) => object.id === image.imageMaskId);
  if (mask === undefined || !('paths' in mask))
    throw new Error('The image mask is missing or is not vector artwork.');
  // The raster pipeline ignores a mask whose last closed contour was removed.
  if (closedMaskCurves(mask.paths).length === 0) return '';
  return compoundClip(mask.paths, mask.transform, 'mask-' + index);
}

function closedMaskCurves(paths: readonly ColoredPath[]): CurveSubpath[] {
  return paths.flatMap((path) =>
    path.curves === undefined
      ? path.polylines
          .filter(isClosedEnough)
          .map((polyline) => polylineToCurveSubpath({ ...polyline, closed: true }))
      : path.curves.filter(isClosedMaskCurve).map((curve) => ({ ...curve, closed: true })),
  );
}

function compoundClip(paths: readonly ColoredPath[], transform: Transform, id: string): string {
  // All colors share one even-odd contour set. Each independent clip gets its
  // own group so an external mask intersects the owned clip rather than XORing.
  return (
    '<defs><clipPath id="' +
    id +
    '" clipPathUnits="userSpaceOnUse"><path d="' +
    formatSvgPathData(closedMaskCurves(paths), null) +
    '" transform="' +
    svgMatrixAttribute(transform) +
    '" clip-rule="evenodd"/></clipPath></defs>'
  );
}

function isClosedMaskCurve(curve: CurveSubpath): boolean {
  const end = curve.segments.at(-1)?.to;
  return (
    end !== undefined &&
    (curve.closed ||
      (Math.abs(end.x - curve.start.x) < CLOSURE_EPS_MM &&
        Math.abs(end.y - curve.start.y) < CLOSURE_EPS_MM))
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
