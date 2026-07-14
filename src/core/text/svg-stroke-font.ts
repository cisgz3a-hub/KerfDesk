import type { CurveSubpath, PathSegment, Vec2 } from '../scene';
import { polishStrokePath, type StrokePathPolishOptions } from './stroke-path-polish';
import type { StrokeFont, StrokeFontGlyph } from './stroke-font-text';

type SvgStrokeGlyphData = {
  readonly advance: number;
  readonly path?: string;
};

export type SvgStrokeFontData = {
  readonly capHeight: number;
  readonly glyphs: Readonly<Record<string, SvgStrokeGlyphData>>;
};

const TOKEN_PATTERN = /[MLC]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/** Compiles the supported absolute M/L/C subset used by the pinned EMS SVG fonts. */
export function svgStrokeFont(
  data: SvgStrokeFontData,
  polishOptions?: StrokePathPolishOptions,
): StrokeFont {
  return {
    capHeight: data.capHeight,
    yAxis: 'up',
    glyphs: new Map(
      Object.entries(data.glyphs).map(([character, glyph]) => [
        character,
        {
          advance: glyph.advance,
          paths: parsedPaths(glyph.path ?? '', polishOptions),
        },
      ]),
    ),
  };
}

function parsedPaths(
  pathData: string,
  polishOptions: StrokePathPolishOptions | undefined,
): ReadonlyArray<CurveSubpath> {
  const paths = parseSvgStrokePath(pathData);
  if (polishOptions === undefined) return paths;
  return paths.map((path) => polishStrokePath(path, polishOptions));
}

export function parseSvgStrokePath(pathData: string): ReadonlyArray<CurveSubpath> {
  const tokens = pathData.match(TOKEN_PATTERN) ?? [];
  const paths: CurveSubpath[] = [];
  let command: 'M' | 'L' | 'C' | null = null;
  let currentStart: Vec2 | null = null;
  let segments: PathSegment[] = [];
  let index = 0;
  const flush = (): void => {
    if (currentStart !== null && segments.length > 0) {
      paths.push({ start: currentStart, segments, closed: false });
    }
    currentStart = null;
    segments = [];
  };
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === 'M' || token === 'L' || token === 'C') {
      command = token;
      index += 1;
    }
    if (command === null) throw new Error('SVG stroke path must start with a command.');
    if (command === 'M') {
      flush();
      currentStart = readPoint(tokens, index);
      index += 2;
      command = 'L';
      continue;
    }
    if (currentStart === null) throw new Error('SVG stroke segment appears before a move.');
    if (command === 'L') {
      segments.push({ kind: 'line', to: readPoint(tokens, index) });
      index += 2;
      continue;
    }
    segments.push({
      kind: 'cubic',
      control1: readPoint(tokens, index),
      control2: readPoint(tokens, index + 2),
      to: readPoint(tokens, index + 4),
    });
    index += 6;
  }
  flush();
  return paths;
}

function readPoint(tokens: ReadonlyArray<string>, index: number): Vec2 {
  return { x: readNumber(tokens[index]), y: readNumber(tokens[index + 1]) };
}

function readNumber(token: string | undefined): number {
  const value = Number(token);
  if (!Number.isFinite(value)) throw new Error('SVG stroke path contains an invalid coordinate.');
  return value;
}

export function strokeGlyph(advance: number, paths: ReadonlyArray<CurveSubpath>): StrokeFontGlyph {
  return { advance, paths };
}
