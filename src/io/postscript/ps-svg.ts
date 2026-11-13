// Painted PostScript paths to an SVG document the existing SVG import reads,
// in the same way PDF vector pages are imported (pdf-vector-page.ts). One
// PostScript point is one SVG user unit; width and height carry millimetres.

import { unionBox } from '../../core/geometry/box-math';
import { hairlineSafeStrokeWidth } from '../svg/hairline-stroke';
import { curveSubpathBounds } from '../../core/scene';
import type { PsBox } from './ps-source';
import type { PaintedPath, Subpath, Vec } from './ps-types';

const MM_PER_POINT = 25.4 / 72;

export type SvgPage = { readonly svg: string; readonly outsideBox: boolean };

export function paintedSvg(painted: readonly PaintedPath[], declared: PsBox | null): SvgPage {
  const extent = paintedExtent(painted);
  const box = withMinimumSize(declared === null ? extent : unionBox(declared, extent), painted);
  const outsideBox = declared !== null && !contains(declared, extent);
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const flip = (p: Vec): string => num(p.x - box.minX) + ' ' + num(box.maxY - p.y);
  const elements = painted.map((path) => pathElement(path, flip));
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    num(width * MM_PER_POINT) +
    'mm" height="' +
    num(height * MM_PER_POINT) +
    'mm" viewBox="0 0 ' +
    num(width) +
    ' ' +
    num(height) +
    '">' +
    elements.join('') +
    '</svg>';
  return { svg, outsideBox };
}

function pathElement(path: PaintedPath, flip: (p: Vec) => string): string {
  const d = path.subpaths.map((s) => subpathData(s, flip)).join(' ');
  return (
    '<path d="' +
    d +
    '" fill="' +
    (path.fill ?? 'none') +
    '" fill-rule="' +
    (path.evenOdd ? 'evenodd' : 'nonzero') +
    '" stroke="' +
    (path.stroke ?? 'none') +
    '" stroke-width="' +
    hairlineSafeStrokeWidth(num(path.strokeWidth)) +
    '"/>'
  );
}

function subpathData(s: Subpath, flip: (p: Vec) => string): string {
  const parts = ['M' + flip(s.start)];
  for (const seg of s.segments)
    parts.push(
      seg.kind === 'line'
        ? 'L' + flip(seg.to)
        : 'C' + flip(seg.c1) + ' ' + flip(seg.c2) + ' ' + flip(seg.to),
    );
  if (s.closed) parts.push('Z');
  return parts.join(' ');
}

/** Exact extent of the drawn curves; control points may lie outside it. */
function paintedExtent(painted: readonly PaintedPath[]): PsBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of painted)
    for (const s of path.subpaths) {
      const b = curveSubpathBounds({
        start: s.start,
        closed: s.closed,
        segments: s.segments.map((seg) =>
          seg.kind === 'line'
            ? seg
            : { kind: 'cubic', control1: seg.c1, control2: seg.c2, to: seg.to },
        ),
      });
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
  return { minX, minY, maxX, maxY };
}

/**
 * A rule drawn straight across has no height (or a vertical one no width), and
 * the SVG import reads a zero viewBox axis as nothing drawn. Such an axis grows
 * around its centre to the thickest stroke, at least 1 pt (audit C2 D1-P2-4).
 * Points keep their 1:1 scale; only the canvas around them grows.
 */
function withMinimumSize(box: PsBox, painted: readonly PaintedPath[]): PsBox {
  let size = 1;
  for (const path of painted)
    if (path.stroke !== null && path.strokeWidth > size) size = path.strokeWidth;
  const [minX, maxX] = grownAxis(box.minX, box.maxX, size);
  const [minY, maxY] = grownAxis(box.minY, box.maxY, size);
  return { minX, minY, maxX, maxY };
}

function grownAxis(min: number, max: number, size: number): readonly [number, number] {
  // Kept only when its millimetre size survives num()'s rounding (E1-P3-1).
  if (num((max - min) * MM_PER_POINT) !== '0') return [min, max];
  const middle = (min + max) / 2;
  return [middle - size / 2, middle + size / 2];
}

function contains(outer: PsBox, inner: PsBox): boolean {
  const slack = 0.5;
  return (
    inner.minX >= outer.minX - slack &&
    inner.minY >= outer.minY - slack &&
    inner.maxX <= outer.maxX + slack &&
    inner.maxY <= outer.maxY + slack
  );
}

function num(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}
