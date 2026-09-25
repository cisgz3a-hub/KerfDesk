// EAN-13, UPC-A and EAN-8 (ISO/IEC 15420, GS1 General Specifications §5.2).
// Data is all digits: without the check digit it is computed, with it the
// check digit must be right — a mistyped number is refused rather than
// encoded as a different, valid product number.

import type { LinearEncodeResult, LinearSymbol, LinearTextRun } from './linear-symbol';

export type EanKind = 'ean13' | 'upca' | 'ean8';

// Left-half odd parity (L) codes; even parity (G) is the reversed R code and
// the right-half R code is the complement of L.
const L_CODES = [
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
// Parity of the six left-half digits of EAN-13, keyed by the leading digit.
const EAN13_PARITY = [
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
const START_END_GUARD = '101';
const MIDDLE_GUARD = '01010';

const SPECS: Readonly<
  Record<EanKind, { readonly name: string; readonly length: number; readonly quiet: number }>
> = {
  ean13: { name: 'EAN-13', length: 13, quiet: 11 },
  upca: { name: 'UPC-A', length: 12, quiet: 9 },
  ean8: { name: 'EAN-8', length: 8, quiet: 7 },
};

/** GS1 mod-10 check digit of the digits that precede it. */
export function gs1CheckDigit(payload: string): number {
  let sum = 0;
  for (let index = 0; index < payload.length; index += 1) {
    const digit = Number(payload[payload.length - 1 - index]);
    sum += index % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

export function encodeEanUpc(kind: EanKind, text: string): LinearEncodeResult {
  const spec = SPECS[kind];
  const digits = text.trim();
  if (
    !/^\d+$/.test(digits) ||
    (digits.length !== spec.length && digits.length !== spec.length - 1)
  ) {
    return {
      ok: false,
      message: `${spec.name} needs ${spec.length - 1} digits, or ${spec.length} with the check digit.`,
    };
  }
  const payload = digits.slice(0, spec.length - 1);
  const check = String(gs1CheckDigit(payload));
  if (digits.length === spec.length && digits[spec.length - 1] !== check) {
    return {
      ok: false,
      message: `The ${spec.name} check digit should be ${check}, not ${digits[spec.length - 1]}. Check the number.`,
    };
  }
  const full = payload + check;
  if (kind === 'ean8')
    return {
      ok: true,
      symbol: build(full.slice(0, 4), full.slice(4), 'LLLL', spec.quiet, ean8Text(full)),
    };
  const ean13 = kind === 'upca' ? `0${full}` : full;
  const parity = EAN13_PARITY[Number(ean13[0])] ?? 'LLLLLL';
  const text13 = kind === 'upca' ? upcaText(full) : ean13Text(full);
  const symbol = build(ean13.slice(1, 7), ean13.slice(7), parity, spec.quiet, text13);
  if (kind !== 'upca') return { ok: true, symbol };
  // UPC-A also extends the bars of its first and last digit.
  const extendedBars = new Set([
    ...symbol.extendedBars,
    ...barStarts(symbol.modules, 3, 10),
    ...barStarts(symbol.modules, 85, 92),
  ]);
  return { ok: true, symbol: { ...symbol, extendedBars } };
}

function build(
  left: string,
  right: string,
  parity: string,
  quiet: number,
  text: readonly LinearTextRun[],
): LinearSymbol {
  const leftModules = Array.from(left, (digit, index) => {
    const code = L_CODES[Number(digit)] ?? '';
    return parity[index] === 'G' ? reverse(complement(code)) : code;
  }).join('');
  const rightModules = Array.from(right, (digit) => complement(L_CODES[Number(digit)] ?? '')).join(
    '',
  );
  const modules = START_END_GUARD + leftModules + MIDDLE_GUARD + rightModules + START_END_GUARD;
  const middle = 3 + leftModules.length;
  const guards = new Set([
    ...barStarts(modules, 0, 3),
    ...barStarts(modules, middle, middle + 5),
    ...barStarts(modules, modules.length - 3, modules.length),
  ]);
  return { modules, extendedBars: guards, quietZoneModules: quiet, text };
}

// First module of every bar that starts inside [from, to).
function barStarts(modules: string, from: number, to: number): number[] {
  const starts: number[] = [];
  for (let index = from; index < to; index += 1) {
    if (modules[index] === '1' && modules[index - 1] !== '1') starts.push(index);
  }
  return starts;
}

function complement(code: string): string {
  return Array.from(code, (bit) => (bit === '1' ? '0' : '1')).join('');
}

function reverse(code: string): string {
  return Array.from(code).reverse().join('');
}

// Digit placement follows GS1 General Specifications Figure 5.2.2.4-1: the
// leading EAN-13 digit sits in the left quiet zone.
function ean13Text(full: string): LinearTextRun[] {
  return [
    { text: full.slice(0, 1), fromModule: -9, toModule: -2 },
    { text: full.slice(1, 7), fromModule: 3, toModule: 45 },
    { text: full.slice(7), fromModule: 50, toModule: 92 },
  ];
}

function upcaText(full: string): LinearTextRun[] {
  return [
    { text: full.slice(0, 1), fromModule: -8, toModule: -1, small: true },
    { text: full.slice(1, 6), fromModule: 10, toModule: 45 },
    { text: full.slice(6, 11), fromModule: 50, toModule: 85 },
    { text: full.slice(11), fromModule: 96, toModule: 103, small: true },
  ];
}

function ean8Text(full: string): LinearTextRun[] {
  return [
    { text: full.slice(0, 4), fromModule: 3, toModule: 31 },
    { text: full.slice(4), fromModule: 36, toModule: 64 },
  ];
}
