// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MAX_RTSP_DESCRIBE_BODY_BYTES,
  MAX_RTSP_DESCRIBE_BYTES,
  MAX_RTSP_DESCRIBE_HEADER_BYTES,
  RtspDescribeResponse,
  completeRtspDescribeResponse,
} from './rtsp-describe-response';

function reply(body: string, contentLength = String(Buffer.byteLength(body))): string {
  return `RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Length: ${contentLength}\r\n\r\n${body}`;
}

describe('bounded RTSP DESCRIBE response framing', () => {
  it.each(['\r\n', '\n'])('handles delimiters split across every socket chunk (%j)', (lineEnd) => {
    const source = `RTSP/1.0 200 OK${lineEnd}Content-Length: 3${lineEnd}${lineEnd}v=0`;
    const parser = new RtspDescribeResponse();
    const bytes = Buffer.from(source);
    for (const byte of bytes.subarray(0, -1)) expect(parser.append(Buffer.from([byte]))).toBeNull();
    expect(parser.append(bytes.subarray(-1))).toBe(source);
  });

  it('uses byte lengths for multibyte SDP text', () => {
    const source = reply('s=相机');
    const bytes = Buffer.from(source);
    const parser = new RtspDescribeResponse();
    expect(parser.append(bytes.subarray(0, -1))).toBeNull();
    expect(parser.append(bytes.subarray(-1))).toBe(source);
  });

  it('accepts the exact header, body and combined byte limits', () => {
    const header = `RTSP/1.0 200 OK\r\nContent-Length: ${MAX_RTSP_DESCRIBE_BODY_BYTES}\r\nX-Pad: `;
    const padded =
      header + 'a'.repeat(MAX_RTSP_DESCRIBE_HEADER_BYTES - header.length - 4) + '\r\n\r\n';
    const source = padded + 'b'.repeat(MAX_RTSP_DESCRIBE_BODY_BYTES);
    expect(Buffer.byteLength(source)).toBe(MAX_RTSP_DESCRIBE_BYTES);
    const parser = new RtspDescribeResponse();
    expect(parser.append(Buffer.from(padded))).toBeNull();
    expect(parser.append(Buffer.from(source.slice(padded.length)))).toBe(source);
  });

  it('stops headers that never terminate at the header limit', () => {
    const parser = new RtspDescribeResponse();
    expect(parser.append(Buffer.alloc(MAX_RTSP_DESCRIBE_HEADER_BYTES, 0x78))).toBeNull();
    expect(() => parser.append(Buffer.from('x'))).toThrow('headers are too large');
  });

  it('rejects an oversized completed header', () => {
    const source =
      'RTSP/1.0 200 OK\r\nX-Pad: ' + 'x'.repeat(MAX_RTSP_DESCRIBE_HEADER_BYTES) + '\r\n\r\n';
    expect(() => completeRtspDescribeResponse(Buffer.from(source))).toThrow(
      'headers are too large',
    );
  });

  it.each([String(MAX_RTSP_DESCRIBE_BODY_BYTES + 1), '999999999999999999999'])(
    'rejects declared body size %s before waiting for it',
    (length) => {
      expect(() => completeRtspDescribeResponse(Buffer.from(reply('', length)))).toThrow(
        'body is too large',
      );
    },
  );

  it('rejects received body overflow despite a falsely small declared length', () => {
    const source = reply('x'.repeat(MAX_RTSP_DESCRIBE_BODY_BYTES + 1), '1');
    expect(() => completeRtspDescribeResponse(Buffer.from(source))).toThrow('body is too large');
  });

  it('refuses a chunk above the total cap before buffering it', () => {
    const parser = new RtspDescribeResponse();
    expect(() => parser.append(Buffer.alloc(MAX_RTSP_DESCRIBE_BYTES + 1))).toThrow(
      'response is too large',
    );
  });

  it.each(['-1', '', '3.5', '1e3', 'Infinity', '3\r\nContent-Length: 3'])(
    'rejects malformed or duplicate Content-Length %j',
    (length) => {
      expect(() => completeRtspDescribeResponse(Buffer.from(reply('', length)))).toThrow(
        'Content-Length is invalid',
      );
    },
  );

  it('preserves bodyless responses without Content-Length and ignores later pipelined bytes', () => {
    const source = 'RTSP/1.0 200 OK\r\nCSeq: 1\r\n\r\n';
    expect(completeRtspDescribeResponse(Buffer.from(source + 'next response'))).toBe(source);
  });
});
