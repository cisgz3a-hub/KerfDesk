// Code 39 (ISO/IEC 16388): each character is five bars and four spaces, three
// of them wide, framed by '*' start/stop characters and one narrow gap. Wide
// elements default to three narrow modules — the top of the standard's 2:1 to
// 3:1 range — because laser-marked bars spread and a wider ratio keeps wide
// and narrow elements distinguishable.

import { printableText, type LinearEncodeResult } from './linear-symbol';

export const CODE39_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
// Nine elements per character, first element most significant, 1 = wide.
// prettier-ignore
const PATTERNS: readonly number[] = [
  0x034, 0x121, 0x061, 0x160, 0x031, 0x130, 0x070, 0x025, 0x124, 0x064,
  0x109, 0x049, 0x148, 0x019, 0x118, 0x058, 0x00d, 0x10c, 0x04c, 0x01c,
  0x103, 0x043, 0x142, 0x013, 0x112, 0x052, 0x007, 0x106, 0x046, 0x016,
  0x181, 0x0c1, 0x1c0, 0x091, 0x190, 0x0d0, 0x085, 0x184, 0x0c4, 0x0a8,
  0x0a2, 0x08a, 0x02a,
];
const START_STOP = 0x094;
export const CODE39_DEFAULT_WIDE_RATIO = 3;
const MAX_LENGTH = 80;

export function encodeCode39(
  text: string,
  wideRatio = CODE39_DEFAULT_WIDE_RATIO,
): LinearEncodeResult {
  if (text.length === 0) return { ok: false, message: 'Enter the data to encode.' };
  const invalid = Array.from(text).find((char) => !CODE39_CHARSET.includes(char));
  if (invalid !== undefined) {
    return {
      ok: false,
      message: `Code 39 cannot encode "${printableText(invalid)}". It carries digits, capital letters, space and - . $ / + %.`,
    };
  }
  if (text.length > MAX_LENGTH) {
    return { ok: false, message: `Code 39 is limited to ${MAX_LENGTH} characters here.` };
  }
  const characters = [
    START_STOP,
    ...Array.from(text, (char) => PATTERNS[CODE39_CHARSET.indexOf(char)] ?? 0),
    START_STOP,
  ];
  const modules = characters.map((pattern) => patternModules(pattern, wideRatio)).join('0');
  return {
    ok: true,
    symbol: {
      modules,
      extendedBars: new Set(),
      quietZoneModules: 10,
      text: [{ text, fromModule: 0, toModule: modules.length }],
    },
  };
}

function patternModules(pattern: number, wideRatio: number): string {
  let modules = '';
  for (let element = 0; element < 9; element += 1) {
    const wide = ((pattern >> (8 - element)) & 1) === 1;
    modules += (element % 2 === 0 ? '1' : '0').repeat(wide ? wideRatio : 1);
  }
  return modules;
}
