// The program crosses to the serial worker once per run as two transferable
// buffers (ADR-354 Amendment 3): the UTF-8 bytes of every queued line, back to
// back, and the byte offset at which each line starts. Transferring moves both
// buffers into the worker without copying them, and later Resume and
// tool-change Continue handovers name the program instead of sending it again.
// The worker decodes a line only when its refill reaches it, so receiving a
// program costs the same for any job.

/** Both buffers belong in the postMessage transfer list. */
export type ProgramBuffers = {
  /** The UTF-8 bytes of every line, back to back. */
  readonly bytes: ArrayBuffer;
  /** Uint32 byte offsets: line i is bytes [offsets[i], offsets[i + 1]). */
  readonly offsets: ArrayBuffer;
};

const LINES_PER_CHUNK = 65_536;
/** A Uint32 offset table addresses at most this many bytes. */
const MAX_PROGRAM_BYTES = 0xffff_ffff;

/** Throws when a line is not a string or the program cannot be addressed. */
export function encodeProgramLines(lines: ReadonlyArray<string>): ProgramBuffers {
  return encodeAsciiLines(lines) ?? encodeUtf8Lines(lines);
}

// A queued line can only reach a controller as 7-bit ASCII (serial-wire-
// encoding.ts), so nearly every program has one byte per character: the
// offsets are character counts and the bytes are written straight into one
// buffer. Null when any line needs more than one byte per character.
function encodeAsciiLines(lines: ReadonlyArray<string>): ProgramBuffers | null {
  const offsets = new Uint32Array(lines.length + 1);
  let total = 0;
  for (let index = 0; index < lines.length; index += 1) {
    total = addressable(total + lineAt(lines, index).length);
    offsets[index + 1] = total;
  }
  const bytes = new Uint8Array(total);
  const encoder = new TextEncoder();
  for (let start = 0; start < lines.length; start += LINES_PER_CHUNK) {
    const text = lines.slice(start, start + LINES_PER_CHUNK).join('');
    const { read, written } = encoder.encodeInto(text, bytes.subarray(offsets[start] ?? 0));
    if (read !== text.length || written !== text.length) return null;
  }
  return { bytes: bytes.buffer, offsets: offsets.buffer };
}

// Each line on its own, so a line's bytes are exactly what TextEncoder makes of
// that line, whatever its neighbours hold. UTF-8 cannot carry a lone surrogate,
// which TextEncoder would turn into U+FFFD; such a program is refused rather
// than handed over altered. No such line can reach a controller anyway.
function encodeUtf8Lines(lines: ReadonlyArray<string>): ProgramBuffers {
  const encoder = new TextEncoder();
  const decoder = exactDecoder();
  const encoded = Array.from({ length: lines.length }, (_, index) => {
    const line = lineAt(lines, index);
    const bytes = encoder.encode(line);
    if (decoder.decode(bytes) !== line) {
      throw new RangeError(`Program line ${index + 1} has no exact UTF-8 form.`);
    }
    return bytes;
  });
  const offsets = new Uint32Array(lines.length + 1);
  let total = 0;
  encoded.forEach((line, index) => {
    total = addressable(total + line.length);
    offsets[index + 1] = total;
  });
  const bytes = new Uint8Array(total);
  encoded.forEach((line, index) => bytes.set(line, offsets[index] ?? 0));
  return { bytes: bytes.buffer, offsets: offsets.buffer };
}

// A line's own leading U+FEFF is text, not a byte order mark to drop.
function exactDecoder(): TextDecoder {
  return new TextDecoder('utf-8', { ignoreBOM: true });
}

function lineAt(lines: ReadonlyArray<string>, index: number): string {
  const line: unknown = lines[index];
  if (typeof line !== 'string') throw new TypeError(`Program line ${index + 1} is not text.`);
  return line;
}

function addressable(total: number): number {
  if (total > MAX_PROGRAM_BYTES) throw new RangeError('The program is too large to transfer.');
  return total;
}

/**
 * The program's lines as a read-only array that decodes each line when it is
 * read. Null when the buffers do not describe a program, so a malformed message
 * can only refuse a handover, never refill the wrong bytes.
 */
export function decodeProgramLines(program: ProgramBuffers): ReadonlyArray<string> | null {
  try {
    if (program.offsets.byteLength % Uint32Array.BYTES_PER_ELEMENT !== 0) return null;
    const bytes = new Uint8Array(program.bytes);
    const offsets = new Uint32Array(program.offsets);
    const count = offsets.length - 1;
    if (count < 0 || offsets[0] !== 0 || offsets[count] !== bytes.length) return null;
    return linesView(count, cachedLineReader(bytes, offsets));
  } catch {
    return null;
  }
}

// The refill asks for the line that did not fit again on its next pass, so the
// last decoded line is kept.
function cachedLineReader(bytes: Uint8Array, offsets: Uint32Array): (index: number) => string {
  const decoder = exactDecoder();
  let cachedIndex = -1;
  let cachedLine = '';
  return (index) => {
    if (index !== cachedIndex) {
      cachedLine = decoder.decode(bytes.subarray(offsets[index] ?? 0, offsets[index + 1] ?? 0));
      cachedIndex = index;
    }
    return cachedLine;
  };
}

// An array's generic methods (slice, iteration, includes) read through `length`
// and indexed access, so answering those two is enough for all of them.
// Writes are refused: the program is as immutable here as the queue it came from.
function linesView(count: number, readLine: (index: number) => string): ReadonlyArray<string> {
  return new Proxy<string[]>([], {
    get: (target, key, receiver) => {
      if (key === 'length') return count;
      const index = lineIndex(key, count);
      return index === null ? Reflect.get(target, key, receiver) : readLine(index);
    },
    has: (target, key) => lineIndex(key, count) !== null || Reflect.has(target, key),
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
}

function lineIndex(key: string | symbol, count: number): number | null {
  if (typeof key !== 'string') return null;
  const index = Number(key);
  const canonical = Number.isInteger(index) && String(index) === key;
  return canonical && index >= 0 && index < count ? index : null;
}
