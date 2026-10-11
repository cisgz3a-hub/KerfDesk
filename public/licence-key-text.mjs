// Finds a KerfDesk licence key in whatever a customer pasted: the bare key, a
// line such as "Licence key: KD1.…", a key an email or chat wrapped across lines,
// or one carrying invisible formatting characters. Shared by the desktop app and
// the purchase page so both read a key the same way. A key has the form
// KD1.<licence UUID>.<43-character base64url secret> (ADR-523).

// Whitespace, line breaks and format characters (such as zero-width spaces) may sit
// between a key's own characters, never at its end, so a wrapped key followed by
// more text still ends where the key does.
const GAP = '[\\s\\p{Cf}]*';
const run = (cls, count) => `(?:${cls}${GAP}){${count}}`;
const HEX = '[0-9a-f]';
const SECRET = '[A-Za-z0-9_-]';
const KEY = new RegExp(
  [
    `(?<![A-Za-z0-9_-])K${GAP}D${GAP}1${GAP}\\.${GAP}`,
    `${run(HEX, 8)}-${GAP}${run(HEX, 4)}-${GAP}${run(HEX, 4)}-${GAP}${run(HEX, 4)}-${GAP}`,
    `${run(HEX, 12)}\\.${GAP}${run(SECRET, 42)}${SECRET}(?!${SECRET})`,
  ].join(''),
  'gu',
);
const INVISIBLE = /[\s\p{Cf}]/gu;

/** The single KerfDesk key in the text, or null when there is none or more than one. */
export function findLicenceKey(text) {
  if (typeof text !== 'string' || text.length > 4096) return null;
  const keys = new Set([...text.matchAll(KEY)].map(([match]) => match.replace(INVISIBLE, '')));
  return keys.size === 1 ? [...keys][0] : null;
}

/** Whether the text looks like an attempt at a KerfDesk key that is not a whole one. */
export function looksLikePartialLicenceKey(text) {
  return typeof text === 'string' && /KD1\./iu.test(text) && findLicenceKey(text) === null;
}
