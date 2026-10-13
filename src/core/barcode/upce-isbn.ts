// UPC-E (GS1 General Specifications 5.2.2.4) and the ISBN preset on EAN-13.
//
// UPC-E is the zero-suppressed form of a UPC-A number with number system 0
// or 1. Its six digits carry no check digit of their own: the parity pattern
// of the six encodes it, computed on the expanded UPC-A number. Input is the
// six digits (number system 0), seven (number system first), or eight with
// the check digit, which is then verified.
//
// ISBN: an ISBN-13 is an EAN-13 already; an ISBN-10 becomes 978 + its first
// nine digits + a new EAN check digit, after its own mod-11 check is verified.
// Hyphens and spaces are ignored.

import { encodeEanUpc, gs1CheckDigit, L_CODES } from './ean-upc';
import type { LinearEncodeResult } from './linear-symbol';

// Parity of the six digits for number system 0, by check digit (E = even).
const UPCE_PARITY = [
  'EEEOOO',
  'EEOEOO',
  'EEOOEO',
  'EEOOOE',
  'EOEEOO',
  'EOOEEO',
  'EOOOEE',
  'EOEOEO',
  'EOEOOE',
  'EOOEOE',
];

/** The UPC-A number (without check digit) a UPC-E code stands for. */
export function expandUpcE(numberSystem: string, six: string): string {
  const [d1, d2, d3, d4, d5] = Array.from(six);
  const d6 = six.slice(5, 6);
  if (d6 === '0' || d6 === '1' || d6 === '2') {
    return `${numberSystem}${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  }
  if (d6 === '3') return `${numberSystem}${d1}${d2}${d3}00000${d4}${d5}`;
  if (d6 === '4') return `${numberSystem}${d1}${d2}${d3}${d4}00000${d5}`;
  return `${numberSystem}${d1}${d2}${d3}${d4}${d5}0000${d6}`;
}

export function encodeUpcE(text: string): LinearEncodeResult {
  const digits = text.trim();
  if (!/^\d{6,8}$/.test(digits)) {
    return {
      ok: false,
      message:
        'UPC-E needs 6 digits, 7 with the number system (0 or 1) first, or 8 with the check digit.',
    };
  }
  const numberSystem = digits.length === 6 ? '0' : (digits[0] as string);
  if (numberSystem !== '0' && numberSystem !== '1') {
    return { ok: false, message: 'The UPC-E number system digit must be 0 or 1.' };
  }
  const six = digits.length === 6 ? digits : digits.slice(1, 7);
  const check = gs1CheckDigit(expandUpcE(numberSystem, six));
  if (digits.length === 8 && digits[7] !== String(check)) {
    return {
      ok: false,
      message: `The UPC-E check digit should be ${check}, not ${digits[7]}. Check the number.`,
    };
  }
  const parity = Array.from(UPCE_PARITY[check] ?? 'EEEOOO', (p) =>
    numberSystem === '0' ? p : p === 'E' ? 'O' : 'E',
  );
  const body = Array.from(six, (digit, index) => {
    const code = L_CODES[Number(digit)] ?? '';
    return parity[index] === 'E' ? reversedComplement(code) : code;
  }).join('');
  const modules = `101${body}010101`;
  const guards = new Set([0, 2, modules.length - 5, modules.length - 3, modules.length - 1]);
  return {
    ok: true,
    symbol: {
      modules,
      extendedBars: guards,
      quietZoneModules: 9,
      text: [
        { text: numberSystem, fromModule: -8, toModule: -1, small: true },
        { text: six, fromModule: 3, toModule: 45 },
        { text: String(check), fromModule: 52, toModule: 59, small: true },
      ],
    },
  };
}

function reversedComplement(code: string): string {
  return Array.from(code, (bit) => (bit === '1' ? '0' : '1'))
    .reverse()
    .join('');
}

/** An ISBN as the EAN-13 number it is printed as, or a message. */
export function isbnToEan13(
  text: string,
): { readonly ok: true; readonly ean: string } | { readonly ok: false; readonly message: string } {
  const compact = text.replace(/[\s-]/g, '').toUpperCase();
  if (/^97[89]\d{10}$/.test(compact)) return { ok: true, ean: compact };
  if (!/^\d{9}[\dX]$/.test(compact)) {
    return {
      ok: false,
      message: 'An ISBN is 10 characters (the last may be X) or 13 digits starting 978 or 979.',
    };
  }
  const sum = Array.from(compact).reduce(
    (total, char, index) => total + (char === 'X' ? 10 : Number(char)) * (10 - index),
    0,
  );
  if (sum % 11 !== 0)
    return { ok: false, message: 'That ISBN-10 check character is wrong. Check the number.' };
  const payload = `978${compact.slice(0, 9)}`;
  return { ok: true, ean: payload + String(gs1CheckDigit(payload)) };
}

export function encodeIsbn(text: string): LinearEncodeResult {
  const converted = isbnToEan13(text);
  return converted.ok ? encodeEanUpc('ean13', converted.ean) : converted;
}
