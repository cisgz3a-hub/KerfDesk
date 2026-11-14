// @vitest-environment node
// Camera audit v2 K6-P3-3: the cut-picture check (K4-P3-2) looked for the end
// marker in the last 16 bytes only, so a whole JPEG with 15 or more bytes
// after it, as some cameras pad their buffers, was refused as cut short.

import { describe, expect, it } from 'vitest';
import { endsLikeJpeg } from './camera-frame-proxy';

// A segment: marker, then a two-byte length that counts itself.
const segment = (marker: number, payload: ReadonlyArray<number>): number[] => [
  0xff,
  marker,
  (payload.length + 2) >> 8,
  (payload.length + 2) & 0xff,
  ...payload,
];

// An EXIF block holding a thumbnail with its own scan and end marker.
const thumbnail = [0xff, 0xd8, ...segment(0xda, [1, 2, 3]), 9, 9, 0xff, 0xd9];
const header = [0xff, 0xd8, ...segment(0xe1, thumbnail), ...segment(0xdb, [0, 1, 2, 3])];
// Picture data: an FF in it is stuffed (FF 00), or a restart marker.
const scan = [...segment(0xda, [1, 1, 0, 0x3f, 0]), 5, 0xff, 0x00, 6, 0xff, 0xd0, 7];
const whole = Uint8Array.from([...header, ...scan, 0xff, 0xd9]);

describe('endsLikeJpeg', () => {
  it('takes a whole picture, with or without bytes after its end marker', () => {
    expect(endsLikeJpeg(whole)).toBe(true);
    for (const extra of [14, 15, 16, 32, 512, 4096]) {
      const padded = Uint8Array.from([...whole, ...new Array<number>(extra).fill(0)]);
      expect(endsLikeJpeg(padded)).toBe(true);
    }
  });

  it('refuses a picture cut in its data or in the block before it', () => {
    expect(endsLikeJpeg(whole.subarray(0, whole.length - 2))).toBe(false);
    expect(endsLikeJpeg(whole.subarray(0, header.length + 4))).toBe(false);
    // Cut inside the EXIF block, which holds a thumbnail with its own scan.
    expect(endsLikeJpeg(whole.subarray(0, 4 + thumbnail.length))).toBe(false);
  });
});
