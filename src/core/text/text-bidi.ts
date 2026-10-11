import type { Bidi, BidiCharTypeName } from 'bidi-js';

export type BidiCharacter = {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly level: number;
  readonly paragraphLevel: number;
  readonly type: BidiCharTypeName;
};

// bidi-js 1.1 indexes UTF-16 code units internally. One BMP representative
// per supplementary codepoint preserves its bidi class without splitting it.
// Keep BMP brackets/controls verbatim so pairing/isolation still sees them.
const REPRESENTATIVE: Readonly<Record<BidiCharTypeName, string>> = {
  L: 'A',
  R: '\u05d0',
  AL: '\u0627',
  EN: '0',
  ES: '+',
  ET: '$',
  AN: '\u0660',
  CS: ',',
  B: '\n',
  S: '\t',
  WS: ' ',
  ON: '!',
  BN: '\u00ad',
  NSM: '\u0300',
  LRO: '\u202d',
  RLO: '\u202e',
  LRE: '\u202a',
  RLE: '\u202b',
  PDF: '\u202c',
  LRI: '\u2066',
  RLI: '\u2067',
  FSI: '\u2068',
  PDI: '\u2069',
};
const trailing = new Set<BidiCharTypeName>([
  'S',
  'WS',
  'B',
  'BN',
  'LRE',
  'RLE',
  'LRO',
  'RLO',
  'PDF',
  'LRI',
  'RLI',
  'FSI',
  'PDI',
]);

export function bidiCharacters(content: string, bidi: Bidi): BidiCharacter[] {
  const points = Array.from(content);
  const types = points.map((point) => bidi.getBidiCharTypeName(point));
  const proxy = points
    .map((point, index) => (point.length === 1 ? point : REPRESENTATIVE[types[index] ?? 'L']))
    .join('');
  const embedding = bidi.getEmbeddingLevels(proxy);
  let offset = 0;
  let paragraph = 0;
  return points.map((text, index) => {
    while (index > (embedding.paragraphs[paragraph]?.end ?? Infinity)) paragraph += 1;
    const start = offset;
    offset += text.length;
    return {
      text,
      start,
      end: offset,
      level: embedding.levels[index] ?? 0,
      paragraphLevel: embedding.paragraphs[paragraph]?.level ?? 0,
      type: types[index] ?? 'L',
    };
  });
}

/** UAX #9 L1 applies after wrapping, using the original paragraph levels.
 * Work in a line-local array, avoiding bidi-js's nonzero-start L1 offset. */
export function bidiLineCharacters(characters: ReadonlyArray<BidiCharacter>): BidiCharacter[] {
  const line = characters.map((character) => ({ ...character }));
  for (let index = line.length - 1; index >= 0; index -= 1) {
    const character = line[index];
    if (character === undefined || !trailing.has(character.type)) break;
    character.level = character.paragraphLevel;
  }
  return line;
}

/** UAX #9 L2: reorder whole shaped runs, never reverse glyphs in a cluster. */
export function visualBidiRuns<T extends { readonly level: number }>(
  logical: ReadonlyArray<T>,
): T[] {
  const runs = [...logical];
  const maximum = runs.reduce((max, run) => Math.max(max, run.level), 0);
  const minimumOdd = runs.reduce(
    (min, run) => (run.level % 2 === 1 ? Math.min(min, run.level) : min),
    Infinity,
  );
  for (let level = maximum; level >= minimumOdd; level -= 1) {
    for (let start = 0; start < runs.length; start += 1) {
      if ((runs[start]?.level ?? 0) < level) continue;
      let end = start + 1;
      while (end < runs.length && (runs[end]?.level ?? 0) >= level) end += 1;
      const reversed = runs.slice(start, end).reverse();
      runs.splice(start, end - start, ...reversed);
      start = end - 1;
    }
  }
  return runs;
}
