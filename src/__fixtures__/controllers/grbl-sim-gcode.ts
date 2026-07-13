// Minimal G-code word parsing for the GRBL simulator: just enough to track
// position, modal distance mode, feed, and spindle for realistic status
// reports. Not a validator — unknown words are ignored like GRBL ignores
// unsupported-but-well-formed input at this fidelity level.

export type SimVec3 = { readonly x: number; readonly y: number; readonly z: number };

export const SIM_ZERO_VEC3: SimVec3 = { x: 0, y: 0, z: 0 };

export type ParsedMotionWords = {
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
  readonly feed: number | null;
  readonly spindle: number | null;
  readonly setsAbsolute: boolean | null; // G90 -> true, G91 -> false
  readonly hasMotion: boolean; // any of X/Y/Z present with G0/G1/$J semantics
};

const WORD_RE = /([A-Za-z])(-?\d+(?:\.\d+)?)/g;

type MutableWords = {
  x: number | null;
  y: number | null;
  z: number | null;
  feed: number | null;
  spindle: number | null;
  setsAbsolute: boolean | null;
};

export function parseMotionWords(body: string): ParsedMotionWords {
  const acc: MutableWords = {
    x: null,
    y: null,
    z: null,
    feed: null,
    spindle: null,
    setsAbsolute: null,
  };
  for (const match of body.matchAll(WORD_RE)) {
    applyWord(acc, (match[1] ?? '').toUpperCase(), Number.parseFloat(match[2] ?? ''));
  }
  return { ...acc, hasMotion: acc.x !== null || acc.y !== null || acc.z !== null };
}

function applyWord(acc: MutableWords, letter: string, value: number): void {
  if (!Number.isFinite(value)) return;
  if (letter === 'X') acc.x = value;
  else if (letter === 'Y') acc.y = value;
  else if (letter === 'Z') acc.z = value;
  else if (letter === 'F') acc.feed = value;
  else if (letter === 'S') acc.spindle = value;
  else if (letter === 'G' && (value === 90 || value === 91)) acc.setsAbsolute = value === 90;
}

/** Resolve a commanded target in machine coordinates. `absolute` targets are
 *  given in work coordinates (machine = wco + word); relative targets add to
 *  the current machine position. Missing axes keep their current value. */
export function resolveTarget(
  current: SimVec3,
  wco: SimVec3,
  words: ParsedMotionWords,
  isAbsolute: boolean,
): SimVec3 {
  const axis = (curr: number, offset: number, word: number | null): number => {
    if (word === null) return curr;
    return isAbsolute ? offset + word : curr + word;
  };
  return {
    x: axis(current.x, wco.x, words.x),
    y: axis(current.y, wco.y, words.y),
    z: axis(current.z, wco.z, words.z),
  };
}

export function addVec3(a: SimVec3, b: SimVec3): SimVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function formatVec3(v: SimVec3): string {
  return `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
}

/** First G-word on the line (e.g. 0 for G0, 92.1 for G92.1), or null. */
export function leadingGWord(body: string): number | null {
  const match = /(?:^|\s)[Gg](\d+(?:\.\d+)?)/.exec(body);
  if (match === null) return null;
  const value = Number.parseFloat(match[1] ?? '');
  return Number.isFinite(value) ? value : null;
}

/** True when a line contains the exact G word, even if another modal G word
 * precedes it (for example the atomic `G54 G92 Z0` setup block). */
export function hasGWord(body: string, value: number): boolean {
  const target = String(value).replace('.', '\\.');
  return new RegExp(`(?:^|\\s)[Gg]${target}(?:\\s|$)`).test(body);
}
