// console-text — what a typed Console line may contain before any firmware
// parser sees it (controller audit 2026-09-23, transport-2).
//
// Pasted text carries characters an operator cannot see or would not expect to
// matter: a non-breaking space from a web page, a "°" or "—" in a comment.
// GRBL-family firmware runs every byte above 0x7F as a realtime command before
// the line is parsed (see serial-wire-encoding.ts), and control characters
// such as Ctrl-X (0x18, soft reset) are realtime commands too. Unicode spaces
// therefore become plain spaces, and anything else outside printable ASCII is
// refused with a reason that names it. Line breaks are left to each driver's
// one-line rule.

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const FIRST_PRINTABLE = 0x20;
const LAST_PRINTABLE = 0x7e;

/** No-break, ogham, en/em/thin/hair, narrow no-break, medium math and
 *  ideographic spaces: the ones clipboard text brings along. */
export function isUnicodeSpace(codeUnit: number): boolean {
  return (
    codeUnit === 0x00a0 ||
    codeUnit === 0x1680 ||
    (codeUnit >= 0x2000 && codeUnit <= 0x200a) ||
    codeUnit === 0x202f ||
    codeUnit === 0x205f ||
    codeUnit === 0x3000
  );
}

export function normalizeConsoleSpaces(input: string): string {
  let out = '';
  for (let index = 0; index < input.length; index += 1) {
    out += isUnicodeSpace(input.charCodeAt(index)) ? ' ' : input.charAt(index);
  }
  return out;
}

export type ConsoleTextViolation = { readonly index: number; readonly message: string };

/** The first character a Console line cannot carry, or null. Apply after
 *  normalizeConsoleSpaces. */
export function consoleTextViolation(input: string): ConsoleTextViolation | null {
  for (let index = 0; index < input.length; index += 1) {
    const codeUnit = input.charCodeAt(index);
    if (isAllowedCodeUnit(codeUnit)) continue;
    const codePoint = input.codePointAt(index) ?? codeUnit;
    const label = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
    const column = index + 1;
    const message =
      codeUnit < FIRST_PRINTABLE
        ? `Console commands cannot contain control characters (${label} at column ${column}); the controller would act on it immediately.`
        : `Console commands must be plain ASCII: "${String.fromCodePoint(codePoint)}" (${label}) at column ${column} would reach the controller as a realtime command, not text. Retype it without that character.`;
    return { index, message };
  }
  return null;
}

/** Why a Console line cannot be sent as typed, or null. */
export function consoleTextRefusal(input: string): string | null {
  return consoleTextViolation(input)?.message ?? null;
}

function isAllowedCodeUnit(codeUnit: number): boolean {
  return (
    codeUnit === TAB ||
    codeUnit === LINE_FEED ||
    codeUnit === CARRIAGE_RETURN ||
    (codeUnit >= FIRST_PRINTABLE && codeUnit <= LAST_PRINTABLE)
  );
}
