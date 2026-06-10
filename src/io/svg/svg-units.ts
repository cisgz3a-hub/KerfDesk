// SVG physical-unit resolution at the import boundary (H9, ADR-046,
// PROJECT.md non-negotiable #6):
//   * viewBox + physical width/height → user units scale by physical/viewBox
//     per axis (the standard Inkscape/Illustrator export shape). A single
//     declared axis drives both (preserve aspect); '%' and other unparseable
//     lengths count as undeclared.
//   * viewBox only → 1 user unit = 1 mm (documented Phase A assumption).
//   * no viewBox → user units are CSS px at 96 DPI (matches LightBurn's
//     default import DPI for px-authored files).
// The scale multiplies GEOMETRY as well as bounds — parse-svg seeds the root
// of the transform stack with it so every element inherits it.

import type { Bounds } from '../../core/scene';

const MM_PER_INCH = 25.4;
const CSS_PX_PER_INCH = 96;
const SVG_LENGTH_UNITS_TO_MM: Readonly<Record<string, number>> = {
  mm: 1,
  cm: 10,
  in: MM_PER_INCH,
  pt: MM_PER_INCH / 72,
  pc: MM_PER_INCH / 6,
};

export type UnitScale = {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly bounds: Bounds;
};

export function resolveUnitScale(svgEl: Element): UnitScale {
  const vb = parseViewBoxRect(svgEl);
  if (vb !== null) {
    const vbW = vb.maxX - vb.minX;
    const vbH = vb.maxY - vb.minY;
    const widthMm = parseSvgLengthMmOrNull(svgEl.getAttribute('width'));
    const heightMm = parseSvgLengthMmOrNull(svgEl.getAttribute('height'));
    const xScale = widthMm !== null && widthMm > 0 && vbW > 0 ? widthMm / vbW : null;
    const yScale = heightMm !== null && heightMm > 0 && vbH > 0 ? heightMm / vbH : null;
    const scaleX = xScale ?? yScale ?? 1;
    const scaleY = yScale ?? xScale ?? 1;
    return {
      scaleX,
      scaleY,
      bounds: {
        minX: vb.minX * scaleX,
        minY: vb.minY * scaleY,
        maxX: vb.maxX * scaleX,
        maxY: vb.maxY * scaleY,
      },
    };
  }
  const w = parseSvgLengthMm(svgEl.getAttribute('width'), 100);
  const h = parseSvgLengthMm(svgEl.getAttribute('height'), 100);
  const pxScale = pxToMm(1);
  return {
    scaleX: pxScale,
    scaleY: pxScale,
    bounds: { minX: 0, minY: 0, maxX: w, maxY: h },
  };
}

function parseViewBoxRect(svgEl: Element): Bounds | null {
  const vb = svgEl.getAttribute('viewBox');
  if (vb === null) return null;
  const parts = vb.split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [x, y, w, h] = parts as [number, number, number, number];
  return { minX: x, minY: y, maxX: x + w, maxY: y + h };
}

export function parseSvgLengthMm(input: string | null, fallbackPx: number): number {
  return parseSvgLengthMmOrNull(input) ?? pxToMm(fallbackPx);
}

export function parseSvgLengthMmOrNull(input: string | null): number | null {
  if (input === null || input.trim() === '') return null;
  const match = /^\s*([+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z]*)\s*$/.exec(input);
  if (match === null) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (match[2] ?? '').toLowerCase();
  if (unit === '' || unit === 'px') return pxToMm(value);
  const mmFactor = SVG_LENGTH_UNITS_TO_MM[unit];
  return mmFactor === undefined ? null : value * mmFactor;
}

function pxToMm(px: number): number {
  return (px / CSS_PX_PER_INCH) * MM_PER_INCH;
}
