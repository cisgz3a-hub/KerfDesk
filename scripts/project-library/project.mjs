// Project definition helpers: sheet layout and the catalog record builder.
//
// Authors describe each part in its own local coordinates and hand back a
// draw function; `sheet` places the parts and reports the real sheet size, so
// a project's declared dimensions can never drift from its geometry.

import { doc } from './svg.mjs';

const DEFAULT_MARGIN_MM = 6;
const DEFAULT_GAP_MM = 6;

/**
 * Defines one part. `draw(ox, oy)` returns markup with the part's local origin
 * translated to (ox, oy); `width`/`height` are its bounding box in mm.
 */
export function part(width, height, draw, options = {}) {
  return { width, height, draw, copies: options.copies ?? 1, name: options.name };
}

function place(parts, maxWidthMm, gap, margin) {
  const placements = [];
  let cursorX = margin;
  let cursorY = margin;
  let rowHeight = 0;
  for (const item of parts) {
    for (let copy = 0; copy < item.copies; copy += 1) {
      if (cursorX > margin && cursorX + item.width > maxWidthMm - margin) {
        cursorX = margin;
        cursorY += rowHeight + gap;
        rowHeight = 0;
      }
      placements.push({ item, x: cursorX, y: cursorY });
      cursorX += item.width + gap;
      rowHeight = Math.max(rowHeight, item.height);
    }
  }
  return { placements, height: cursorY + rowHeight + margin };
}

/**
 * Lays parts out on a sheet and emits the document. Returns the markup plus
 * the true sheet size so the catalog can state it without guessing.
 */
export function sheet(parts, options = {}) {
  const margin = options.marginMm ?? DEFAULT_MARGIN_MM;
  const gap = options.gapMm ?? DEFAULT_GAP_MM;
  const widest = Math.max(...parts.map((item) => item.width));
  const maxWidth = Math.max(options.maxWidthMm ?? Infinity, widest + 2 * margin);
  const { placements, height } = place(parts, maxWidth, gap, margin);
  const usedWidth = Math.max(...placements.map((p) => p.x + p.item.width));
  const widthMm = Math.min(maxWidth, usedWidth + margin);
  const body = placements.map((p) => p.item.draw(p.x, p.y)).join('');
  return { svg: doc(widthMm, height, body), widthMm, heightMm: height };
}

/** A single-part sheet with no margin: the geometry IS the document. */
export function bare(width, height, draw) {
  return { svg: doc(width, height, draw(0, 0)), widthMm: width, heightMm: height };
}

/**
 * Builds a catalog record. `layout` is the return value of `sheet` or `bare`,
 * which is where `spec.sheetSizeMm` comes from — the generator cross-checks it
 * against the emitted SVG so the two can never disagree.
 */
export function project(options) {
  const { layout, spec, ...rest } = options;
  return {
    ...rest,
    svg: layout.svg,
    spec: {
      ...spec,
      sheetSizeMm: { widthMm: round(layout.widthMm), heightMm: round(layout.heightMm) },
    },
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/** Finished-size shorthand; depth is optional for flat parts. */
export function finished(widthMm, heightMm, depthMm) {
  return depthMm === undefined
    ? { widthMm: round(widthMm), heightMm: round(heightMm) }
    : { widthMm: round(widthMm), heightMm: round(heightMm), depthMm: round(depthMm) };
}
