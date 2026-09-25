// Inline marker emitted only on intentional laser-off feed motion. Preflight
// uses this narrow semantic tag to distinguish generated seeks/runways from an
// unmarked stale G1 S0 move that could crawl across artwork.
export const INTENTIONAL_LASER_OFF_MOTION_COMMENT = 'kerfdesk:laser-off-motion';

const DEFAULT_MAX_COMMENT_VALUE_BYTES = 96;
const TRUNCATION_SUFFIX = '...';

// GRBL acts on every received byte above 0x7F as a realtime command before
// the line is parsed, comments included (serial.c: "Real-time control
// characters are extended ACSII only"). KerfDesk's streamer never sends
// comment lines, but a saved file can be streamed by a sender that does, and
// UTF-8 '×' carries 0x97 (rapid override 25%) while 'Ä' carries 0x84 (safety
// door). Written comment values are therefore folded to printable ASCII.
const ASCII_FOLDS: Readonly<Record<string, string>> = {
  '×': 'x',
  '°': 'deg',
  '–': '-',
  '—': '-',
  '‘': "'",
  '’': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '″': '"',
  '…': '...',
  µ: 'u',
  μ: 'u',
  '±': '+/-',
  '½': '1/2',
  '¼': '1/4',
  '¾': '3/4',
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  ø: 'o',
  Ø: 'O',
  œ: 'oe',
  Œ: 'OE',
};
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Flatten an untrusted label into one printable-ASCII G-code comment line and
 * cap its size. Controllers and third-party senders do not all agree on
 * comment-buffer limits, so emitted diagnostic labels stay deliberately short.
 */
export function sanitizeGcodeCommentValue(
  value: string,
  maxUtf8Bytes: number = DEFAULT_MAX_COMMENT_VALUE_BYTES,
): string {
  const sanitized = Array.from(value, (char) =>
    isGcodeCommentLineBreakOrControl(char) ? ' ' : asciiFold(char),
  )
    .join('')
    .trim();
  const limit = normalizedByteLimit(maxUtf8Bytes);
  if (utf8ByteLength(sanitized) <= limit) return sanitized;
  const suffix = limit >= TRUNCATION_SUFFIX.length ? TRUNCATION_SUFFIX : '';
  const contentLimit = limit - suffix.length;
  let bytes = 0;
  let result = '';
  for (const char of sanitized) {
    const charBytes = utf8CodePointBytes(char);
    if (bytes + charBytes > contentLimit) break;
    result += char;
    bytes += charBytes;
  }
  return `${result.trimEnd()}${suffix}`;
}

function asciiFold(char: string): string {
  if (PRINTABLE_ASCII.test(char)) return char;
  const folded = ASCII_FOLDS[char] ?? char.normalize('NFKD').replace(COMBINING_MARKS, '');
  return folded.length > 0 && PRINTABLE_ASCII.test(folded) ? folded : '?';
}

function normalizedByteLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : DEFAULT_MAX_COMMENT_VALUE_BYTES;
}

function isGcodeCommentLineBreakOrControl(value: string): boolean {
  const code = value.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) bytes += utf8CodePointBytes(char);
  return bytes;
}

function utf8CodePointBytes(value: string): number {
  const code = value.codePointAt(0) ?? 0;
  if (code <= 0x7f) return 1;
  if (code <= 0x7ff) return 2;
  if (code <= 0xffff) return 3;
  return 4;
}
