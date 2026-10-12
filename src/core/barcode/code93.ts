// Code 93 (AIM USS-93): each character is nine modules, three bars and three
// spaces. Two modulo-47 check characters (C over weights 1-20, K over 1-15,
// both counted from the right) follow the data, then the stop character and a
// one-module termination bar. Characters outside the 43-character base set are
// written as Full ASCII shift pairs, ($) (%) (/) (+), like Full ASCII Code 39.

import { printableText, type LinearEncodeResult } from './linear-symbol';

const BASE = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
const SHIFT_DOLLAR = 43;
const SHIFT_PERCENT = 44;
const SHIFT_SLASH = 45;
const SHIFT_PLUS = 46;
// Module patterns of values 0-46 (AIM USS-93 Table 1).
// prettier-ignore
const PATTERNS: readonly string[] = [
  '100010100', '101001000', '101000100', '101000010', '100101000', '100100100', '100100010',
  '101010000', '100010010', '100001010', '110101000', '110100100', '110100010', '110010100',
  '110010010', '110001010', '101101000', '101100100', '101100010', '100110100', '100011010',
  '101011000', '101001100', '101000110', '100101100', '100010110', '110110100', '110110010',
  '110101100', '110100110', '110010110', '110011010', '101101100', '101100110', '100110110',
  '100111010', '100101110', '111010100', '111010010', '111001010', '101101110', '101110110',
  '110101110', '100100110', '111011010', '111010110', '100110010',
];
const START_STOP = '101011110';
const MAX_LENGTH = 80;

// Full ASCII ranges outside the base set: [first code, last code, shift, letter of the first].
// prettier-ignore
const FULL_ASCII: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, SHIFT_PERCENT, 20], // NUL (%)U
  [1, 26, SHIFT_DOLLAR, 0], // SOH-SUB ($)A-Z
  [27, 31, SHIFT_PERCENT, 0], // ESC-US (%)A-E
  [33, 44, SHIFT_SLASH, 0], // ! to , (/)A-L
  [58, 58, SHIFT_SLASH, 25], // : (/)Z
  [59, 63, SHIFT_PERCENT, 5], // ; to ? (%)F-J
  [64, 64, SHIFT_PERCENT, 21], // @ (%)V
  [91, 95, SHIFT_PERCENT, 10], // [ to _ (%)K-O
  [96, 96, SHIFT_PERCENT, 22], // ` (%)W
  [97, 122, SHIFT_PLUS, 0], // a-z (+)A-Z
  [123, 127, SHIFT_PERCENT, 15], // { to DEL (%)P-T
];

/** Code 93 values for one ASCII character, base set direct, others as a shift pair. */
function values(char: string): readonly number[] | null {
  const direct = BASE.indexOf(char);
  if (direct >= 0) return [direct];
  const code = char.codePointAt(0) ?? 128;
  const range = FULL_ASCII.find(([first, last]) => code >= first && code <= last);
  if (range === undefined) return null;
  const [first, , shift, letter] = range;
  return [shift, 10 + letter + code - first];
}

function checkValue(data: readonly number[], maxWeight: number): number {
  let sum = 0;
  for (let index = 0; index < data.length; index += 1) {
    const weight = (index % maxWeight) + 1;
    sum += (data[data.length - 1 - index] ?? 0) * weight;
  }
  return sum % 47;
}

export function encodeCode93(text: string): LinearEncodeResult {
  if (text.length === 0) return { ok: false, message: 'Enter the data to encode.' };
  if (text.length > MAX_LENGTH) {
    return { ok: false, message: `Code 93 is limited to ${MAX_LENGTH} characters here.` };
  }
  const data: number[] = [];
  for (const char of text) {
    const encoded = values(char);
    if (encoded === null) {
      return { ok: false, message: `Code 93 cannot encode "${printableText(char)}": ASCII only.` };
    }
    data.push(...encoded);
  }
  const c = checkValue(data, 20);
  const k = checkValue([...data, c], 15);
  const body = [...data, c, k].map((value) => PATTERNS[value] ?? '').join('');
  const modules = `${START_STOP}${body}${START_STOP}1`;
  return {
    ok: true,
    symbol: {
      modules,
      extendedBars: new Set(),
      quietZoneModules: 10,
      text: [{ text: printableText(text), fromModule: 0, toModule: modules.length }],
    },
  };
}
