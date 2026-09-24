// Code 128 (ISO/IEC 15417) with automatic code-set selection. A shortest-path
// search over code sets A, B and C — with switch and single-character Shift
// moves — finds the fewest symbol characters, so digit runs pack two per
// character only where the switch pays for itself. ASCII 0-127 only.

import {
  printableText,
  widthsToModules,
  type LinearEncodeResult,
  type LinearSymbol,
} from './linear-symbol';

// Bar/space widths of symbol values 0-105, then the stop pattern (ISO/IEC 15417 Table 1).
// prettier-ignore
export const CODE128_WIDTHS: readonly string[] = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 ' +
  '221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
  '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 ' +
  '212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
  '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 ' +
  '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
  '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 ' +
  '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 ' +
  '214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
  '114131 311141 411131 211412 211214 211232 2331112'
).split(' ');

// Code sets as state indices: 0 = A, 1 = B, 2 = C.
type CodeSet = 0 | 1 | 2;
const START = [103, 104, 105] as const;
const SWITCH_TO = [101, 100, 99] as const;
const SHIFT = 98;
const STOP = 106;
const MAX_LENGTH = 256;
// Tie-break order for equal-length encodings: B, then A, then C.
const PREFERENCE: readonly CodeSet[] = [1, 0, 2];

type Step = { readonly from: number; readonly values: readonly number[] };
type Search = { readonly cost: Float64Array; readonly steps: (Step | undefined)[] };

export function encodeCode128(text: string): LinearEncodeResult {
  const codes = Array.from(text, (char) => char.codePointAt(0) ?? 0);
  if (codes.length === 0) return { ok: false, message: 'Enter the data to encode.' };
  if (codes.some((code) => code > 127)) {
    return {
      ok: false,
      message: 'Code 128 carries ASCII characters only. Use QR Code or Data Matrix for other text.',
    };
  }
  if (codes.length > MAX_LENGTH) {
    return { ok: false, message: `Code 128 is limited to ${MAX_LENGTH} characters here.` };
  }
  const values = [...code128Values(codes), STOP];
  const modules = values.map((value) => widthsToModules(CODE128_WIDTHS[value] ?? '')).join('');
  const symbol: LinearSymbol = {
    modules,
    extendedBars: new Set(),
    quietZoneModules: 10,
    text: [{ text: printableText(text), fromModule: 0, toModule: modules.length }],
  };
  return { ok: true, symbol };
}

/** Start, data and check values (stop excluded) of the shortest encoding. */
export function code128Values(codes: readonly number[]): number[] {
  const n = codes.length;
  const search: Search = {
    cost: new Float64Array((n + 1) * 3).fill(Infinity),
    steps: new Array<Step | undefined>((n + 1) * 3),
  };
  for (const set of PREFERENCE) {
    search.cost[set] = 1;
    search.steps[set] = { from: -1, values: [START[set]] };
  }
  for (let index = 0; index <= n; index += 1) {
    relaxSwitches(search, index);
    if (index < n) for (const set of PREFERENCE) relaxCharacters(codes, search, index, set);
  }
  let end = n * 3 + 1;
  for (const set of PREFERENCE) {
    if ((search.cost[n * 3 + set] ?? Infinity) < (search.cost[end] ?? Infinity)) end = n * 3 + set;
  }
  const values = walkBack(search.steps, end);
  // The start character and the first data character both weigh 1.
  const weighted = values.reduce((sum, value, position) => sum + value * Math.max(1, position), 0);
  return [...values, weighted % 103];
}

function relaxSwitches(search: Search, index: number): void {
  for (const from of PREFERENCE) {
    for (const to of PREFERENCE) {
      const candidate = (search.cost[index * 3 + from] ?? Infinity) + 1;
      if (to === from || candidate >= (search.cost[index * 3 + to] ?? Infinity)) continue;
      search.cost[index * 3 + to] = candidate;
      search.steps[index * 3 + to] = { from: index * 3 + from, values: [SWITCH_TO[to]] };
    }
  }
}

function relaxCharacters(
  codes: readonly number[],
  search: Search,
  index: number,
  set: CodeSet,
): void {
  const origin = index * 3 + set;
  const base = search.cost[origin] ?? Infinity;
  if (!Number.isFinite(base)) return;
  const offer = (to: number, extra: number, values: number[]): void => {
    const state = to * 3 + set;
    if (base + extra >= (search.cost[state] ?? Infinity)) return;
    search.cost[state] = base + extra;
    search.steps[state] = { from: origin, values };
  };
  const code = codes[index] ?? 0;
  if (set === 2) {
    const next = codes[index + 1] ?? -1;
    if (isDigit(code) && isDigit(next)) offer(index + 2, 1, [(code - 48) * 10 + next - 48]);
    return;
  }
  const own = valueIn(set, code);
  const shifted = valueIn(set === 0 ? 1 : 0, code);
  if (own !== null) offer(index + 1, 1, [own]);
  else if (shifted !== null) offer(index + 1, 2, [SHIFT, shifted]);
}

function walkBack(steps: readonly (Step | undefined)[], end: number): number[] {
  const chunks: (readonly number[])[] = [];
  let state = end;
  for (let step = steps[state]; step !== undefined; step = steps[state]) {
    chunks.push(step.values);
    if (step.from < 0) break;
    state = step.from;
  }
  return chunks.reverse().flat();
}

/** Symbol value of an ASCII code in set A or B, or null when the set lacks it. */
function valueIn(set: CodeSet, code: number): number | null {
  if (set === 0) {
    if (code < 32) return code + 64;
    return code <= 95 ? code - 32 : null;
  }
  return code >= 32 && code <= 127 ? code - 32 : null;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}
