import {
  curveSubpathBounds,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenCurveSubpath,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type PathSegment,
  type Polyline,
  type Vec2,
} from '../scene';
import type { TextRenderResult } from './text-to-polylines';

export type StrokeFontGlyph = {
  readonly advance: number;
  readonly paths: ReadonlyArray<CurveSubpath>;
};

export type StrokeFont = {
  readonly capHeight: number;
  readonly yAxis: 'up' | 'down';
  readonly glyphs: ReadonlyMap<string, StrokeFontGlyph>;
};

export type StrokeTextRenderInput = {
  readonly content: string;
  readonly sizeMm: number;
  readonly alignment: 'left' | 'center' | 'right';
  readonly lineHeight: number;
  readonly letterSpacing?: number;
  readonly color: string;
};

/** Renders open stroke-font curves and their deterministic machining polylines. */
export function renderStrokeFontText(
  input: StrokeTextRenderInput,
  font: StrokeFont,
): TextRenderResult {
  const scale = input.sizeMm / font.capHeight;
  const spacingMm = (input.letterSpacing ?? 0) * input.sizeMm;
  const lines = input.content.split('\n').map((line) => Array.from(line));
  const widths = lines.map((line) => lineWidth(line, font, scale, spacingMm));
  const maxWidth = widths.reduce((maximum, width) => Math.max(maximum, width), 0);
  const curves = lines.flatMap((line, index) =>
    renderLine({
      characters: line,
      x: alignmentOffset(input.alignment, widths[index] ?? 0, maxWidth),
      y: index * input.sizeMm * input.lineHeight,
      scale,
      spacingMm,
      font,
    }),
  );
  return normalizedResult(curves, input.color);
}

type LineRenderInput = {
  readonly characters: ReadonlyArray<string>;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly spacingMm: number;
  readonly font: StrokeFont;
};

function renderLine(input: LineRenderInput): ReadonlyArray<CurveSubpath> {
  const output: CurveSubpath[] = [];
  let penX = input.x;
  input.characters.forEach((character, index) => {
    const glyph = glyphForCharacter(input.font, character);
    if (glyph === undefined) return;
    output.push(
      ...glyph.paths.map((path) =>
        transformPath(path, penX, input.y, input.scale, input.font.yAxis),
      ),
    );
    penX += glyph.advance * input.scale;
    if (index + 1 < input.characters.length) penX += input.spacingMm;
  });
  return output;
}

function transformPath(
  path: CurveSubpath,
  penX: number,
  baselineY: number,
  scale: number,
  yAxis: StrokeFont['yAxis'],
): CurveSubpath {
  const point = (value: Vec2): Vec2 => ({
    x: penX + value.x * scale,
    y: baselineY + value.y * scale * (yAxis === 'up' ? -1 : 1),
  });
  return {
    start: point(path.start),
    closed: false,
    segments: path.segments.map((segment): PathSegment => {
      if (segment.kind === 'line') return { kind: 'line', to: point(segment.to) };
      if (segment.kind === 'cubic') {
        return {
          kind: 'cubic',
          control1: point(segment.control1),
          control2: point(segment.control2),
          to: point(segment.to),
        };
      }
      return {
        ...segment,
        radiusX: segment.radiusX * scale,
        radiusY: segment.radiusY * scale,
        rotationDeg: yAxis === 'up' ? -segment.rotationDeg : segment.rotationDeg,
        sweep: yAxis === 'up' ? !segment.sweep : segment.sweep,
        to: point(segment.to),
      };
    }),
  };
}

function lineWidth(
  characters: ReadonlyArray<string>,
  font: StrokeFont,
  scale: number,
  spacingMm: number,
): number {
  const glyphWidth = characters.reduce(
    (total, character) => total + (glyphForCharacter(font, character)?.advance ?? 0) * scale,
    0,
  );
  return glyphWidth + Math.max(0, characters.length - 1) * spacingMm;
}

function glyphForCharacter(font: StrokeFont, character: string): StrokeFontGlyph | undefined {
  return font.glyphs.get(character) ?? font.glyphs.get('?');
}

function alignmentOffset(
  alignment: StrokeTextRenderInput['alignment'],
  width: number,
  max: number,
): number {
  if (alignment === 'center') return (max - width) / 2;
  if (alignment === 'right') return max - width;
  return 0;
}

function normalizedResult(curves: ReadonlyArray<CurveSubpath>, color: string): TextRenderResult {
  const bounds = curveBounds(curves);
  if (bounds === null) return emptyResult(color);
  const normalizedCurves = curves.map((curve) => translateCurve(curve, -bounds.minX, -bounds.minY));
  const polylines = normalizedCurves.map(flattenForMachining);
  const paths: ReadonlyArray<ColoredPath> = [{ color, polylines, curves: normalizedCurves }];
  return {
    paths,
    bounds: { minX: 0, minY: 0, maxX: bounds.maxX - bounds.minX, maxY: bounds.maxY - bounds.minY },
  };
}

function curveBounds(curves: ReadonlyArray<CurveSubpath>): Bounds | null {
  if (curves.length === 0) return null;
  return curves.map(curveSubpathBounds).reduce((bounds, current) => ({
    minX: Math.min(bounds.minX, current.minX),
    minY: Math.min(bounds.minY, current.minY),
    maxX: Math.max(bounds.maxX, current.maxX),
    maxY: Math.max(bounds.maxY, current.maxY),
  }));
}

function translateCurve(curve: CurveSubpath, dx: number, dy: number): CurveSubpath {
  const point = (value: Vec2): Vec2 => ({ x: value.x + dx, y: value.y + dy });
  return {
    ...curve,
    start: point(curve.start),
    segments: curve.segments.map((segment): PathSegment => {
      if (segment.kind === 'line') return { ...segment, to: point(segment.to) };
      if (segment.kind === 'cubic') {
        return {
          ...segment,
          control1: point(segment.control1),
          control2: point(segment.control2),
          to: point(segment.to),
        };
      }
      return { ...segment, to: point(segment.to) };
    }),
  };
}

function flattenForMachining(curve: CurveSubpath): Polyline {
  const flattened = flattenCurveSubpath(curve, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  });
  if (flattened.kind !== 'ok') throw new Error('Stroke font exceeds the curve segment budget.');
  return { ...flattened.polyline, closed: false };
}

function emptyResult(color: string): TextRenderResult {
  return {
    paths: [{ color, polylines: [], curves: [] }],
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
}
