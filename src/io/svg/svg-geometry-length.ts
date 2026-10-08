import { viewportLength, type SvgViewportSize } from './svg-viewport';

const HORIZONTAL = new Set(['x', 'x1', 'x2', 'cx', 'width', 'rx']);
const VERTICAL = new Set(['y', 'y1', 'y2', 'cy', 'height', 'ry']);

/** Supported geometry attributes resolve percentages in their active user viewport. */
export function svgGeometryLength(
  element: Element,
  name: string,
  viewport: SvgViewportSize,
): number | null {
  const raw = element.getAttribute(name);
  if (raw === null) return null;
  const reference = HORIZONTAL.has(name)
    ? viewport.width
    : VERTICAL.has(name)
      ? viewport.height
      : Math.hypot(viewport.width, viewport.height) / Math.SQRT2;
  // Preserve the importer's numeric-prefix fallback for unreadable/unsupported
  // attribute units. CSS geometry and image lengths have their own contracts.
  const parsed = viewportLength(element, name, reference) ?? Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
