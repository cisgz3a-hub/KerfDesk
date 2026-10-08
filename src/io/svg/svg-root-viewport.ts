import type { Bounds } from '../../core/scene';
import type { SvgMatrix } from './svg-curve-transform';
import { parseSvgLengthMmOrNull, type UnitScale } from './svg-units';
import { parsePreserveAspectRatio, parseViewBox, viewBoxMatrix } from './svg-viewport';
import { readSvgArtworkOrigin } from './svg-artwork-origin';

type RootSvgViewport = {
  readonly bounds: Bounds;
  readonly matrix: SvgMatrix | null;
};

/** Physical SVG roots map their viewBox into the declared viewport in mm. */
export function rootSvgViewportMapping(svg: Element, units: UnitScale): RootSvgViewport {
  const viewport = physicalRootViewport(svg, units);
  const origin = readSvgArtworkOrigin(svg);
  if (viewport.matrix === null || origin === null) return viewport;
  const { bounds, matrix } = viewport;
  // Metadata restores artwork scene placement after the standard physical
  // mapping. Translating bounds too keeps viewport/image clip coordinates aligned.
  return {
    bounds: {
      minX: bounds.minX + origin.x,
      minY: bounds.minY + origin.y,
      maxX: bounds.maxX + origin.x,
      maxY: bounds.maxY + origin.y,
    },
    matrix: { ...matrix, e: matrix.e + origin.x, f: matrix.f + origin.y },
  };
}

function physicalRootViewport(svg: Element, units: UnitScale): RootSvgViewport {
  const matrix = { a: units.scaleX, b: 0, c: 0, d: units.scaleY, e: 0, f: 0 };
  const viewBox = parseViewBox(svg.getAttribute('viewBox'));
  const width = parseSvgLengthMmOrNull(svg.getAttribute('width'));
  const height = parseSvgLengthMmOrNull(svg.getAttribute('height'));
  if (viewBox === 'empty' || (width !== null && width <= 0) || (height !== null && height <= 0))
    return { bounds: units.bounds, matrix: null };
  // ViewBox-only laser files deliberately retain user coordinates as mm,
  // including a nonzero origin (ADR-046). Unreadable root sizes are undeclared.
  if (viewBox === null || (width === null && height === null))
    return { bounds: units.bounds, matrix };
  const viewport = {
    x: 0,
    y: 0,
    width: viewBox.width * units.scaleX,
    height: viewBox.height * units.scaleY,
  };
  return {
    bounds: { minX: 0, minY: 0, maxX: viewport.width, maxY: viewport.height },
    matrix: viewBoxMatrix(
      viewBox,
      viewport,
      parsePreserveAspectRatio(svg.getAttribute('preserveAspectRatio')),
    ),
  };
}
