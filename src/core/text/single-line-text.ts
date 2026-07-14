import type { Bounds, ColoredPath, CurveSubpath, Polyline, Vec2 } from '../scene';
import { hersheyGlyphForCharacter, parseHersheyJhf, type HersheyGlyph } from './hershey-font';
import { HERSHEY_SIMPLEX_JHF } from './hershey-simplex-data';
import type { TextRenderResult } from './text-to-polylines';

const HERSHEY_CAP_HEIGHT_UNITS = 21;
const SIMPLEX_GLYPHS = parseHersheyJhf(HERSHEY_SIMPLEX_JHF);

export type SingleLineTextRenderInput = {
  readonly content: string;
  readonly sizeMm: number;
  readonly alignment: 'left' | 'center' | 'right';
  readonly lineHeight: number;
  readonly letterSpacing?: number;
  readonly color: string;
};

/** Renders Hershey Roman Simplex characters as open, one-tool-pass polylines. */
export function singleLineTextToPolylines(input: SingleLineTextRenderInput): TextRenderResult {
  const scale = input.sizeMm / HERSHEY_CAP_HEIGHT_UNITS;
  const spacingMm = (input.letterSpacing ?? 0) * input.sizeMm;
  const lines = input.content.split('\n').map((line) => Array.from(line));
  const widths = lines.map((line) => lineWidth(line, scale, spacingMm));
  const maxWidth = widths.reduce((maximum, width) => Math.max(maximum, width), 0);
  const polylines = lines.flatMap((line, index) =>
    renderLine({
      characters: line,
      x: alignmentOffset(input.alignment, widths[index] ?? 0, maxWidth),
      y: index * input.sizeMm * input.lineHeight,
      scale,
      spacingMm,
    }),
  );
  return normalizedResult(polylines, input.color);
}

type LineRenderInput = {
  readonly characters: ReadonlyArray<string>;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly spacingMm: number;
};

function renderLine(input: LineRenderInput): ReadonlyArray<Polyline> {
  const output: Polyline[] = [];
  let penX = input.x;
  input.characters.forEach((character, index) => {
    const glyph = hersheyGlyphForCharacter(SIMPLEX_GLYPHS, character);
    if (glyph === undefined) return;
    output.push(...glyphPolylines(glyph, penX, input.y, input.scale));
    penX += glyphAdvance(glyph, input.scale);
    if (index + 1 < input.characters.length) penX += input.spacingMm;
  });
  return output;
}

function glyphPolylines(
  glyph: HersheyGlyph,
  penX: number,
  baselineY: number,
  scale: number,
): ReadonlyArray<Polyline> {
  return glyph.strokes.map((stroke) => ({
    closed: false,
    points: stroke.map((point) => ({
      x: penX + (point.x - glyph.left) * scale,
      y: baselineY + point.y * scale,
    })),
  }));
}

function lineWidth(characters: ReadonlyArray<string>, scale: number, spacingMm: number): number {
  const glyphWidth = characters.reduce((total, character) => {
    const glyph = hersheyGlyphForCharacter(SIMPLEX_GLYPHS, character);
    return total + (glyph === undefined ? 0 : glyphAdvance(glyph, scale));
  }, 0);
  return glyphWidth + Math.max(0, characters.length - 1) * spacingMm;
}

function glyphAdvance(glyph: HersheyGlyph, scale: number): number {
  return (glyph.right - glyph.left) * scale;
}

function alignmentOffset(
  alignment: SingleLineTextRenderInput['alignment'],
  width: number,
  max: number,
) {
  if (alignment === 'center') return (max - width) / 2;
  if (alignment === 'right') return max - width;
  return 0;
}

function normalizedResult(polylines: ReadonlyArray<Polyline>, color: string): TextRenderResult {
  const bounds = polylineBounds(polylines);
  if (bounds === null)
    return { paths: [{ color, polylines: [], curves: [] }], bounds: zeroBounds() };
  const normalized = polylines.map((polyline) => ({
    ...polyline,
    points: polyline.points.map((point) => ({
      x: point.x - bounds.minX,
      y: point.y - bounds.minY,
    })),
  }));
  const paths: ReadonlyArray<ColoredPath> = [
    { color, polylines: normalized, curves: normalized.map(polylineCurve) },
  ];
  return {
    paths,
    bounds: { minX: 0, minY: 0, maxX: bounds.maxX - bounds.minX, maxY: bounds.maxY - bounds.minY },
  };
}

function polylineBounds(polylines: ReadonlyArray<Polyline>): Bounds | null {
  const points = polylines.flatMap((polyline) => polyline.points);
  if (points.length === 0) return null;
  return points.reduce<Bounds>(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    {
      minX: points[0]?.x ?? 0,
      minY: points[0]?.y ?? 0,
      maxX: points[0]?.x ?? 0,
      maxY: points[0]?.y ?? 0,
    },
  );
}

function polylineCurve(polyline: Polyline): CurveSubpath {
  const start: Vec2 = polyline.points[0] ?? { x: 0, y: 0 };
  return {
    start,
    closed: false,
    segments: polyline.points.slice(1).map((to) => ({ kind: 'line' as const, to })),
  };
}

function zeroBounds(): Bounds {
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}
