// textToPolylines — render a TextObject's content into ColoredPath
// polylines via opentype.js. Pure once the font ArrayBuffer is in
// hand (no I/O — the caller owns the fetch).
//
// Algorithm:
//   1. parse the font with opentype.js
//   2. for each line of text:
//        compute the line's pen offsets per character (kerning aware)
//        get the path command stream for the line
//   3. flatten path commands to polylines via De Casteljau (matches
//      the SVG-import sampler so visual fidelity is consistent)
//   4. handle alignment by post-translating each line's polylines
//      so the line's bounding box aligns left/center/right within the
//      max line width
//
// Returns ColoredPath[] — one entry per text color (Phase D has one).
// Polylines are in MILLIMETRES, with the text baseline of the FIRST
// line at y=0 and successive lines below (positive Y is "down" in the
// scene, matching SVG-like convention; the origin transform applies
// later as for any other SceneObject).
//
// Pure-core compliant: no clock, no random, no I/O.

import * as opentype from 'opentype.js';
import type { Bounds, ColoredPath, Polyline, Vec2 } from '../scene';

// Sampling resolution for curves. 12 segments per cubic / quad keeps
// glyphs smooth at typical sizes (10-40 mm). Same default as the SVG
// importer's flatten-curves module so the visual style is consistent.
const CURVE_SAMPLES = 12;

export type TextRenderInput = {
  readonly fontBuffer: ArrayBuffer;
  readonly content: string;
  readonly sizeMm: number;
  readonly alignment: 'left' | 'center' | 'right';
  readonly lineHeight: number; // multiplier of sizeMm
  // Letter spacing as a multiplier of sizeMm. Defaults to 0 (natural).
  // Passed straight through to opentype.js's getPath options, which
  // adds spacing × fontSize to each glyph's advance.
  readonly letterSpacing?: number;
  readonly color: string;
};

export type TextRenderResult = {
  readonly paths: ReadonlyArray<ColoredPath>;
  readonly bounds: Bounds;
};

export function textToPolylines(input: TextRenderInput): TextRenderResult {
  const font = opentype.parse(input.fontBuffer);
  const lines = input.content.split('\n');
  const lineSpacingMm = input.sizeMm * input.lineHeight;
  const letterSpacing = input.letterSpacing ?? 0;
  // Per-line widths drive alignment. With letterSpacing != 0 the
  // natural advance changes — add (N-1) * spacing × sizeMm per line
  // since opentype's getAdvanceWidth doesn't apply our tracking.
  const lineWidths = lines.map(
    (line) =>
      measureLineWidth(font, line, input.sizeMm) +
      Math.max(0, line.length - 1) * letterSpacing * input.sizeMm,
  );
  const maxWidth = lineWidths.reduce((m, w) => (w > m ? w : m), 0);
  const raw: Polyline[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const lineWidth = lineWidths[i] ?? 0;
    const xOffset = alignOffset(input.alignment, lineWidth, maxWidth);
    const yBaseline = i * lineSpacingMm;
    pushLinePolylines(font, line, input.sizeMm, xOffset, yBaseline, letterSpacing, raw);
  }
  // Normalize: translate so the natural bounds are (0, 0)-rooted,
  // matching ImportedSvg's viewBox convention. fit-to-bed, hit-test,
  // and the workspace renderer all treat object-local bounds as
  // starting at top-left; text needs to behave the same.
  const { polylines, bounds } = normalizeToOrigin(raw);
  return {
    paths: [{ color: input.color, polylines }],
    bounds,
  };
}

function normalizeToOrigin(polylines: ReadonlyArray<Polyline>): {
  readonly polylines: ReadonlyArray<Polyline>;
  readonly bounds: Bounds;
} {
  if (polylines.length === 0) {
    return { polylines: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const pl of polylines) {
    for (const p of pl.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) {
    return { polylines: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  }
  const dx = -minX;
  const dy = -minY;
  const shifted: Polyline[] = polylines.map((pl) => ({
    points: pl.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    closed: pl.closed,
  }));
  return {
    polylines: shifted,
    bounds: { minX: 0, minY: 0, maxX: maxX - minX, maxY: maxY - minY },
  };
}

function measureLineWidth(font: opentype.Font, line: string, sizeMm: number): number {
  // opentype's getAdvanceWidth returns the pen advance in font units;
  // multiply by sizeMm/unitsPerEm to convert. Includes kerning.
  return font.getAdvanceWidth(line, sizeMm);
}

function alignOffset(
  alignment: 'left' | 'center' | 'right',
  lineWidth: number,
  maxWidth: number,
): number {
  switch (alignment) {
    case 'left':
      return 0;
    case 'center':
      return (maxWidth - lineWidth) / 2;
    case 'right':
      return maxWidth - lineWidth;
  }
}

function pushLinePolylines(
  font: opentype.Font,
  line: string,
  sizeMm: number,
  xOffset: number,
  yBaseline: number,
  letterSpacing: number,
  out: Polyline[],
): void {
  // opentype's getPath returns SVG-like commands in mm-equivalent
  // units when we pass sizeMm directly. The baseline sits at y = 0
  // by convention; we translate to (xOffset, yBaseline). The
  // letterSpacing option (since opentype.js 1.3) is a multiplier of
  // fontSize added after each glyph's natural advance — opentype's
  // implementation just does `x += options.letterSpacing * fontSize`
  // per char (verified in node_modules/opentype.js source).
  const path = font.getPath(line, xOffset, yBaseline, sizeMm, {
    letterSpacing,
  });
  flattenPath(path.commands, out);
}

// Flatten opentype path commands to polylines. Commands are M / L / C
// (cubic) / Q (quadratic) / Z (close). One polyline per Move..Close
// or per disjoint segment. De Casteljau sampling for curves — same
// approach as src/io/svg/flatten-curves.ts (kept self-contained here
// rather than reaching across module boundaries).
function flattenPath(commands: ReadonlyArray<opentype.PathCommand>, out: Polyline[]): void {
  let current: Vec2[] = [];
  let startPoint: Vec2 | null = null;
  const finish = (close: boolean): void => {
    if (current.length >= 2) out.push({ points: current, closed: close });
    current = [];
  };
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        finish(false);
        current = [{ x: cmd.x, y: cmd.y }];
        startPoint = { x: cmd.x, y: cmd.y };
        break;
      case 'L':
        current.push({ x: cmd.x, y: cmd.y });
        break;
      case 'C':
        sampleCubic(current, cmd, CURVE_SAMPLES);
        break;
      case 'Q':
        sampleQuadratic(current, cmd, CURVE_SAMPLES);
        break;
      case 'Z':
        if (startPoint !== null) current.push({ x: startPoint.x, y: startPoint.y });
        finish(true);
        startPoint = null;
        break;
    }
  }
  finish(false);
}

function sampleCubic(
  current: Vec2[],
  cmd: { x1: number; y1: number; x2: number; y2: number; x: number; y: number },
  steps: number,
): void {
  const start = current[current.length - 1];
  if (start === undefined) return;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = bezierCubic(start.x, cmd.x1, cmd.x2, cmd.x, t);
    const y = bezierCubic(start.y, cmd.y1, cmd.y2, cmd.y, t);
    current.push({ x, y });
  }
}

function sampleQuadratic(
  current: Vec2[],
  cmd: { x1: number; y1: number; x: number; y: number },
  steps: number,
): void {
  const start = current[current.length - 1];
  if (start === undefined) return;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = bezierQuadratic(start.x, cmd.x1, cmd.x, t);
    const y = bezierQuadratic(start.y, cmd.y1, cmd.y, t);
    current.push({ x, y });
  }
}

function bezierCubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function bezierQuadratic(p0: number, p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}
