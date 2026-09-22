// Wire-level primitives shared by both serial transports: the main-thread
// connection in `web-serial.ts` and the worker in `serial-stream-worker.ts`
// (ADR-334). Extracted so the two can never disagree about how bytes are
// encoded or how a line is recognized.

// One byte per character, NOT UTF-8 (M12, AUDIT-2026-06-10). GRBL's wire
// protocol is ASCII lines plus single raw realtime bytes above 0x7F
// (jog-cancel 0x85, feed/spindle overrides 0x90–0xA2). TextEncoder turned
// '\x85' into the two bytes 0xC2 0x85 — vanilla GRBL discards unknown high
// bytes, so jog-cancel silently did nothing, and firmwares that buffer them
// would corrupt the following line. Byte-per-char is identical to UTF-8 for
// every ASCII string we emit and exact for the realtime bytes.
export function encodeWireBytes(data: string): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    const code = data.charCodeAt(i);
    if (code > 0xff) {
      throw new Error(
        `Serial write contains a character that is not a single-byte GRBL code: U+${code.toString(16).toUpperCase()}`,
      );
    }
    out[i] = code;
  }
  return out;
}

// Cap on an in-progress (unterminated) serial line. GRBL status/response lines
// are well under 200 bytes; a device streaming bytes WITHOUT a newline (line
// noise, or a spoofed-device DoS) would otherwise grow the read buffer without
// bound until OOM. Past this length the entire record is discarded, including
// its tail in later reads, until the next newline (audit I-01 / B-19).
export const MAX_SERIAL_LINE_LENGTH = 64 * 1024;

export type SerialLineState = {
  readonly buffer: string;
  readonly discarding: boolean;
};

export const EMPTY_SERIAL_LINE_STATE: SerialLineState = { buffer: '', discarding: false };

// Each connection carries the complete framing state between reads. Forgetting
// discard mode would turn the tail of a dropped record into a new `ok` or status.
// One extra trailing CR is retained because the record limit excludes its CRLF
// terminator, regardless of whether CR and LF arrive in the same read.
export function extractSerialLines(
  state: SerialLineState,
  chunk: string,
): { readonly lines: ReadonlyArray<string>; readonly state: SerialLineState } {
  let { buffer, discarding } = state;
  const lines: string[] = [];
  let start = 0;
  while (start < chunk.length) {
    const nl = chunk.indexOf('\n', start);
    const end = nl < 0 ? chunk.length : nl;
    if (!discarding) {
      const trailingCr = end > start ? chunk[end - 1] === '\r' : buffer.endsWith('\r');
      const limit = MAX_SERIAL_LINE_LENGTH + (trailingCr ? 1 : 0);
      if (buffer.length + end - start > limit) {
        buffer = '';
        discarding = true;
      } else {
        buffer += chunk.slice(start, end);
      }
    }
    if (nl < 0) break;
    if (!discarding) lines.push(buffer.replace(/\r$/, ''));
    buffer = '';
    discarding = false;
    start = nl + 1;
  }
  return { lines, state: { buffer, discarding } };
}
