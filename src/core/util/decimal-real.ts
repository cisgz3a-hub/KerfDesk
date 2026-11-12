// Strict reader for a real number written in a text file format (DXF group
// values, ASCII STL vertices). `Number.parseFloat` reads the longest numeric
// PREFIX, so a decimal-comma value from a comma-locale writer ("12,5") reads as
// 12 and a Windows NaN spelling ("1.#QNAN") as 1 — silently wrong geometry
// (Oracle audit O8-P2-2). `Number()` is no better: it reads "0x10" as 16 and ""
// as 0. This accepts only the whole token as an optionally signed decimal with
// an optional exponent, which is what ezdxf's and other reference readers'
// `float()` accept, and returns NaN for anything else so the caller's existing
// "unreadable" path runs.

const DECIMAL_REAL = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*$/;

/** The value of a whole decimal-real token, or NaN when the token is not one. */
export function parseDecimalReal(text: string): number {
  return DECIMAL_REAL.test(text) ? Number(text) : Number.NaN;
}
