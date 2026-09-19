// SDP is small text. Bound both framing and received bytes before copying,
// and grow geometrically so byte-at-a-time replies cannot trigger quadratic
// whole-response concatenation on every socket event.
export const MAX_RTSP_DESCRIBE_HEADER_BYTES = 16 * 1024;
export const MAX_RTSP_DESCRIBE_BODY_BYTES = 256 * 1024;
export const MAX_RTSP_DESCRIBE_BYTES =
  MAX_RTSP_DESCRIBE_HEADER_BYTES + MAX_RTSP_DESCRIBE_BODY_BYTES;

export class RtspDescribeResponse {
  private buffer = Buffer.alloc(0);
  private receivedBytes = 0;
  private headerEnd: number | null = null;
  private responseLength: number | null = null;

  append(chunk: Buffer): string | null {
    const previousBytes = this.receivedBytes;
    const requiredBytes = previousBytes + chunk.length;
    if (requiredBytes > MAX_RTSP_DESCRIBE_BYTES) {
      throw new Error('RTSP DESCRIBE response is too large.');
    }
    this.ensureCapacity(requiredBytes);
    chunk.copy(this.buffer, previousBytes);
    this.receivedBytes = requiredBytes;
    const received = this.buffer.subarray(0, requiredBytes);
    if (this.headerEnd === null) this.readHeader(received, Math.max(0, previousBytes - 3));
    if (this.headerEnd === null || this.responseLength === null) return null;
    if (requiredBytes - this.headerEnd > MAX_RTSP_DESCRIBE_BODY_BYTES) {
      throw new Error('RTSP DESCRIBE body is too large.');
    }
    return requiredBytes < this.responseLength
      ? null
      : received.subarray(0, this.responseLength).toString('utf8');
  }

  private ensureCapacity(requiredBytes: number): void {
    if (requiredBytes <= this.buffer.length) return;
    const capacity = Math.min(
      MAX_RTSP_DESCRIBE_BYTES,
      Math.max(requiredBytes, this.buffer.length * 2, 1024),
    );
    const next = Buffer.allocUnsafe(capacity);
    this.buffer.copy(next, 0, 0, this.receivedBytes);
    this.buffer = next;
  }

  private readHeader(received: Buffer, searchFrom: number): void {
    const headerEnd = rtspHeaderEnd(received, searchFrom);
    if ((headerEnd ?? received.length) > MAX_RTSP_DESCRIBE_HEADER_BYTES) {
      throw new Error('RTSP DESCRIBE headers are too large.');
    }
    if (headerEnd === null) return;
    this.headerEnd = headerEnd;
    this.responseLength =
      headerEnd + rtspContentLength(received.subarray(0, headerEnd).toString('utf8'));
  }
}

export function completeRtspDescribeResponse(buffer: Buffer): string | null {
  return new RtspDescribeResponse().append(buffer);
}

function rtspHeaderEnd(buffer: Buffer, from: number): number | null {
  const crlfEnd = buffer.indexOf('\r\n\r\n', from);
  const lfEnd = buffer.indexOf('\n\n', from);
  if (crlfEnd < 0) return lfEnd < 0 ? null : lfEnd + 2;
  return lfEnd < 0 ? crlfEnd + 4 : Math.min(crlfEnd + 4, lfEnd + 2);
}

function rtspContentLength(header: string): number {
  const matches = [...header.matchAll(/^Content-Length:[ \t]*([^\r\n]*)\r?$/gim)];
  if (matches.length === 0) return 0;
  const value = matches[0]?.[1]?.trim();
  if (matches.length !== 1 || value === undefined || !/^\d+$/.test(value)) {
    throw new Error('RTSP DESCRIBE Content-Length is invalid.');
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length > MAX_RTSP_DESCRIBE_BODY_BYTES) {
    throw new Error('RTSP DESCRIBE body is too large.');
  }
  return length;
}
