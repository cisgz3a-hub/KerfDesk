// Minimal single-stroke label font for the project-library generator.
//
// Why a font here at all: the SVG importer only takes stroked geometry, so a
// <text> element imports as nothing (io/svg/parse-svg.test.ts, "returns
// object=null when no strokes match"). A calibration grid whose cells are not
// labelled with their actual power/speed values is unreadable after burning,
// so labels have to be emitted as real strokes.
//
// This is deliberately NOT the shipped CNC stroke font (src/core/text/) — that
// is TypeScript in the pure core and unavailable to a Node generator script.
// This font exists only to letter generated assets at authoring time.

import { OP, poly } from './svg.mjs';

// Each glyph is a list of strokes; each stroke is "x,y x,y ..." on a 4-wide by
// 6-tall cell, y down, cap top at 0 and baseline at 6.
const GLYPHS = {
  0: ['0,1 1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1'],
  1: ['0.8,1.2 2,0 2,6', '0.6,6 3.4,6'],
  2: ['0,1 1,0 3,0 4,1 4,2.2 0,6 4,6'],
  3: ['0,0 4,0 1.8,2.6 3,2.6 4,3.6 4,5 3,6 1,6 0,5'],
  4: ['3,6 3,0 0,4.2 4,4.2'],
  5: ['4,0 0.8,0 0.4,2.6 3,2.3 4,3.3 4,5 3,6 1,6 0,5'],
  6: ['4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3.6 3,2.8 1,2.8 0,3.7'],
  7: ['0,0 4,0 1.5,6'],
  8: ['1,2.8 0,1.9 0,1 1,0 3,0 4,1 4,1.9 3,2.8 1,2.8 0,3.9 0,5 1,6 3,6 4,5 4,3.9 3,2.8'],
  9: ['0,5 1,6 3,6 4,5 4,1 3,0 1,0 0,1 0,2.4 1,3.2 3,3.2 4,2.3'],
  A: ['0,6 2,0 4,6', '0.8,4 3.2,4'],
  B: ['0,0 0,6', '0,0 3,0 4,1 4,2 3,3 0,3', '0,3 3.2,3 4,4 4,5 3,6 0,6'],
  C: ['4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5'],
  D: ['0,0 3,0 4,1 4,5 3,6 0,6 0,0'],
  E: ['4,0 0,0 0,6 4,6', '0,3 3,3'],
  F: ['4,0 0,0 0,6', '0,3 3,3'],
  G: ['4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3.4 2.2,3.4'],
  H: ['0,0 0,6', '4,0 4,6', '0,3 4,3'],
  I: ['0.6,0 3.4,0', '2,0 2,6', '0.6,6 3.4,6'],
  J: ['3.2,0 3.2,5 2.2,6 1,6 0,5'],
  K: ['0,0 0,6', '4,0 0,3.4', '1.4,2.4 4,6'],
  L: ['0,0 0,6 4,6'],
  M: ['0,6 0,0 2,3.2 4,0 4,6'],
  N: ['0,6 0,0 4,6 4,0'],
  O: ['1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0'],
  P: ['0,6 0,0 3,0 4,1 4,2.4 3,3.4 0,3.4'],
  Q: ['1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0', '2.6,4.4 4.2,6.2'],
  R: ['0,6 0,0 3,0 4,1 4,2.4 3,3.4 0,3.4', '2.4,3.4 4,6'],
  S: ['4,1 3,0 1,0 0,1 0,2 1,2.8 3,3.2 4,4 4,5 3,6 1,6 0,5'],
  T: ['0,0 4,0', '2,0 2,6'],
  U: ['0,0 0,5 1,6 3,6 4,5 4,0'],
  V: ['0,0 2,6 4,0'],
  W: ['0,0 1,6 2,2.6 3,6 4,0'],
  X: ['0,0 4,6', '4,0 0,6'],
  Y: ['0,0 2,3.2 4,0', '2,3.2 2,6'],
  Z: ['0,0 4,0 0,6 4,6'],
  '%': ['0,6 4,0', '0,0.7 0.7,0 1.4,0.7 0.7,1.4 0,0.7', '2.6,4.6 3.3,3.9 4,4.6 3.3,5.3 2.6,4.6'],
  '/': ['0,6 4,0'],
  '-': ['0.5,3 3.5,3'],
  '+': ['2,1 2,5', '0,3 4,3'],
  '.': ['1.6,5.3 2.4,5.3 2.4,6 1.6,6 1.6,5.3'],
  ':': ['1.6,1.6 2.4,1.6 2.4,2.3 1.6,2.3 1.6,1.6', '1.6,4.4 2.4,4.4 2.4,5.1 1.6,5.1 1.6,4.4'],
  '#': ['1.2,0 0.5,6', '3.2,0 2.5,6', '0,2 4,2', '0,4 3.8,4'],
  '(': ['3,0 1.4,1.6 1.4,4.4 3,6'],
  ')': ['1,0 2.6,1.6 2.6,4.4 1,6'],
  '=': ['0,2.2 4,2.2', '0,4.2 4,4.2'],
  '*': ['2,1 2,5', '0.3,2 3.7,4', '0.3,4 3.7,2'],
  ' ': [],
};

const CELL_WIDTH = 4;
const CELL_HEIGHT = 6;
const ADVANCE = 5;

function strokePoints(stroke) {
  return stroke.split(' ').map((pair) => pair.split(',').map(Number));
}

/** True when every character in `text` has a glyph (after upper-casing). */
export function canRender(text) {
  return [...text.toUpperCase()].every((ch) => GLYPHS[ch] !== undefined);
}

/** Advance width of `text` at the given cap height, in mm. */
export function textWidth(text, capHeightMm) {
  const scale = capHeightMm / CELL_HEIGHT;
  return text.length === 0 ? 0 : (text.length * ADVANCE - (ADVANCE - CELL_WIDTH)) * scale;
}

function alignOffset(align, width) {
  if (align === 'center') return -width / 2;
  return align === 'right' ? -width : 0;
}

/**
 * Emits `text` as stroked polylines. (x, y) is the top-left of the cap box;
 * `align` shifts horizontally: 'left' | 'center' | 'right'.
 */
export function label(text, x, y, capHeightMm, options = {}) {
  const { color = OP.engrave, align = 'left' } = options;
  const upper = text.toUpperCase();
  const scale = capHeightMm / CELL_HEIGHT;
  const originX = x + alignOffset(align, textWidth(upper, capHeightMm));
  const out = [];
  [...upper].forEach((ch, index) => {
    const glyph = GLYPHS[ch];
    if (glyph === undefined) throw new Error(`stroke font has no glyph for ${JSON.stringify(ch)}`);
    const left = originX + index * ADVANCE * scale;
    for (const stroke of glyph) {
      out.push(
        poly(
          strokePoints(stroke).map(([gx, gy]) => [left + gx * scale, y + gy * scale]),
          color,
          false,
        ),
      );
    }
  });
  return out.join('');
}

/** Cap-box height that fits `text` within `maxWidthMm`, capped at `preferredMm`. */
export function fitCapHeight(text, maxWidthMm, preferredMm) {
  const atPreferred = textWidth(text, preferredMm);
  return atPreferred <= maxWidthMm ? preferredMm : (preferredMm * maxWidthMm) / atPreferred;
}

export { CELL_WIDTH, CELL_HEIGHT };
