import type { Bounds } from '../../core/scene';
import type { SvgMatrix } from './svg-curve-transform';
import { parseSvgLengthMmOrNull, type UnitScale } from './svg-units';
import { parsePreserveAspectRatio, parseViewBox, viewBoxMatrix } from './svg-viewport';

/** Physical SVG roots map their viewBox into the declared viewport in mm. */
export function rootSvgViewportMapping(
  svg: Element,
  units: UnitScale,
): {
  readonly bounds: Bounds;
  readonly matrix: SvgMatrix | null;
} {
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
