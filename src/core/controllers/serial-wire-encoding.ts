// The one rule for what the serial wire can carry, shared by the transports
// that encode (src/platform/web/serial-wire.ts encodeWireBytes) and by the
// store's safeWrite, which must refuse an unsendable line BEFORE it reserves an
// acknowledgement for it.
//
// The wire is one byte per character (M12, AUDIT-2026-06-10): GRBL's protocol
// is ASCII lines plus single raw realtime bytes up to 0xFF, so a UTF-16 code
// unit above 0xFF has no byte to become. Such a line is refused before a single
// byte leaves the host, which makes the refusal certain rather than ambiguous:
// the controller never saw the line, so no `ok` or `error:` can ever answer it.
// Treating it like an ambiguous adapter failure stranded an owed ack that
// blocked Jog, Frame and Start until a reset (audit transport-1).

/** The highest UTF-16 code unit that is also a single wire byte. */
export const MAX_WIRE_CODE_UNIT = 0xff;

export class WireEncodingError extends Error {
  /** The first code point in the line that the wire cannot carry. */
  readonly codePoint: number;

  constructor(codePoint: number) {
    super(
      `Not sent: the command contains "${String.fromCodePoint(codePoint)}" (${unicodeLabel(codePoint)}), ` +
        'which is not a single-byte serial character. Retype it in plain ASCII.',
    );
    this.name = 'WireEncodingError';
    this.codePoint = codePoint;
  }
}

/** The refusal for a line the wire cannot carry, or null when every character is one byte. */
export function wireEncodingError(data: string): WireEncodingError | null {
  for (let index = 0; index < data.length; index += 1) {
    if (data.charCodeAt(index) > MAX_WIRE_CODE_UNIT) return unencodableAt(data, index);
  }
  return null;
}

/** The refusal for the code unit at `index`, naming the whole character (an
 *  emoji is one surrogate pair, and a lone half would print as garbage). */
export function unencodableAt(data: string, index: number): WireEncodingError {
  return new WireEncodingError(data.codePointAt(index) ?? data.charCodeAt(index));
}

function unicodeLabel(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}
