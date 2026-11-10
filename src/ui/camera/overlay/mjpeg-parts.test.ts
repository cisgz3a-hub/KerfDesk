// ADR-440 Amendment 10 (rolling audit v13 Y4-P1-2): the overlay reads a bridge
// camera's MJPEG preview part by part, so each picture is decoded once, off
// the UI thread.

import { describe, expect, it } from 'vitest';
import { jpegSize, MjpegPartReader } from './mjpeg-parts';

// A JPEG's start, an APP0 segment, and a baseline frame header declaring w × h.
function jpeg(width: number, height: number, body: number[] = [1, 2, 3]): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    ...body,
    0xff,
    0xd9,
  ]);
}

function part(bytes: Uint8Array, withLength = true): Uint8Array {
  const length = withLength ? `Content-Length: ${bytes.length}\r\n` : '';
  const head = new TextEncoder().encode(`--ffmpeg\r\nContent-Type: image/jpeg\r\n${length}\r\n`);
  return new Uint8Array([...head, ...bytes, 13, 10]);
}

describe('MjpegPartReader', () => {
  it('cuts each part by its Content-Length, across any chunking', () => {
    const a = jpeg(3840, 2160);
    const b = jpeg(1920, 1080, [9, 9]);
    const stream = new Uint8Array([...part(a), ...part(b)]);
    const reader = new MjpegPartReader();
    const parts: Uint8Array[] = [];
    for (let i = 0; i < stream.length; i += 7)
      parts.push(...reader.push(stream.subarray(i, i + 7)));
    expect(parts).toEqual([a, b]);
  });

  it('cuts a part without a length at the JPEG end marker', () => {
    const a = jpeg(640, 360);
    expect(new MjpegPartReader().push(part(a, false))).toEqual([a]);
  });

  it('holds an incomplete part until the rest arrives', () => {
    const a = jpeg(640, 360);
    const whole = part(a);
    const reader = new MjpegPartReader();
    expect(reader.push(whole.subarray(0, whole.length - 6))).toEqual([]);
    expect(reader.push(whole.subarray(whole.length - 6))).toEqual([a]);
  });
});

describe('jpegSize', () => {
  it('reads the size from the frame header without decoding', () => {
    expect(jpegSize(jpeg(3840, 2160))).toEqual({ width: 3840, height: 2160 });
  });

  it('says nothing for bytes that are not a JPEG', () => {
    expect(jpegSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
  });
});
