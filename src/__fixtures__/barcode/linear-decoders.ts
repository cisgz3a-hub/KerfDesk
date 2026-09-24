// Small 1D readers for tests. They take the module string an encoder produced
// ('1' = bar), check start/stop and check characters, and return the text a
// scanner would report, or null. The EAN/UPC and Code 39 tables here are
// transcribed separately from the encoders' tables.

import { CODE128_WIDTHS } from '../../core/barcode/code128';

function runs(modules: string): number[] {
  const widths: number[] = [];
  for (let index = 0; index < modules.length; ) {
    let end = index;
    while (modules[end] === modules[index]) end += 1;
    widths.push(end - index);
    index = end;
  }
  return widths;
}

export function readCode128(modules: string): string | null {
  const widths = runs(modules);
  const values: number[] = [];
  let cursor = 0;
  while (cursor + 6 <= widths.length) {
    const pattern = widths.slice(cursor, cursor + 6).join('');
    if (pattern === '233111' && widths[cursor + 6] === 2 && cursor + 7 === widths.length) {
      return interpretCode128(values);
    }
    const value = CODE128_WIDTHS.indexOf(pattern);
    if (value < 0 || value > 105) return null;
    values.push(value);
    cursor += 6;
  }
  return null;
}

function interpretCode128(values: readonly number[]): string | null {
  const [start = 0, ...rest] = values;
  const check = rest.pop();
  const sum = rest.reduce((total, value, index) => total + value * (index + 1), start);
  if (start < 103 || sum % 103 !== check) return null;
  let set = start - 103; // 0 = A, 1 = B, 2 = C
  let text = '';
  let shifted = false;
  for (const value of rest) {
    const decoded = shifted ? charIn(1 - set, value) : readValue(set, value);
    shifted = false;
    if (decoded === null) return null;
    if (decoded === 'shift') shifted = true;
    else if (typeof decoded === 'string') text += decoded;
    else set = decoded.set;
  }
  return text;
}

type Decoded = string | 'shift' | { readonly set: number } | null;

function readValue(set: number, value: number): Decoded {
  if (set === 2) {
    if (value < 100) return String(value).padStart(2, '0');
    return value === 100 ? { set: 1 } : value === 101 ? { set: 0 } : null;
  }
  if (value < 96) return charIn(set, value);
  if (value === 98) return 'shift';
  if (value === 99) return { set: 2 };
  if (set === 0 && value === 100) return { set: 1 };
  if (set === 1 && value === 101) return { set: 0 };
  return null;
}

function charIn(set: number, value: number): string {
  if (set === 0) return String.fromCharCode(value < 64 ? value + 32 : value - 64);
  return String.fromCharCode(value + 32);
}

// Code 39 by character: 'n'/'w' for the nine elements, bar first.
const CODE39: Readonly<Record<string, string>> = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn',
};

export function readCode39(modules: string): string | null {
  const widths = runs(modules);
  const narrow = Math.min(...widths);
  const lookup = new Map(Object.entries(CODE39).map(([char, pattern]) => [pattern, char]));
  let text = '';
  for (let cursor = 0; cursor < widths.length; cursor += 10) {
    const pattern = widths
      .slice(cursor, cursor + 9)
      .map((width) => (width > narrow * 1.5 ? 'w' : 'n'))
      .join('');
    const gap = widths[cursor + 9];
    if (gap !== undefined && gap !== narrow) return null;
    const char = lookup.get(pattern);
    if (char === undefined) return null;
    text += char;
  }
  if (!text.startsWith('*') || !text.endsWith('*') || text.length < 2) return null;
  return text.slice(1, -1);
}

const L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
const R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];
const FIRST_DIGIT_PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

const EAN_HALF_DIGITS = new Map([
  [95, 6],
  [67, 4],
]);

/** EAN-13 (95 modules) or EAN-8 (67 modules) digits with a valid check digit, else null. */
export function readEan(modules: string): string | null {
  const half = EAN_HALF_DIGITS.get(modules.length);
  if (half === undefined || !hasEanGuards(modules, half)) return null;
  const left = readLeftHalf(modules, half);
  const right = readRightHalf(modules, half);
  if (left === null || right === null) return null;
  const first = leadingDigit(left.parity, half);
  if (first === null) return null;
  const digits = first + left.digits + right;
  return checkDigitValid(digits) ? digits : null;
}

function hasEanGuards(modules: string, half: number): boolean {
  return (
    modules.startsWith('101') &&
    modules.endsWith('101') &&
    modules.slice(3 + half * 7, 8 + half * 7) === '01010'
  );
}

/** EAN-13 carries its first digit in the left half's parity; EAN-8 has none. */
function leadingDigit(parity: string, half: number): string | null {
  if (half === 4) return parity === 'LLLL' ? '' : null;
  const first = FIRST_DIGIT_PARITY.indexOf(parity);
  return first < 0 ? null : String(first);
}

function readLeftHalf(
  modules: string,
  half: number,
): { readonly parity: string; readonly digits: string } | null {
  let parity = '';
  let digits = '';
  for (let index = 0; index < half; index += 1) {
    const code = modules.slice(3 + index * 7, 10 + index * 7);
    const l = L.indexOf(code);
    const g = G.indexOf(code);
    if (l < 0 && g < 0) return null;
    parity += l >= 0 ? 'L' : 'G';
    digits += String(l >= 0 ? l : g);
  }
  return { parity, digits };
}

function readRightHalf(modules: string, half: number): string | null {
  let digits = '';
  for (let index = 0; index < half; index += 1) {
    const offset = 8 + half * 7 + index * 7;
    const digit = R.indexOf(modules.slice(offset, offset + 7));
    if (digit < 0) return null;
    digits += String(digit);
  }
  return digits;
}

function checkDigitValid(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    const weight = (digits.length - index) % 2 === 0 ? 3 : 1;
    sum += Number(digits[index]) * weight;
  }
  return sum % 10 === 0;
}
