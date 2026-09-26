import { scanCompleteGcodeWords, stripInlineComments } from '../gcode';

export type SourceBlock = {
  readonly g: ReadonlyArray<number>;
  readonly m: ReadonlyArray<number>;
  readonly x?: number;
  readonly y?: number;
  readonly f?: number;
  readonly s?: number;
  /** G2/G3 centre offsets from the start, G17 only (ADR-432). */
  readonly i?: number;
  readonly j?: number;
};

const G_GROUPS = new Map([
  [0, 'motion'],
  [1, 'motion'],
  [2, 'motion'],
  [3, 'motion'],
  [17, 'plane'],
  [20, 'units'],
  [21, 'units'],
  [54, 'work coordinates'],
  [90, 'distance'],
  [91, 'distance'],
  [94, 'feed'],
]);
const M_GROUPS = new Map([
  [3, 'beam'],
  [4, 'beam'],
  [5, 'beam'],
  [7, 'air'],
  [8, 'air'],
  [9, 'air'],
  [2, 'end'],
  [30, 'end'],
]);

function modalWord(letter: 'G' | 'M', value: number, groups: Set<string>, target: number[]): void {
  const group = (letter === 'G' ? G_GROUPS : M_GROUPS).get(value);
  if (group === undefined) {
    throw new Error(
      `Unsupported ${letter}${value}. Selective passes support XY laser motion in lines and G17 arcs.`,
    );
  }
  const key = `${letter}:${group}`;
  if (groups.has(key)) throw new Error(`Conflicting ${letter} words in one source line.`);
  groups.add(key);
  target.push(value);
}

export function readSourceBlock(line: string): SourceBlock | null {
  const text = stripInlineComments(line);
  if (text === '') return null;
  if (text.includes('/') || text.includes('*')) {
    throw new Error('Optional blocks and checksummed source lines are not supported.');
  }
  const words = scanCompleteGcodeWords(text);
  if (words === null || words.length === 0) throw new Error('Unrecognised executable source text.');
  const g: number[] = [];
  const m: number[] = [];
  const groups = new Set<string>();
  const axes: SourceValues = {};
  for (const { letter, value } of words) {
    if (!Number.isFinite(value)) throw new Error('Source values must be finite.');
    if (letter === 'G' || letter === 'M') {
      modalWord(letter, value, groups, letter === 'G' ? g : m);
    } else {
      readValueWord(letter, value, groups, axes);
    }
  }
  return { g, m, ...axes };
}

type SourceValues = { x?: number; y?: number; f?: number; s?: number; i?: number; j?: number };

function readValueWord(
  letter: string,
  value: number,
  groups: Set<string>,
  axes: SourceValues,
): void {
  if (groups.has(letter)) throw new Error(`Repeated ${letter} word in one source line.`);
  groups.add(letter);
  if (letter === 'N' && Number.isSafeInteger(value) && value >= 0) return;
  if (!['X', 'Y', 'F', 'S', 'I', 'J'].includes(letter)) {
    throw new Error(`Unsupported ${letter} word. Only XY laser motion can be repainted.`);
  }
  if (letter === 'F' && value <= 0) throw new Error('Source feed must be greater than zero.');
  if (letter === 'S' && value < 0) throw new Error('Source power cannot be negative.');
  axes[letter.toLowerCase() as keyof SourceValues] = value;
}
