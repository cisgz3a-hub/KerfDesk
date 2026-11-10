// The JPEG parts of a multipart MJPEG stream (ADR-440 Amendment 10, rolling
// audit v13 Y4-P1-2). The camera bridge serves an RTSP camera's preview as
// ffmpeg's `mpjpeg`: each part is a boundary line, headers with its
// Content-Length, a blank line, then the JPEG. Read with fetch, the parts can
// be decoded one at a time off the UI thread, instead of an <img> that the
// overlay had to sample and upload whole 30 times a second. A part without a
// Content-Length is cut at the JPEG's own end marker.

const CRLF_CRLF = [13, 10, 13, 10] as const;
// A part's headers fit in this many bytes; past it the stream is not MJPEG.
const MAX_HEADER_BYTES = 4096;
// A part this large is not a camera picture; the bridge caps stills at 8 MiB.
const MAX_PART_BYTES = 16 * 1024 * 1024;

/**
 * Reads parts as the bytes arrive. A 4K part is megabytes in many chunks, so
 * the chunks are kept as they come and joined once, when the part is whole:
 * joining and rescanning the growing buffer on every chunk held the UI thread
 * 55-70 ms a part.
 */
export class MjpegPartReader {
  // Bytes of the current part's headers, while they are still arriving.
  private head: Uint8Array = new Uint8Array(0);
  // The current part's body chunks, and how many bytes they hold.
  private body: Uint8Array[] = [];
  private bodyBytes = 0;
  // The body's length from its headers; null while reading headers, -1 when absent.
  private expected: number | null = null;

  /** Add the next bytes of the stream; returns the JPEG parts now complete, oldest first. */
  push(chunk: Uint8Array): Array<Uint8Array<ArrayBuffer>> {
    const parts: Array<Uint8Array<ArrayBuffer>> = [];
    let rest: Uint8Array | null = chunk;
    while (rest !== null && rest.length > 0) {
      rest = this.expected === null ? this.readHeaders(rest) : this.readBody(rest, parts);
    }
    return parts;
  }

  // Headers until the blank line; returns the bytes after them, or null when more are needed.
  private readHeaders(chunk: Uint8Array): Uint8Array | null {
    const head = concat(this.head, chunk);
    const end = indexOf(head, CRLF_CRLF, 0);
    if (end < 0) {
      this.head = head.length > MAX_HEADER_BYTES ? head.slice(head.length - 3) : head;
      return null;
    }
    const headers = new TextDecoder().decode(head.subarray(0, end));
    const length = /content-length:\s*(\d+)/i.exec(headers)?.[1];
    this.expected = length === undefined ? -1 : Number(length);
    this.head = new Uint8Array(0);
    return head.subarray(end + CRLF_CRLF.length);
  }

  // Body chunks until the part is whole; returns the bytes past it, or null when more are needed.
  private readBody(chunk: Uint8Array, parts: Array<Uint8Array<ArrayBuffer>>): Uint8Array | null {
    const expected = this.expected ?? -1;
    const cut = expected >= 0 ? expected - this.bodyBytes : endMarkerCut(this.body, chunk);
    if (cut === null || cut > chunk.length) {
      this.body.push(chunk);
      this.bodyBytes += chunk.length;
      if (this.bodyBytes > MAX_PART_BYTES) this.reset();
      return null;
    }
    this.body.push(chunk.subarray(0, cut));
    parts.push(joined(this.body, this.bodyBytes + cut, expected < 0));
    this.reset();
    return chunk.subarray(cut);
  }

  private reset(): void {
    this.body = [];
    this.bodyBytes = 0;
    this.expected = null;
  }
}

// Without a length, the part ends after the JPEG end marker (FF D9), which may
// straddle the previous chunk. Returns where to cut `chunk`, or null.
function endMarkerCut(body: ReadonlyArray<Uint8Array>, chunk: Uint8Array): number | null {
  const previous = body[body.length - 1];
  if (previous !== undefined && previous[previous.length - 1] === 0xff && chunk[0] === 0xd9)
    return 1;
  const end = indexOf(chunk, [0xff, 0xd9], 0);
  return end < 0 ? null : end + 2;
}

// One copy of the chunks; a part without a length starts at its JPEG start marker.
function joined(
  chunks: ReadonlyArray<Uint8Array>,
  length: number,
  findStart: boolean,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  if (!findStart) return out;
  const start = indexOf(out, [0xff, 0xd8], 0);
  return start <= 0 ? out : out.slice(start);
}

/** The picture size a JPEG declares in its frame header, without decoding it; null when absent. */
export function jpegSize(
  bytes: Uint8Array,
): { readonly width: number; readonly height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = byteAt(bytes, i + 1);
    if (isFrameHeader(marker)) {
      const height = (byteAt(bytes, i + 5) << 8) | byteAt(bytes, i + 6);
      const width = (byteAt(bytes, i + 7) << 8) | byteAt(bytes, i + 8);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + ((byteAt(bytes, i + 2) << 8) | byteAt(bytes, i + 3));
  }
  return null;
}

// SOF0..SOF15 carry the size, except DHT (C4), JPG (C8) and DAC (CC).
function isFrameHeader(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function byteAt(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function indexOf(haystack: Uint8Array, needle: ReadonlyArray<number>, from: number): number {
  outer: for (let i = from; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
