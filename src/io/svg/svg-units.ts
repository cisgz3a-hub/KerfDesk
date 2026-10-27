// SVG physical-unit resolution at the import boundary (H9, ADR-046,
// PROJECT.md non-negotiable #6):
//   * viewBox + physical width/height → user units scale by physical/viewBox
//     per axis (the standard Inkscape/Illustrator export shape). A single
//     declared axis drives both (preserve aspect); '%' and other unparseable
//     lengths count as undeclared, and every one but '%' and auto gets an import note
//     (svgRootSizeNotes).
//   * viewBox only → 1 user unit = 1 mm (documented Phase A assumption).
//   * no viewBox → user units are CSS px at 96 DPI (matches LightBurn's
//     default import DPI for px-authored files).
// The scale multiplies GEOMETRY as well as bounds — parse-svg seeds the root
// of the transform stack with it so every element inherits it.

import type { Bounds } from '../../core/scene';

const MM_PER_INCH = 25.4;
const CSS_PX_PER_INCH = 96;
// The absolute lengths of CSS Values and Units 3 section 5.2 other than px
// ("1Q = 1/40th of 1cm"), each in mm for the root size and in user units (CSS
// px) for element lengths. Chromium sizes an SVG root in every one of them.
// One table, so the root and the elements always read the same units: Q was
// once missing from the root's own table, and width="200Q" imported at the
// viewBox size with no note (rolling audit v5 J6-P3-2).
const ABSOLUTE_UNITS: ReadonlyMap<string, { readonly mm: number; readonly userUnits: number }> =
  new Map([
    ['in', { mm: MM_PER_INCH, userUnits: CSS_PX_PER_INCH }],
    ['cm', { mm: 10, userUnits: CSS_PX_PER_INCH / 2.54 }],
    ['mm', { mm: 1, userUnits: CSS_PX_PER_INCH / MM_PER_INCH }],
    ['q', { mm: 0.25, userUnits: CSS_PX_PER_INCH / (MM_PER_INCH * 4) }],
    ['pt', { mm: MM_PER_INCH / 72, userUnits: CSS_PX_PER_INCH / 72 }],
    ['pc', { mm: MM_PER_INCH / 6, userUnits: CSS_PX_PER_INCH / 6 }],
  ]);

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
  // Whitespace around the four numbers is not a separator: splitting it would
  // add an empty fifth part and drop the viewBox, importing the file 3.78x
  // too small under the no-viewBox px rule.
  const parts = vb
    .trim()
    .split(/[\s,]+/)
    .map(Number);
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
  const mmFactor = ABSOLUTE_UNITS.get(unit)?.mm;
  return mmFactor === undefined ? null : value * mmFactor;
}

/** Resolves absolute geometry lengths into current SVG user units (CSS px at 96 DPI). */
export function parseSvgLengthUserUnitsOrNull(input: string | null): number | null {
  if (input === null || input.trim() === '') return null;
  const match = /^\s*([+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z]*)\s*$/.exec(input);
  if (match === null) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (match[2] ?? '').toLowerCase();
  if (unit === '' || unit === 'px') return value;
  const userUnitFactor = ABSOLUTE_UNITS.get(unit)?.userUnits;
  return userUnitFactor === undefined ? null : value * userUnitFactor;
}

/**
 * Import notes for a root width or height the importer cannot size: a
 * relative unit (em, ex, vw, ...) or an unreadable length. The size then
 * comes from the other axis, the viewBox or the 100 px default, which can be
 * any scale of what a browser draws, so the operator is told. A percentage
 * and auto (100% for the root) stay silent: they are relative to a page the
 * file does not define, and ADR-046 sizes them from the viewBox by design.
 */
export function svgRootSizeNotes(svgEl: Element): string[] {
  const notes: string[] = [];
  for (const name of ['width', 'height'] as const) {
    const raw = svgEl.getAttribute(name)?.trim();
    if (raw === undefined || raw === '' || raw.endsWith('%') || raw.toLowerCase() === 'auto') {
      continue;
    }
    if (parseSvgLengthMmOrNull(raw) !== null) continue;
    notes.push(
      `SVG size: the root ${name} "${raw.slice(0, 40)}" is not a length KerfDesk can size (it reads px, mm, cm, Q, in, pt and pc), so that axis was sized without it. Check the imported size before cutting.`,
    );
  }
  return notes;
}

function pxToMm(px: number): number {
  return (px / CSS_PX_PER_INCH) * MM_PER_INCH;
}
