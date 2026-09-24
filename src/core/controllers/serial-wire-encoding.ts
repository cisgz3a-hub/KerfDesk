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

/**
 * The highest byte a queued line may carry. GRBL and grblHAL take every
 * received byte above 0x7F as a realtime command in the serial receive
 * interrupt, before any line or comment parsing: 0xA0 toggles flood coolant,
 * 0xA1 mist, and grblHAL maps more of that range to macros and tool-change
 * acknowledgement. A pasted non-breaking space or a "°" in a comment therefore
 * switched the air pump or coolant instead of reaching the parser (audit
 * transport-2). Single realtime bytes (overrides, jog cancel, reset) are
 * written on their own and stay allowed.
 * https://github.com/gnea/grbl/blob/master/grbl/serial.c
 * https://github.com/grblHAL/core/blob/master/stream.c
 */
export const MAX_LINE_CODE_UNIT = 0x7f;

export class WireEncodingError extends Error {
  /** The first code point in the line that the wire cannot carry. */
  readonly codePoint: number;

  constructor(codePoint: number, reason: 'not-a-byte' | 'realtime-byte' = 'not-a-byte') {
    super(
      `Not sent: the command contains "${String.fromCodePoint(codePoint)}" (${unicodeLabel(codePoint)}), ` +
        (reason === 'not-a-byte'
          ? 'which is not a single-byte serial character. Retype it in plain ASCII.'
          : 'which the controller would run as a realtime command instead of reading it as text. Retype it in plain ASCII.'),
    );
    this.name = 'WireEncodingError';
    this.codePoint = codePoint;
  }
}

/** The refusal for a line the wire cannot carry, or null when it can be sent.
 *  A payload containing a newline is a queued line and must be 7-bit ASCII. */
export function wireEncodingError(data: string): WireEncodingError | null {
  const queuedLine = data.includes('\n');
  for (let index = 0; index < data.length; index += 1) {
    const codeUnit = data.charCodeAt(index);
    if (codeUnit > MAX_WIRE_CODE_UNIT) return unencodableAt(data, index);
    if (queuedLine && codeUnit > MAX_LINE_CODE_UNIT) return realtimeByteInLineAt(data, index);
  }
  return null;
}

/** The refusal for the code unit at `index`, naming the whole character (an
 *  emoji is one surrogate pair, and a lone half would print as garbage). */
export function unencodableAt(data: string, index: number): WireEncodingError {
  return new WireEncodingError(data.codePointAt(index) ?? data.charCodeAt(index));
}

function realtimeByteInLineAt(data: string, index: number): WireEncodingError {
  return new WireEncodingError(data.charCodeAt(index), 'realtime-byte');
}

function unicodeLabel(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}
