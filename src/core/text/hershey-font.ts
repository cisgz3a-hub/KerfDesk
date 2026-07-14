import type { Vec2 } from '../scene';

const HERSHEY_ORIGIN_CODE = 'R'.charCodeAt(0);
const FIRST_PRINTABLE_ASCII = 32;
const FALLBACK_CHARACTER = '?';
const PAIR_WIDTH = 2;
const HEADER_WIDTH = 8;
const PEN_UP_PAIR = ' R';

export type HersheyGlyph = {
  readonly left: number;
  readonly right: number;
  readonly strokes: ReadonlyArray<ReadonlyArray<Vec2>>;
};

/** Parses the line-oriented JHF vector-font representation into printable ASCII glyphs. */
export function parseHersheyJhf(lines: ReadonlyArray<string>): ReadonlyArray<HersheyGlyph> {
  return lines.map(parseGlyph);
}

/** Resolves a printable character, substituting a visible question mark when unsupported. */
export function hersheyGlyphForCharacter(
  glyphs: ReadonlyArray<HersheyGlyph>,
  character: string,
): HersheyGlyph | undefined {
  const codePoint = character.codePointAt(0);
  const fallbackIndex = FALLBACK_CHARACTER.charCodeAt(0) - FIRST_PRINTABLE_ASCII;
  if (codePoint === undefined) return glyphs[fallbackIndex];
  const index = codePoint - FIRST_PRINTABLE_ASCII;
  return glyphs[index] ?? glyphs[fallbackIndex];
}

function parseGlyph(line: string): HersheyGlyph {
  const pairs = line.slice(HEADER_WIDTH);
  const left = coordinate(pairs[0]);
  const right = coordinate(pairs[1]);
  return { left, right, strokes: parseStrokes(pairs.slice(PAIR_WIDTH)) };
}

function parseStrokes(encoded: string): ReadonlyArray<ReadonlyArray<Vec2>> {
  const strokes: Array<ReadonlyArray<Vec2>> = [];
  let current: Vec2[] = [];
  for (let index = 0; index + 1 < encoded.length; index += PAIR_WIDTH) {
    const pair = encoded.slice(index, index + PAIR_WIDTH);
    if (pair === PEN_UP_PAIR) {
      if (current.length > 1) strokes.push(current);
      current = [];
      continue;
    }
    current.push({ x: coordinate(pair[0]), y: coordinate(pair[1]) });
  }
  if (current.length > 1) strokes.push(current);
  return strokes;
}

function coordinate(character: string | undefined): number {
  return character === undefined ? 0 : character.charCodeAt(0) - HERSHEY_ORIGIN_CODE;
}
