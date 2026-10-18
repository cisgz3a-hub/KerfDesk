// Codabar (AIM USS-Codabar, ANSI/AIM BC3) and Interleaved 2 of 5 (ISO/IEC 16390).
//
// Codabar: seven elements per character (four bars, three spaces), each
// narrow or wide, separated by one narrow space, framed by start and stop
// characters A-D. Data without them is framed A ... B; data that already
// starts and ends with A-D keeps its own. It is self-checking: no check digit.
//
// Interleaved 2 of 5: digits in pairs, the first of each pair in the bars and
// the second in the spaces, five elements each with two wide. An odd count
// gets a leading zero. No check digit is added: the data is encoded as typed.
// Wide elements are three narrow modules, as for Code 39, so laser-spread
// bars stay distinguishable.

import { printableText, type LinearEncodeResult } from './linear-symbol';

const WIDE = 3;
const MAX_LENGTH = 80;

// Element patterns, bar-space-bar-space-bar-space-bar, 1 = wide.
const CODABAR: Readonly<Record<string, string>> = {
  '0': '0000011',
  '1': '0000110',
  '2': '0001001',
  '3': '1100000',
  '4': '0010010',
  '5': '1000010',
  '6': '0100001',
  '7': '0100100',
  '8': '0110000',
  '9': '1001000',
  '-': '0001100',
  $: '0011000',
  ':': '1000101',
  '/': '1010001',
  '.': '1010100',
  '+': '0010101',
  A: '0011010',
  B: '0101001',
  C: '0001011',
  D: '0001110',
};
const START_STOP = 'ABCD';

function elementModules(pattern: string): string {
  return Array.from(pattern, (wide, index) =>
    (index % 2 === 0 ? '1' : '0').repeat(wide === '1' ? WIDE : 1),
  ).join('');
}

export function encodeCodabar(text: string): LinearEncodeResult {
  const upper = text.trim().toUpperCase();
  if (upper.length === 0) return { ok: false, message: 'Enter the data to encode.' };
  const framed =
    START_STOP.includes(upper[0] ?? '') &&
    START_STOP.includes(upper.at(-1) ?? '') &&
    upper.length > 1
      ? upper
      : `A${upper}B`;
  const body = framed.slice(1, -1);
  const invalid = Array.from(body).find((char) => !(char in CODABAR) || START_STOP.includes(char));
  if (invalid !== undefined) {
    return {
      ok: false,
      message: `Codabar cannot encode "${printableText(invalid)}" in its data. It carries digits and - $ : / . +, framed by A-D.`,
    };
  }
  if (body.length === 0) return { ok: false, message: 'Enter the data to encode.' };
  if (body.length > MAX_LENGTH) {
    return { ok: false, message: `Codabar is limited to ${MAX_LENGTH} characters here.` };
  }
  const modules = Array.from(framed, (char) => elementModules(CODABAR[char] ?? '')).join('0');
  return {
    ok: true,
    symbol: {
      modules,
      extendedBars: new Set(),
      quietZoneModules: 10,
      text: [{ text: body, fromModule: 0, toModule: modules.length }],
    },
  };
}

// Five-element patterns of the digits 0-9, 1 = wide.
const ITF = [
  '00110',
  '10001',
  '01001',
  '11000',
  '00101',
  '10100',
  '01100',
  '00011',
  '10010',
  '01010',
];

export function encodeItf(text: string): LinearEncodeResult {
  const digits = text.trim();
  if (!/^\d+$/.test(digits)) {
    return { ok: false, message: 'Interleaved 2 of 5 encodes digits only.' };
  }
  if (digits.length > MAX_LENGTH) {
    return { ok: false, message: `Interleaved 2 of 5 is limited to ${MAX_LENGTH} digits here.` };
  }
  const even = digits.length % 2 === 0 ? digits : `0${digits}`;
  let modules = '1010'; // start: narrow bar, space, bar, space
  for (let index = 0; index < even.length; index += 2) {
    const bars = ITF[Number(even[index])] ?? '';
    const spaces = ITF[Number(even[index + 1])] ?? '';
    for (let element = 0; element < 5; element += 1) {
      modules += '1'.repeat(bars[element] === '1' ? WIDE : 1);
      modules += '0'.repeat(spaces[element] === '1' ? WIDE : 1);
    }
  }
  modules += `${'1'.repeat(WIDE)}01`; // stop: wide bar, narrow space, narrow bar
  return {
    ok: true,
    symbol: {
      modules,
      extendedBars: new Set(),
      quietZoneModules: 10,
      text: [{ text: even, fromModule: 0, toModule: modules.length }],
    },
  };
}
